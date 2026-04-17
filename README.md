# @promptreports/cli

**Vibe Coding Infrastructure Optimizer** — Track, optimize, and reduce AI coding costs across Claude Code, Cursor, Copilot, and 90+ services.

## Quick Start

```bash
npx @promptreports/cli
```

That's it. No install. No config. Works immediately.

## What It Does

- Reads your Claude Code sessions from `~/.claude/projects/`
- Scans `.env.local` to discover all connected services (90+)
- Shows token costs, cache hit rates, cost per commit
- Recommends optimizations that save 25-40% on AI spend
- Optionally pushes to [PromptReports.ai](https://promptreports.ai) dashboard

## Commands

| Command | What It Does |
|---------|-------------|
| `npx @promptreports/cli` | Token summary (last 7 days) |
| `npx @promptreports/cli scan` | Full scan: tokens + providers |
| `npx @promptreports/cli push` | Push to PromptReports.ai |
| `npx @promptreports/cli optimize` | AI optimization recommendations |
| `npx @promptreports/cli init` | Interactive setup wizard |
| `npx @promptreports/cli install-skills` | Install .claude/ department skills |
| `npx @promptreports/cli login` | Set API key |
| `npx @promptreports/cli doctor` | Diagnose setup issues |

## Options

```
--days N         Lookback period (default: 7)
--today          Today only
--turns          Per-turn detail log
--commits        Cost per git commit
--tips           Token reduction tips
--fix            Hotspot analysis
--json           Export to JSON file
```

## Requirements

- Node.js 18+
- Claude Code (for token tracking) — optional, scans .env.local without it

## License

MIT — free and open source.

Built by [PromptReports.ai](https://promptreports.ai)
