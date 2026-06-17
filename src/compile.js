// @ts-check
/**
 * polyskill core compiler.
 *
 * Reads "author-once" Claude-flavored skills and subagents, expands per-kind
 * macros (<claude>...</claude>, <codex>...</codex>), and emits one config tree
 * per target. Behavior is a faithful port of the original Python build.py:
 * same macro pass, same line-based frontmatter parse, same TOML escaping, and
 * the same overwrite-only / no-orphan-cleanup contract.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const KNOWN_KINDS = ['claude', 'codex'];

/** Frontmatter fields that survive the Codex skill shrinkage step. */
const CODEX_SKILL_KEEP = ['name', 'description'];

/**
 * Claude subagent frontmatter -> Codex TOML field renames.
 * @type {Record<string, string>}
 */
const TOML_RENAMES = { mcpServers: 'mcp_servers', effort: 'model_reasoning_effort' };

/**
 * Claude subagent frontmatter fields that never reach the Codex TOML.
 * `model` is intentionally dropped — a Claude model name (opus/sonnet) is not a
 * valid Codex model id, so passing it through would be wrong, not lossless. A
 * Codex-specific model belongs in a <codex> frontmatter block.
 */
const TOML_DROP = new Set([
    'model', 'tools', 'disallowedTools', 'permissionMode', 'hooks',
    'memory', 'isolation', 'background', 'initialPrompt', 'color',
]);

const TAG_RE = /<(claude|codex)>([\s\S]*?)<\/\1>/g;
const FRONT_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
const YAML_LINE_RE = /^([A-Za-z_][\w-]*)\s*:\s?(.*)$/;

export class Report {
    constructor() {
        /** @type {string[]} */ this.written = [];
        /** @type {string[]} */ this.warnings = [];
        /** @type {string[]} */ this.dropped = [];
    }
    emit() {
        process.stdout.write(`wrote ${this.written.length} file(s)\n`);
        for (const w of this.warnings) process.stdout.write(`WARN: ${w}\n`);
        for (const d of this.dropped) process.stdout.write(`drop: ${d}\n`);
    }
}

/**
 * Keep the body of macro tags matching `kind`; drop the rest.
 * @param {string} text
 * @param {string} kind
 * @returns {string}
 */
export function processMacros(text, kind) {
    return text.replace(TAG_RE, (_m, tagKind, body) => (tagKind === kind ? body : ''));
}

/**
 * Split a leading `---` frontmatter block from the body.
 * @param {string} text
 * @returns {{ fields: Record<string,string> | null, raw: string, body: string }}
 */
export function splitFrontmatter(text) {
    const stripped = text.replace(/^[\r\n]+/, '');
    const leadingWs = text.slice(0, text.length - stripped.length);
    const m = FRONT_RE.exec(stripped);
    if (!m) return { fields: null, raw: '', body: text };
    const raw = stripped.slice(0, m[0].length);
    const body = stripped.slice(m[0].length);
    /** @type {Record<string,string>} */
    const fields = {};
    for (const line of m[1].split(/\r\n|\r|\n/)) {
        if (!line.trim()) continue;
        const fm = YAML_LINE_RE.exec(line);
        if (fm) fields[fm[1]] = fm[2];
    }
    return { fields, raw: leadingWs + raw, body };
}

/**
 * Render a frontmatter block from ordered key/value pairs.
 * @param {Record<string,string>} fields
 * @returns {string}
 */
export function emitFrontmatter(fields) {
    const lines = ['---'];
    for (const [k, v] of Object.entries(fields)) lines.push(v ? `${k}: ${v}` : `${k}:`);
    lines.push('---');
    return lines.join('\n') + '\n';
}

/** @param {string} s @returns {string} */
export function tomlBasic(s) {
    const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
}

/** @param {string} s @returns {string} */
export function tomlMultiline(s) {
    let out = s.replace(/\\/g, '\\\\').replaceAll('"""', '\\"""');
    if (!out.endsWith('\n')) out += '\n';
    return `"""\n${out}"""`;
}

