#!/usr/bin/env node
// @ts-check
/**
 * polyskill CLI.
 *
 * Compiles an "author-once" source tree (skills/ + agents/) into per-target
 * agent-config trees. Driven by a JSON config, by flags, or both — flags
 * override config, and the tool runs with no config file at all when given
 * --source/--out directly.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildTarget, KNOWN_KINDS, Report } from './compile.js';

const CONFIG_NAME = 'polyskill.config.json';

const USAGE = `polyskill — compile author-once skills/subagents to per-harness config trees

Usage:
  polyskill [--config <path>] [--source <dir>] [--out <dir>] [--target <id> ...]

Options:
  --config <path>   JSON config file. If omitted, walk up from the cwd looking
                    for ${CONFIG_NAME}; if none is found, run from flags alone.
  --source <dir>    Source root holding skills/ and agents/. Overrides config.
  --out <dir>       Output root. Overrides every target's configured out.
  --target <id>     Target to build (repeatable). Defaults to every target in
                    the config, or to all built-in kinds (${KNOWN_KINDS.join(', ')})
                    in no-config mode.
  -h, --help        Show this help.

Config shape:
  {
    "source": "./.universal-agent",
    "targets": {
      "claude": { "kind": "claude", "out": "../.." },
      "codex":  { "kind": "codex",  "out": "../.." }
    }
  }
  Relative paths in the config resolve against the config file's directory;
  relative paths passed as flags resolve against the current directory.
`;

/** @param {string} msg */
function fail(msg) {
    process.stderr.write(`${msg}\n`);
    return 2;
}

/** @param {string} startDir @returns {string|null} */
function findConfig(startDir) {
    let dir = startDir;
    for (;;) {
        const candidate = path.join(dir, CONFIG_NAME);
        if (existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

/**
 * @param {string[]} argv
 * @returns {number} process exit code
 */
export function main(argv) {
    let values;
    try {
        ({ values } = parseArgs({
            args: argv,
            options: {
                config: { type: 'string' },
                source: { type: 'string' },
                out: { type: 'string' },
                target: { type: 'string', multiple: true },
                help: { type: 'boolean', short: 'h' },
            },
            allowPositionals: false,
        }));
    } catch (err) {
        return fail(`error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (values.help) {
        process.stdout.write(USAGE);
        return 0;
    }

    const cwd = process.cwd();
    const flagTargets = /** @type {string[]} */ (values.target ?? []);

    // Resolve the config path: explicit flag, else walk-up discovery, else none.
    /** @type {string|null} */
    let configPath = null;
    if (values.config) {
        configPath = path.resolve(cwd, values.config);
        if (!existsSync(configPath)) return fail(`error: config not found: ${configPath}`);
    } else {
        configPath = findConfig(cwd);
    }

    /** @type {Array<{ id: string, kind: string, sourceRoot: string, outRoot: string }>} */
    const plan = [];

    if (configPath) {
        let cfg;
        try {
            cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
        } catch (err) {
            return fail(`error: invalid JSON in ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
        }
        const base = path.dirname(configPath);
        const targets = cfg.targets ?? {};
        const ids = Object.keys(targets);
        if (ids.length === 0) return fail(`error: no "targets" defined in ${configPath}`);

        const sourceRoot = values.source
            ? path.resolve(cwd, values.source)
            : path.resolve(base, cfg.source ?? '.');

        const selected = flagTargets.length ? flagTargets : ids;
        for (const id of selected) {
            if (!(id in targets)) return fail(`error: unknown target: ${id}`);
            const t = targets[id];
            if (!KNOWN_KINDS.includes(t.kind)) return fail(`error: target ${id}: unknown kind '${t.kind}'`);
            const outRoot = values.out
                ? path.resolve(cwd, values.out)
                : path.resolve(base, t.out ?? '.');
            plan.push({ id, kind: t.kind, sourceRoot, outRoot });
        }
    } else {
        // No-config mode: everything comes from flags.
        if (!values.source || !values.out) {
            return fail(`error: no ${CONFIG_NAME} found; --source and --out are required.\n\n${USAGE}`);
        }
        const sourceRoot = path.resolve(cwd, values.source);
        const outRoot = path.resolve(cwd, values.out);
        const selected = flagTargets.length ? flagTargets : KNOWN_KINDS;
        for (const id of selected) {
            if (!KNOWN_KINDS.includes(id)) return fail(`error: unknown target kind: ${id} (expected one of ${KNOWN_KINDS.join(', ')})`);
            plan.push({ id, kind: id, sourceRoot, outRoot });
        }
    }

    const report = new Report();
    for (const t of plan) {
        process.stdout.write(`[${t.id}] kind=${t.kind} -> ${t.outRoot}\n`);
        buildTarget(t.sourceRoot, t.kind, t.outRoot, report);
    }
    report.emit();
    return 0;
}

process.exit(main(process.argv.slice(2)));
