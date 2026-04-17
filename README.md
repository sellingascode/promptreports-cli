# promptreports-cli

**Vibe Coder Toolkit** — 22 developer tools for AI cost tracking, environment sync, codebase analysis, session replay, and ops intelligence.

Zero dependencies. Zero config. Works first run.

## Quick Start

```bash
npx promptreports-cli
```

```bash
npx promptreports-cli doctor     # Check your setup
npx promptreports-cli audit      # Expert audit (score 0-100)
npx promptreports-cli providers  # Scan all provider costs
```

## What It Does

- Reads Claude Code sessions from `~/.claude/projects/` — token costs, cache hit rates, efficiency scores
- Scans `.env.local` to discover 90+ connected services and fetch billing data from each API
- Compares your local env vars against Vercel production — catches drift, missing keys, dead vars
- Analyzes your 200K context window — finds unused skills burning tokens every turn
- Attributes costs by AI model, git commit, or provider — know your unit economics
- Detects prompt drift, deprecated models, and oversized system prompts across your codebase
- Finds dead API routes, unused components, and zombie npm dependencies
- Replays any Claude Code session turn-by-turn, searches across all sessions
- Exports your entire dev setup (encrypted) for machine cloning in 60 seconds
- Optionally pushes everything to [promptreports.ai/swarm/toolkit](https://promptreports.ai/swarm/toolkit)

## Commands

### Core

| Command | What It Does |
|---------|-------------|
| `npx promptreports-cli` | Token usage summary (default, last 7 days) |
| `npx promptreports-cli scan` | Full provider cost scan (22+ services) |
| `npx promptreports-cli providers` | Alias for scan |
| `npx promptreports-cli push` | Push stats to PromptReports.ai dashboard |
| `npx promptreports-cli doctor` | Diagnose setup issues (Node, env, git, Prisma, skills) |
| `npx promptreports-cli audit` | Claude Code expert audit — score 0-100 with findings |

### Environment & Setup

| Command | What It Does |
|---------|-------------|
| `npx promptreports-cli env-sync` | Compare .env.local vs Vercel production vars |
| `npx promptreports-cli health` | Post-deploy health check (Sentry, Vercel, uptime) |
| `npx promptreports-cli setup export` | Export machine config (AES-256 encrypted) |
| `npx promptreports-cli setup import` | Import config on a new machine |
| `npx promptreports-cli logs` | Unified log stream (Sentry + Vercel + PostHog) |

### Intelligence

| Command | What It Does |
|---------|-------------|
| `npx promptreports-cli context` | Context window optimizer — find what's eating your 200K budget |
| `npx promptreports-cli costs` | Cost attribution by model, commit, or provider |
| `npx promptreports-cli models` | Model router tuner — suggest cheaper models for simple tasks |
| `npx promptreports-cli prompts-audit` | Detect prompt drift, deprecated models, token waste |

### Codebase Analysis

| Command | What It Does |
|---------|-------------|
| `npx promptreports-cli dead-code` | Find dead routes, unused components, zombie deps |
| `npx promptreports-cli deps` | Security audit, outdated packages, unused deps, licenses |
| `npx promptreports-cli schema` | Prisma schema stats, validation, migration drift |
| `npx promptreports-cli git-intel` | Git hotspots, velocity, tech debt, coding patterns |

### Session Tools

| Command | What It Does |
|---------|-------------|
| `npx promptreports-cli sessions` | Session history, replay, search, pattern extraction |

### Other

| Command | What It Does |
|---------|-------------|
| `npx promptreports-cli optimize` | AI optimization recommendations |
| `npx promptreports-cli init` | Interactive setup wizard |
| `npx promptreports-cli install-skills` | Install .claude/skills/ department templates |
| `npx promptreports-cli login` | Set PromptReports.ai API key |

## Examples

```bash
# Core
npx promptreports-cli                                 # Token summary
npx promptreports-cli --today                         # Today only
npx promptreports-cli --days 30 --commits             # Cost per commit, 30 days
npx promptreports-cli audit --push                    # Audit + push to dashboard

# Environment
npx promptreports-cli env-sync --diff                 # Show env var drift
npx promptreports-cli env-sync --merge --backup       # Merge missing vars
npx promptreports-cli health                          # Post-deploy check
npx promptreports-cli setup export --all --encrypt pw # Export encrypted config
npx promptreports-cli setup import bundle.json        # Import on new machine

# Intelligence
npx promptreports-cli costs --by model                # Cost by AI model
npx promptreports-cli costs --by commit               # Cost per git commit
npx promptreports-cli context                         # Context window analysis
npx promptreports-cli models                          # Model optimization tips
npx promptreports-cli prompts-audit                   # Prompt drift scan

# Codebase
npx promptreports-cli dead-code                       # Find dead code
npx promptreports-cli deps --audit                    # Security vulnerabilities
npx promptreports-cli deps --outdated                 # Check for updates
npx promptreports-cli schema --drift                  # Schema vs production DB
npx promptreports-cli git-intel --changelog           # Auto changelog

# Sessions
npx promptreports-cli sessions --list                 # Session history
npx promptreports-cli sessions --replay abc123        # Replay a session
npx promptreports-cli sessions --search "prisma"      # Search all sessions

# Logs
npx promptreports-cli logs --source sentry            # Sentry errors only
npx promptreports-cli logs --since 1h --level error   # Errors in last hour

# Scan + Push
npx promptreports-cli scan --all                      # Full provider scan
npx promptreports-cli push --all --dry-run            # Preview push
```

## Global Flags

All commands support these flags:

| Flag | Description |
|------|-------------|
| `--days N` | Lookback period in days (default: 7) |
| `--today` | Shorthand for `--days 1` |
| `--json` | Machine-readable JSON output |
| `--dry-run` | Preview changes without writing |
| `--quiet` | Suppress non-essential output |

## What Gets Scanned

When you have API keys in `.env.local`, the CLI queries each provider directly:

**AI/LLM:** OpenRouter, OpenAI, Google AI, Mistral, Cohere, Cursor, GitHub Copilot, Helicone

**Infrastructure:** Vercel, Railway, Supabase, Upstash, Inngest, Stripe

**DevTools:** GitHub, Sentry, PostHog

**Data/Search:** Pinecone, Serper, Tavily, ZenRows, Jina

No API key? The provider is skipped silently. No errors, no noise.

## Dashboard

All CLI data syncs to your dashboard at [promptreports.ai/swarm/toolkit](https://promptreports.ai/swarm/toolkit) where you can view historical trends, compare sessions, and share results with your team.

## Requirements

- Node.js 18+
- Claude Code (for token tracking) — optional, everything else works without it

## Zero Dependencies

This package has zero runtime dependencies. It uses only Node.js built-ins (`fs`, `path`, `os`, `crypto`, `child_process`) and the native `fetch()` API. Install size is minimal.

## License

MIT — free and open source.

Built by [PromptReports.ai](https://promptreports.ai)
