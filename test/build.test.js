// @ts-check
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    buildTarget, emitFrontmatter, processMacros, Report,
    splitFrontmatter, tomlBasic, tomlMultiline,
} from '../src/compile.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.join(here, '..', 'examples');
const expectedRoot = path.join(here, 'fixtures', 'expected');

/** @param {string} root @returns {string[]} relative posix paths, sorted */
function listFilesRel(root) {
    /** @type {string[]} */
    const out = [];
    /** @param {string} dir */
    const rec = (dir) => {
        for (const name of readdirSync(dir)) {
            const full = path.join(dir, name);
            if (statSync(full).isDirectory()) rec(full);
            else out.push(path.relative(root, full).split(path.sep).join('/'));
        }
    };
    rec(root);
    return out.sort();
}

for (const kind of ['claude', 'codex']) {
    test(`golden: ${kind} output is byte-identical to the committed fixture`, () => {
        const tmp = mkdtempSync(path.join(os.tmpdir(), 'polyskill-'));
        try {
            buildTarget(examplesDir, kind, tmp, new Report());
            const expected = path.join(expectedRoot, kind);
            const got = listFilesRel(tmp);
            const exp = listFilesRel(expected);
            assert.deepEqual(got, exp, 'output file set differs from fixture');
            for (const rel of exp) {
                const a = readFileSync(path.join(tmp, rel));
                const b = readFileSync(path.join(expected, rel));
                assert.ok(a.equals(b), `byte mismatch in ${rel}`);
            }
            // No-churn contract: a second run must rewrite nothing.
            const second = new Report();
            buildTarget(examplesDir, kind, tmp, second);
            assert.equal(second.written.length, 0, 'second run rewrote unchanged files');
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    });
}

test('processMacros keeps only the matching kind', () => {
    const src = 'a<claude>C</claude><codex>X</codex>b';
    assert.equal(processMacros(src, 'claude'), 'aCb');
    assert.equal(processMacros(src, 'codex'), 'aXb');
});

test('splitFrontmatter parses fields and tolerates CRLF', () => {
    const { fields, body } = splitFrontmatter('---\r\nname: foo\r\ndescription: bar\r\n---\r\nbody\r\n');
    assert.deepEqual(fields, { name: 'foo', description: 'bar' });
    assert.equal(body, 'body\r\n');
});

test('splitFrontmatter returns null when absent', () => {
    assert.equal(splitFrontmatter('no frontmatter here').fields, null);
});

test('emitFrontmatter renders empty values without a trailing space', () => {
    assert.equal(emitFrontmatter({ name: 'x', description: '' }), '---\nname: x\ndescription:\n---\n');
});

test('tomlBasic escapes backslash before quote', () => {
    assert.equal(tomlBasic('a\\b"c'), '"a\\\\b\\"c"');
});

test('tomlMultiline escapes triple quotes and forces a trailing newline', () => {
    assert.equal(tomlMultiline('a"""b'), '"""\na\\"""b\n"""');
    assert.equal(tomlMultiline('line'), '"""\nline\n"""');
});
