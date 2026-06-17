# polyskill

Author your AI-coding-agent **skills and subagents once**, compile them to
every harness. One Markdown source tree → Claude Code and Codex config trees,
with **inline per-target macros** so a single file can say different things to
different agents.

```bash
npx --yes polyskill --source ./src-agents --out .
```

## Why

Most "sync my agent rules everywhere" tools broadcast the *same* body to every
target and only vary the frontmatter. That breaks down the moment a skill needs
to say something genuinely different per harness — e.g. Claude Code has
`Explore` / `general-purpose` subagents and an `ExitPlanMode` tool that Codex
does not. polyskill solves that with inline macros:

```markdown
<claude>On Claude Code, dispatch read-only checks with `subagent_type: "Explore"`.</claude>
<codex>On Codex, use the default worker — there is no Explore / general-purpose split.</codex>
```

Everything outside a macro tag is shared verbatim. Tags are expanded only inside
`.md` files; every other file is copied byte-for-byte.

## Usage

Zero install — run it with `npx`. Always pass `--yes` in scripts/CI so npx does
not stall on its install prompt, and pin an exact version for reproducible
builds:

```bash
npx --yes polyskill@0.1.0            # walk up for polyskill.config.json
npx --yes polyskill --source ./a --out ./dist --target claude
```

Before publishing, you can run straight from GitHub:

```bash
npx --yes github:SSS135/polyskill --source ./a --out .
```

### Source layout

```
<source>/
  skills/<name>/SKILL.md      # required; bundled files copy verbatim
  skills/<name>/<other files>
  agents/<name>.md            # single-file subagent
  agents/<name>/<helpers>     # optional sibling folder
```

### Config

With no flags, polyskill walks up from the current directory looking for
`polyskill.config.json`:

```json
{
  "source": "./src-agents",
  "targets": {
    "claude": { "kind": "claude", "out": "." },
    "codex":  { "kind": "codex",  "out": "." }
  }
}
```

Relative paths in the config resolve against the config file's directory;
relative paths passed as flags resolve against the current directory. Flags
override config (`--source`, `--out`, `--target`). With no config file present,
`--source` and `--out` are required and all built-in kinds are emitted.

## Targets

| Kind   | Skills                   | Subagents              |
| ------ | ------------------------ | ---------------------- |
| claude | `<out>/.claude/skills/`  | `<out>/.claude/agents/`|
| codex  | `<out>/.agents/skills/`  | `<out>/.codex/agents/` |

### Codex conversions

- `SKILL.md` frontmatter is shrunk to `name` + `description`.
- Subagent `.md` → TOML: the body becomes `developer_instructions`;
  `mcpServers` → `mcp_servers`, `effort` → `model_reasoning_effort`.
- `model` and other Claude-only fields (`tools`, `color`, `hooks`, …) are
  dropped — a Claude model name is not a valid Codex model id. Set a
  Codex-specific value in a `<codex>` frontmatter block if you need one.

The build is overwrite-only: unchanged files are left untouched, and orphans
from deleted sources are not auto-cleaned.

## Development

```bash
npm install
npm test          # node:test — golden byte-identical fixtures + unit tests
npm run typecheck # tsc --noEmit over JSDoc-typed source (dev-only; runtime is zero-dep)
```

The runtime has **no dependencies** — it uses only Node built-ins and needs
Node ≥ 20.

## License

MIT
