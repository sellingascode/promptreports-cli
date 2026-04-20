# promptreports-cli

**The local CLI for [PromptReports.ai](https://www.promptreports.ai/) — the Vibe Coding Stack Management & Optimization Platform.**

One terminal command inventories your entire AI development stack — Claude Code sessions, OpenRouter, Anthropic, OpenAI, Stripe, Vercel, Railway, Sentry, GitHub, PostHog, and 12+ more providers — surfaces cost, health, and risk across the lot, and pushes the telemetry into PromptReports.ai dashboards where a virtual ops team of 20 AI departments reads it and drafts optimizations as PRs you approve.

```bash
npx promptreports-cli
```

**Zero external dependencies. Runs on your machine. Nothing leaves your computer unless you explicitly `push`.**

- Vibe Coder Toolkit: https://www.promptreports.ai/vibe-coder-toolkit
- Platform: https://www.promptreports.ai/

---

## Why this exists

A solo founder or 2–5 person team running a vibe-coded SaaS has all the same operational problems a 100-person company does — CFO, CMO, SRE, Security, Data Analyst, DemandGen, Content, Product — but can't afford the hires. PromptReports.ai delivers those 20 functions as virtual departments that read the real data in your stack (not mocked outputs) and produce evidence-backed findings a real department lead would.

The CLI is the **read layer**. It scans your local environment + your provider APIs without sending anything anywhere unless you opt in. The dashboards are the **act layer** — they consume what you push, run the virtual departments against it, and produce findings + draft PRs you review.

You stay solo. Your stack gets a 100-person ops team.

---

## How the CLI feeds the PromptReports.ai dashboards

| CLI command | Pushes to dashboard | What the dashboard does with it |
|---|---|---|
| `summary` + `push` | **Token Forensics** (`/token-forensics`) | Per-turn token attribution, session replay, model-cost breakdown, optimization suggestions |
| `providers` + `push` | **Provider Cost Center** (`/admin?tab=providers`) | Multi-provider burn-rate over time, anomaly detection, monthly projections |
| `costs --push-to-app` | **Cost Attribution** (inside Token Forensics) | Cost per feature / per model / per git commit |
| `context --ghosts` (with `--json` push) | **Ghost-Token Scanner** | Trends silent waste over time, alerts when ghosts spike |
| `audit` + `audit claude-md` | **Vibe Coder Audit** | CLAUDE.md slim-down recommendations, skill review, env hygiene |
| `health` | **SRE Department** | Post-deploy health checks, infra reliability scoring |
| `git-intel` | **Engineering Velocity** | Hotspots, churn, ownership, auto-changelogs |
| `dead-code` / `deps` / `schema` | **Codebase Audit** | Drift detection, security findings, dependency hygiene |
| `prompts audit` | **Prompt Drift** (Content/Product departments) | Catches prompt regressions across releases |
| `campaign launch` | **Demand Gen Department** (`/campaigns`) | Multi-channel campaign generation (email/Twitter/LinkedIn/Reddit/HN/dev.to) with brand-playbook review gating |
| `sessions` / `logs` | **Unified Session Replay** | Full session history with cross-tool log correlation (Sentry/Vercel/PostHog) |

Free tier covers all local scans. Pushing to dashboards is free up to a soft limit; team dashboards, alerts, and auto-PR generation are pro features.

---

## Quick start

```bash
# 1. Scan your AI usage (no signup, fully local)
npx promptreports-cli

# 2. Scan all your provider costs
npx promptreports-cli providers

# 3. Sign up at promptreports.ai, generate an API key, and push
export PROMPTREPORTS_API_KEY=pk_...
npx promptreports-cli push

# 4. Open the dashboards
open https://www.promptreports.ai/token-forensics
```

---

## What's new in 1.2.x

Three features aimed at silent context bloat and noisy agent output, plus the `campaign` command for terminal-driven demand gen.

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

### `campaign` — launch demand-gen from the terminal

Terminal entry-point into the **Demand Gen** virtual department. Launches a multi-channel campaign for a feature, a release, or any free-form name, then queues content drafts across email, Twitter, LinkedIn, Reddit, HackerNews, and dev.to. Brand-playbook review happens server-side before anything sends.

```bash
# Manual launch for a feature
npx promptreports-cli campaign launch "V2 export flow"

# Trigger from an npm release
npx promptreports-cli campaign launch npm:my-package

# Inspect campaigns
npx promptreports-cli campaign list
npx promptreports-cli campaign show cmp_01HV9Z...
```

Requires `PROMPTREPORTS_API_KEY` (generate at https://promptreports.ai/settings/api-keys).

---

## Full command list

### Core

- `summary` — token usage summary across all your Claude Code sessions (default command)
- `push` — push token + provider stats to PromptReports.ai dashboards
- `providers` — multi-provider cost scan across 22+ services (OpenAI, Anthropic, OpenRouter, Vercel, Stripe, Sentry, etc.)
- `doctor` — system health check (Node version, env vars, file permissions, network reachability)
- `audit` — Claude Code expert audit of `.claude/`, skills, env hygiene, CLAUDE.md size
- **`audit claude-md`** — deep CLAUDE.md slim-down analysis *(new in 1.2.0)*
- **`filter -- <cmd>`** — compress subprocess output before your agent reads it *(new in 1.2.0)*
- **`campaign launch|list|show`** — multi-channel demand-gen campaigns *(new in 1.2.x)*

### Environment & Setup

- `env sync` — diff and sync `.env.local` with Vercel / Railway environment vars
- `setup export` — bundle env (AES-256-CBC encrypted), skills, CLAUDE.md, MCP, VS Code config
- `setup import` — restore a setup bundle on a new machine in one command
- `health` — post-deploy health check (HTTP probes, DB reachability, critical endpoints)

### Intelligence

- `context` — context window optimizer, finds bloat patterns in your sessions
- **`context --ghosts`** — silent waste scanner: duplicate tool results, oversized payloads, post-compaction residue, unused skills *(new in 1.2.0)*
- `costs` — cost attribution by feature / model / commit
- `models` — model router, suggest cheaper models per workload
- `prompts audit` — prompt drift detector across releases

### Codebase Analysis

- `dead-code` — find unused routes, components, dependencies
- `deps` — security audit (CVEs), outdated packages, license compliance
- `schema` — Prisma schema stats + drift detection vs. live DB
- `git-intel` — git patterns, hotspots, ownership, velocity, auto-changelog

### Session Tools

- `sessions` — session history, replay, search across all `~/.claude/projects/`
- `logs` — unified log stream from Sentry / Vercel / PostHog

### Global Flags

- `--days N` — lookback period (default: 7)
- `--today` — shorthand for `--days 1`
- `--json` — machine-readable output
- `--quiet` — suppress non-essential output
- `--dry-run` — preview changes without writing

---

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

### Auth (only needed for `push` and `campaign`)

Generate an API key at https://promptreports.ai/settings/api-keys, then:

```bash
export PROMPTREPORTS_API_KEY=pk_...
# optional — override the API base for self-hosted / staging
export PROMPTREPORTS_API_URL=https://promptreports.ai
```

All other commands (`summary`, `providers`, `audit`, `filter`, `context`, etc.) run fully offline with no auth required.

---

## Common workflows

**Daily token-burn check (zero-config):**
```bash
npx promptreports-cli
```

**Pre-deploy verification:**
```bash
npx promptreports-cli doctor && npx promptreports-cli health
```

**Cut a release + announce it:**
```bash
npm publish && npx promptreports-cli campaign launch npm:my-package
```

**Compress noisy CI output for an agent:**
```bash
npx promptreports-cli filter -- npm run test:e2e
```

**Onboard a new teammate:**
```bash
# On your machine
npx promptreports-cli setup export --all --encrypt mySecret123 --output team.json

# On their machine
npx promptreports-cli setup import team.json --diff --decrypt mySecret123
npx promptreports-cli setup import team.json --decrypt mySecret123
```

**Monthly burn-rate review:**
```bash
npx promptreports-cli providers --days 30 --json | jq '.providers[] | select(.monthly_projection > 50)'
```

---

## License

MIT. See `LICENSE`.