// ---------- fs helpers ----------

/** @param {string} dir @returns {string[]} absolute file paths, recursive, sorted */
function walkFiles(dir) {
    /** @type {string[]} */
    const out = [];
    /** @param {string} d */
    const rec = (d) => {
        for (const name of readdirSync(d)) {
            const full = path.join(d, name);
            if (statSync(full).isDirectory()) rec(full);
            else out.push(full);
        }
    };
    rec(dir);
    return out.sort();
}

/** @param {string} p @returns {boolean} */
function isDir(p) {
    return existsSync(p) && statSync(p).isDirectory();
}

/**
 * Read a text file with universal-newline normalization (CRLF/CR -> LF), so
 * output matches the Python tool, whose text-mode reads normalize newlines.
 * Verbatim/binary copies deliberately do NOT go through here.
 * @param {string} p @returns {string}
 */
function readText(p) {
    return readFileSync(p, 'utf-8').replace(/\r\n?/g, '\n');
}

/** @param {string} dest @param {Buffer} data @param {Report} report */
function writeBytesIfChanged(dest, data, report) {
    mkdirSync(path.dirname(dest), { recursive: true });
    if (existsSync(dest) && readFileSync(dest).equals(data)) return;
    writeFileSync(dest, data);
    report.written.push(dest);
}

/** @param {string} dest @param {string} text @param {Report} report */
function writeIfChanged(dest, text, report) {
    writeBytesIfChanged(dest, Buffer.from(text, 'utf-8'), report);
}

/** @param {string} src @param {string} dest @param {string} kind @param {Report} report */
function copyMdWithMacros(src, dest, kind, report) {
    writeIfChanged(dest, processMacros(readText(src), kind), report);
}

/** @param {string} src @param {string} dest @param {Report} report */
function copyVerbatim(src, dest, report) {
    writeBytesIfChanged(dest, readFileSync(src), report);
}

// ---------- claude target ----------

/** @param {string} srcDir @param {string} outDir @param {Report} report */
function emitClaudeSkill(srcDir, outDir, report) {
    for (const f of walkFiles(srcDir)) {
        const dest = path.join(outDir, path.relative(srcDir, f));
        if (f.endsWith('.md')) copyMdWithMacros(f, dest, 'claude', report);
        else copyVerbatim(f, dest, report);
    }
}

/**
 * @param {string} srcFile @param {string|null} siblingDir
 * @param {string} outFile @param {string} outSibling @param {Report} report
 */
function emitClaudeAgent(srcFile, siblingDir, outFile, outSibling, report) {
    copyMdWithMacros(srcFile, outFile, 'claude', report);
    if (siblingDir && isDir(siblingDir)) {
        for (const f of walkFiles(siblingDir)) {
            const dest = path.join(outSibling, path.relative(siblingDir, f));
            if (f.endsWith('.md')) copyMdWithMacros(f, dest, 'claude', report);
            else copyVerbatim(f, dest, report);
        }
    }
}

// ---------- codex target ----------

/** @param {string} srcDir @param {string} outDir @param {Report} report */
function emitCodexSkill(srcDir, outDir, report) {
    for (const f of walkFiles(srcDir)) {
        const dest = path.join(outDir, path.relative(srcDir, f));
        if (path.basename(f) === 'SKILL.md') {
            const text = processMacros(readText(f), 'codex');
            const { fields, body } = splitFrontmatter(text);
            if (fields === null) {
                report.warnings.push(`${f}: no frontmatter after macro pass`);
                writeIfChanged(dest, text, report);
                continue;
            }
            /** @type {Record<string,string>} */
            const kept = {};
            for (const k of CODEX_SKILL_KEEP) if (k in fields) kept[k] = fields[k];
            for (const k of Object.keys(fields)) {
                if (!CODEX_SKILL_KEEP.includes(k)) report.dropped.push(`${f}: frontmatter '${k}'`);
            }
            writeIfChanged(dest, emitFrontmatter(kept) + body, report);
        } else if (f.endsWith('.md')) {
            copyMdWithMacros(f, dest, 'codex', report);
        } else {
            copyVerbatim(f, dest, report);
        }
    }
}

