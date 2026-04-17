#!/usr/bin/env node

/**
 * @promptreports/cli — Vibe Coding Infrastructure Optimizer
 *
 * Zero config. Zero dependencies. Works first run.
 *
 * Usage:
 *   npx @promptreports/cli              # Summary, last 7 days
 *   npx @promptreports/cli scan         # Full scan: tokens + providers
 *   npx @promptreports/cli push         # Push to promptreports.ai
 *   npx @promptreports/cli optimize     # AI optimization recommendations
 *   npx @promptreports/cli init         # Interactive setup wizard
 *   npx @promptreports/cli install-skills  # Install .claude/skills/
 */

import { summary } from './commands/summary.js';
import { scan } from './commands/scan.js';
import { push } from './commands/push.js';
import { optimize } from './commands/optimize.js';
import { init } from './commands/init.js';
import { installSkills } from './commands/install-skills.js';
import { login } from './commands/login.js';
import { doctor } from './commands/doctor.js';

const VERSION = '1.0.0';

async function main() {
  const command = process.argv[2];

  if (command === '--version' || command === '-v') {
    console.log(`@promptreports/cli v${VERSION}`);
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
    default:
      return summary(process.argv.slice(2));
  }
}

function printHelp() {
  console.log(`
  @promptreports/cli — Vibe Coding Infrastructure Optimizer

  USAGE
    npx @promptreports/cli [command] [options]

  COMMANDS
    (default)        Token usage summary (last 7 days)
    scan             Full scan: tokens + providers + logs
    push             Push stats to promptreports.ai
    optimize         AI optimization recommendations
    init             Interactive setup wizard
    install-skills   Install .claude/skills/ templates
    login            Set PromptReports.ai API key
    doctor           Diagnose setup issues
    help             Show this help

  OPTIONS (default command)
    --days N         Lookback period (default: 7)
    --today          Today only
    --turns          Per-turn detail log
    --commits        Cost per git commit
    --tips           Token reduction tips
    --fix            Hotspot analysis
    --json           Export to JSON file

  OPTIONS (scan)
    --providers      Provider billing only
    --logs           Logs from Sentry, Vercel, GitHub
    --billing        Stripe revenue + all costs
    --all            Everything

  OPTIONS (push)
    --all            Push tokens + providers + logs
    --dry-run        Show what would be pushed

  EXAMPLES
    npx @promptreports/cli                        # Quick summary
    npx @promptreports/cli --days 30 --commits    # 30-day cost per commit
    npx @promptreports/cli scan --all             # Full scan
    npx @promptreports/cli push --all             # Push everything
    npx @promptreports/cli init --full            # Full setup in one command

  DOCS
    https://promptreports.ai/docs/cli
`);
}

main().catch((err) => {
  console.error(`  Error: ${err.message}`);
  process.exit(1);
});
