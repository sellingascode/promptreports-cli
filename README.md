# promptreports-cli

Vibe coding intelligence — unified ops, cost tracking, environment sync, and developer tools for AI coding agents.

**Zero external dependencies. Runs on your machine. No data leaves unless you explicitly push it.**

```bash
npx promptreports-cli
```

## What's new in 1.2.0

Three features aimed at silent context bloat and noisy agent output.

### `filter` — stream-compress subprocess output

Wrap any command. Its stdout/stderr gets deduplicated, stack-frame-collapsed, and tail-preserved before your agent ever reads it. Errors and warnings always pass through untouched. Exit code is preserved.

```bash
npx promptreports-cli filter -- npm test
npx promptreports-cli filter -- playwright test --reporter=list
npx promptreports-cli filter -- docker build .
npx promptreports-cli filter --keep-last 50 -- npm run ci
```

What it actually does:

- Strips ANSI color codes from noisy test runners
- Collapses N identical lines into `[repeated N-1 more times]`
- Preserves the first 2 and last frame of long stack traces, elides the middle
- Truncates long uniform-prefix blocks (hundreds of passing-test lines) to head + `[... N similar lines elided ...]`
- Always keeps lines matching `error/fail/warn/exception/traceback`
- Always keeps the last 20 lines (configurable via `--keep-last`)
- Prints a reduction summary at the end

Flags: `--keep-last N` (tail lines, default 20), `--max-repeat N` (threshold for collapse, default 2), `--truncate-after N` (lines before uniform-block truncation, default 50).

### `audit claude-md` — CLAUDE.md slim-down analysis

Deep token-budget analysis of your root `CLAUDE.md`. Finds bloat that silently taxes every turn.

```bash
npx promptreports-cli audit claude-md
npx promptreports-cli audit claude-md --json
```

Detects:

- **Duplicated phrases** — sentences appearing 3+ times
- **Long code examples** — code blocks over 30 lines that could be trimmed to signatures
- **Dead file references** — paths cited in CLAUDE.md that no longer exist on disk
- **Redundant sections** — sections that duplicate content in `.claude/LESSONS.md`, `TECH_STACK.md`, `DESIGN_SYSTEM.md`, etc. (suggests replacing with a one-line reference)
- **Filler words** — softening patterns like "please", "basically", "it is important to note" that Claude reads past anyway

Output includes a projected token count, estimated savings per session, and a prioritized list of fixes sorted by token impact.

### `context --ghosts` — find silent token waste

Extends the existing `context` command with a scanner for waste that never shows up in the aggregate summary.

```bash
npx promptreports-cli context --ghosts
npx promptreports-cli context --ghosts --days 30
npx promptreports-cli context --ghosts --json
```

Detects:

- **Duplicate tool results** — same large file read or API response returned 3+ times across sessions
- **Oversized tool schemas** — tools being invoked with huge inlined payloads (content that should be referenced by path)
- **Post-compaction residue** — what survived context compaction that didn't need to
- **Skills loaded but never invoked** — sitting in context at ~300 tokens each
- **Bloated CLAUDE.md** — if over 2000 tokens, flags with a pointer to `audit claude-md`

Outputs total waste in tokens, daily average, and estimated dollar cost per month of silent bloat.

## Full command list

### Core
- `summary` — token usage summary (default command)
- `push` — push stats to PromptReports.ai
- `providers` — provider cost scan across 22+ services
- `doctor` — system health check
- `audit` — Claude Code expert audit of `.claude/`, skills, env
- **`audit claude-md`** — deep CLAUDE.md slim-down analysis *(new)*
- **`filter -- <cmd>`** — compress subprocess output *(new)*

### Environment & Setup
- `env sync` — sync `.env.local` with Vercel/Railway
- `setup export` / `setup import` — machine config migration
- `health` — post-deploy health check

### Intelligence
- `context` — context window optimizer
- **`context --ghosts`** — find silent token waste *(new)*
- `costs` — cost attribution by feature/model/commit
- `models` — model router, suggest cheaper models
- `prompts audit` — prompt drift detector

### Codebase Analysis
- `dead-code` — find unused routes, components, deps
- `deps` — dependency audit, outdated, licenses
- `schema` — Prisma schema stats & drift detection
- `git-intel` — git patterns, hotspots, velocity

### Session Tools
- `sessions` — session history, replay, search
- `logs` — unified log stream (Sentry/Vercel/PostHog)

### Global Flags
- `--days N` — lookback period (default: 7)
- `--today` — shorthand for `--days 1`
- `--json` — machine-readable output
- `--quiet` — suppress non-essential output
- `--dry-run` — preview changes without writing

## Installation

No install needed — use `npx`:

```bash
npx promptreports-cli
```

Or install globally:

```bash
npm install -g promptreports-cli
promptreports
```

## License

MIT. See `LICENSE`.
