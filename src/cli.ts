#!/usr/bin/env node

/**
 * promptreports-cli — Vibe Coding Infrastructure Optimizer
 *
 * Zero config. Zero dependencies. Works first run.
 *
 * Usage:
 *   npx promptreports-cli              # Summary, last 7 days
 *   npx promptreports-cli scan         # Full scan: tokens + providers
 *   npx promptreports-cli push         # Push to promptreports.ai
 *   npx promptreports-cli optimize     # AI optimization recommendations
 *   npx promptreports-cli init         # Interactive setup wizard
 *   npx promptreports-cli install-skills  # Install .claude/skills/
 */

import { summary } from './commands/summary.js';
import { scan } from './commands/scan.js';
import { push } from './commands/push.js';
import { optimize } from './commands/optimize.js';
import { init } from './commands/init.js';
import { installSkills } from './commands/install-skills.js';
import { login } from './commands/login.js';
import { doctor } from './commands/doctor.js';
import { promptsAudit } from './commands/prompts-audit.js';
import { deadCode } from './commands/dead-code.js';
import { sessions } from './commands/sessions.js';
import { deps } from './commands/deps.js';
import { gitIntel } from './commands/git-intel.js';
import { schema } from './commands/schema.js';
import { logs } from './commands/logs.js';
import { envSync } from './commands/env-sync.js';
import { health } from './commands/health.js';
import { context } from './commands/context.js';
import { costs } from './commands/costs.js';
import { models } from './commands/models.js';
import { setup } from './commands/setup.js';
import { audit } from './commands/audit.js';

const VERSION = '1.1.0'; // Vibe Coder Toolkit — 22 commands

async function main() {
  const command = process.argv[2];

  if (command === '--version' || command === '-v') {
    console.log(`promptreports-cli v${VERSION}`);
    process.exit(0);
  }

  if (command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    process.exit(0);
  }

  switch (command) {
    case 'scan':       return scan(process.argv.slice(3));
    case 'push':       return push(process.argv.slice(3));
    case 'optimize':   return optimize(process.argv.slice(3));
    case 'init':       return init(process.argv.slice(3));
    case 'install-skills': return installSkills(process.argv.slice(3));
    case 'login':      return login(process.argv.slice(3));
    case 'doctor':     return doctor(process.argv.slice(3));
    case 'prompts-audit': return promptsAudit(process.argv.slice(3));
    case 'dead-code':  return deadCode(process.argv.slice(3));
    case 'sessions':   return sessions(process.argv.slice(3));
    case 'deps':       return deps(process.argv.slice(3));
    case 'git-intel':  return gitIntel(process.argv.slice(3));
    case 'schema':     return schema(process.argv.slice(3));
    case 'logs':       return logs(process.argv.slice(3));
    case 'env-sync':   return envSync(process.argv.slice(3));
    case 'health':     return health(process.argv.slice(3));
    case 'context':    return context(process.argv.slice(3));
    case 'costs':      return costs(process.argv.slice(3));
    case 'models':     return models(process.argv.slice(3));
    case 'setup':      return setup(process.argv.slice(3));
    case 'providers':  return scan(process.argv.slice(3)); // alias for scan
    case 'audit':      return audit(process.argv.slice(3));
    default:
      return summary(process.argv.slice(2));
  }
}

function printHelp() {
  console.log(`
  promptreports-cli v${VERSION} — Vibe Coding Infrastructure Optimizer

  USAGE
    npx promptreports-cli [command] [options]

  CORE
    (default)          Token usage summary (last 7 days)
    scan / providers   Full provider cost scan (22+ services)
    push               Push stats to promptreports.ai
    doctor             Diagnose setup issues
    audit              Claude Code expert audit (score 0-100)

  ENVIRONMENT & SETUP
    env-sync           Compare .env.local vs Vercel env vars
    health             Post-deploy health check (score 0-100)
    setup export       Export machine config (encrypted)
    setup import       Import config on a new machine
    logs               Unified log stream (Sentry, Vercel, PostHog)

  INTELLIGENCE
    context            Context window optimizer
    costs              Cost attribution (--by model/commit/feature)
    models             Model router tuner with downgrade suggestions
    prompts-audit      Detect prompt drift and deprecated models

  CODEBASE ANALYSIS
    dead-code          Find dead routes, unused components, zombie deps
    deps               Dependency audit, outdated, unused, licenses
    schema             Prisma schema stats and drift detection
    git-intel          Git hotspots, velocity, debt, patterns

  SESSION TOOLS
    sessions           Session replay, search, and history

  OTHER
    optimize           AI optimization recommendations
    init               Interactive setup wizard
    install-skills     Install .claude/skills/ templates
    login              Set PromptReports.ai API key
    help               Show this help

  GLOBAL FLAGS
    --days N           Lookback period (default: 7)
    --today            Today only (shorthand for --days 1)
    --json             Output JSON for processing
    --dry-run          Preview changes without writing

  EXAMPLES
    npx promptreports-cli                                 # Token summary
    npx promptreports-cli providers --days 30             # 30-day provider costs
    npx promptreports-cli env-sync --diff                 # Show env drift
    npx promptreports-cli health                          # Post-deploy check
    npx promptreports-cli costs --by model                # Cost by AI model
    npx promptreports-cli costs --by commit               # Cost per git commit
    npx promptreports-cli context                         # Context window analysis
    npx promptreports-cli models                          # Model optimization tips
    npx promptreports-cli prompts-audit                   # Prompt drift scan
    npx promptreports-cli dead-code                       # Find dead code
    npx promptreports-cli sessions --list                 # Session history
    npx promptreports-cli sessions --replay abc123        # Replay a session
    npx promptreports-cli sessions --search "prisma"      # Search sessions
    npx promptreports-cli logs --source sentry            # Sentry errors only
    npx promptreports-cli logs --since 1h --level error   # Errors in last hour
    npx promptreports-cli deps --audit                    # Security audit
    npx promptreports-cli deps --outdated                 # Check for updates
    npx promptreports-cli schema --drift                  # Schema vs DB
    npx promptreports-cli git-intel                       # Full git analysis
    npx promptreports-cli git-intel --changelog           # Auto changelog
    npx promptreports-cli setup export --all --encrypt pw # Export encrypted config
    npx promptreports-cli setup import bundle.json        # Import on new machine
    npx promptreports-cli push --dry-run                  # Preview push

  DASHBOARD
    https://promptreports.ai/swarm/toolkit
`);
}

main().catch((err) => {
  console.error(`  Error: ${err.message}`);
  process.exit(1);
});