/**
 * @param {string} srcFile @param {string|null} siblingDir
 * @param {string} outFile @param {string} outSibling @param {Report} report
 */
function emitCodexAgent(srcFile, siblingDir, outFile, outSibling, report) {
    const text = processMacros(readText(srcFile), 'codex');
    let { fields, body } = splitFrontmatter(text);
    if (fields === null) {
        report.warnings.push(`${srcFile}: no frontmatter after macro pass`);
        fields = {};
    }
    const lines = [];
    const nameVal = fields.name ?? path.basename(srcFile, '.md');
    const descVal = fields.description ?? '';
    lines.push(`name = ${tomlBasic(nameVal)}`);
    lines.push(`description = ${tomlBasic(descVal)}`);
    for (const [k, v] of Object.entries(fields)) {
        if (k === 'name' || k === 'description') continue;
        if (TOML_DROP.has(k)) {
            report.dropped.push(`${srcFile}: frontmatter '${k}'`);
            continue;
        }
        const outKey = TOML_RENAMES[k] ?? k;
        lines.push(`${outKey} = ${tomlBasic(v)}`);
    }
    lines.push(`developer_instructions = ${tomlMultiline(body)}`);
    writeIfChanged(outFile, lines.join('\n') + '\n', report);

    if (siblingDir && isDir(siblingDir)) {
        for (const f of walkFiles(siblingDir)) {
            const dest = path.join(outSibling, path.relative(siblingDir, f));
            if (f.endsWith('.md')) copyMdWithMacros(f, dest, 'codex', report);
            else copyVerbatim(f, dest, report);
        }
    }
}

// ---------- driver ----------

/**
 * Compile one source tree into one target's output tree.
 * @param {string} sourceRoot absolute path holding skills/ and agents/
 * @param {string} kind 'claude' | 'codex'
 * @param {string} outRoot absolute output root
 * @param {Report} report
 */
export function buildTarget(sourceRoot, kind, outRoot, report) {
    const skillsSrc = path.join(sourceRoot, 'skills');
    const agentsSrc = path.join(sourceRoot, 'agents');

    let skillsOut, agentsOut;
    if (kind === 'claude') {
        skillsOut = path.join(outRoot, '.claude', 'skills');
        agentsOut = path.join(outRoot, '.claude', 'agents');
    } else if (kind === 'codex') {
        skillsOut = path.join(outRoot, '.agents', 'skills');
        agentsOut = path.join(outRoot, '.codex', 'agents');
    } else {
        throw new Error(`unknown kind: ${kind}`);
    }

    if (isDir(skillsSrc)) {
        for (const name of readdirSync(skillsSrc).sort()) {
            const skillDir = path.join(skillsSrc, name);
            if (!isDir(skillDir)) continue;
            const dest = path.join(skillsOut, name);
            if (kind === 'claude') emitClaudeSkill(skillDir, dest, report);
            else emitCodexSkill(skillDir, dest, report);
        }
    }

    if (isDir(agentsSrc)) {
        for (const entry of readdirSync(agentsSrc).sort()) {
            const full = path.join(agentsSrc, entry);
            if (!entry.endsWith('.md') || isDir(full)) continue;
            const name = path.basename(entry, '.md');
            const sibling = path.join(agentsSrc, name);
            const siblingArg = isDir(sibling) ? sibling : null;
            if (kind === 'claude') {
                emitClaudeAgent(full, siblingArg, path.join(agentsOut, `${name}.md`), path.join(agentsOut, name), report);
            } else {
                emitCodexAgent(full, siblingArg, path.join(agentsOut, `${name}.toml`), path.join(agentsOut, name), report);
            }
        }
    }
}
