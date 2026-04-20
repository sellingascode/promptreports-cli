#!/usr/bin/env node
/**
 * promptreports-cli — Vibe coding intelligence.
 *
 * Unified ops, cost tracking, environment sync, and developer tools.
 * Zero external dependencies.
 */

import { summaryCommand } from './commands/summary';
import { pushCommand } from './commands/push';
import { providersCommand } from './commands/providers';
import { doctorCommand } from './commands/doctor';
import { envSyncCommand } from './commands/env-sync';
import { logsCommand } from './commands/logs';
import { setupCommand } from './commands/setup';
import { healthCommand } from './commands/health';
import { contextCommand } from './commands/context';
import { costsCommand } from './commands/costs';
import { promptsCommand } from './commands/prompts';
import { deadCodeCommand } from './commands/dead-code';
import { sessionsCommand } from './commands/sessions';
import { depsCommand } from './commands/deps';
import { schemaCommand } from './commands/schema';
import { modelsCommand } from './commands/models';
import { gitIntelCommand } from './commands/git-intel';
import { auditCommand } from './commands/audit';
import { filterCommand } from './commands/filter';
import { campaignCommand } from './commands/campaign';
import { colorize } from './utils/format';

// ─── Global Flags ───────────────────────────────────────────────────────────

export interface GlobalFlags {
  days: number;
  json: boolean;
  quiet: boolean;
  dryRun: boolean;
  /** Raw args after the command name */
  args: string[];
}

function parseGlobalFlags(argv: string[]): { command: string; subcommand: string; flags: GlobalFlags } {
  const args = argv.slice(2); // skip node + script

  let days = 7;
  let json = false;
  let quiet = false;
  let dryRun = false;

  const remaining: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--days' && i + 1 < args.length) {
      days = parseInt(args[i + 1], 10) || 7;
      i++;
    } else if (arg === '--today') {
      days = 1;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--quiet') {
      quiet = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else {
      remaining.push(arg);
    }
  }

  const command = remaining[0] || 'summary';
  const subcommand = remaining[1] || '';
  const restArgs = remaining.slice(1);

  return {
    command,
    subcommand,
    flags: { days, json, quiet, dryRun, args: restArgs },
  };
}

// ─── Help Text ──────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log('');
  console.log(colorize('  promptreports-cli', 'bold') + colorize(' v1.2.4', 'dim'));
  console.log(colorize('  Vibe coding intelligence for developers', 'dim'));
  console.log('');
  console.log(colorize('  CORE', 'bold'));
  console.log('    summary              Token usage summary (default)');
  console.log('    push                 Push stats to PromptReports.ai');
  console.log('    providers            Provider cost scan');
  console.log('    doctor               System health check');
  console.log('    audit                Claude Code expert audit (.claude, skills, env)');
  console.log('    audit claude-md      Deep CLAUDE.md slim-down analysis (NEW)');
  console.log('    filter -- <cmd>      Compress subprocess output before your agent reads it (NEW)');
  console.log('    campaign             Launch & inspect demand-gen campaigns (launch|list|show)');
  console.log('');
  console.log(colorize('  ENVIRONMENT & SETUP', 'bold'));
  console.log('    env sync             Sync .env.local with Vercel/Railway');
  console.log('    setup export         Export machine config (encrypted)');
  console.log('    setup import         Import config on a new machine');
  console.log('    health               Post-deploy health check');
  console.log('');
  console.log(colorize('  INTELLIGENCE', 'bold'));
  console.log('    context              Context window optimizer');
  console.log('    context --ghosts     Find silent waste in session files (NEW)');
  console.log('    costs                Cost attribution by feature/model/commit');
  console.log('    models               Model router — suggest cheaper models');
  console.log('    prompts audit        Prompt drift detector');
  console.log('');
  console.log(colorize('  CODEBASE ANALYSIS', 'bold'));
  console.log('    dead-code            Find unused routes, components, deps');
  console.log('    deps                 Dependency audit, outdated, licenses');
  console.log('    schema               Prisma schema stats & drift detection');
  console.log('    git-intel            Git patterns, hotspots, velocity');
  console.log('');
  console.log(colorize('  SESSION TOOLS', 'bold'));
  console.log('    sessions             Session history, replay, search');
  console.log('    logs                 Unified log stream (Sentry/Vercel/PostHog)');
  console.log('');
  console.log(colorize('  GLOBAL FLAGS', 'bold'));
  console.log('    --days N             Lookback period in days (default: 7)');
  console.log('    --today              Shorthand for --days 1');
  console.log('    --json               Output JSON instead of formatted text');
  console.log('    --quiet              Suppress non-essential output');
  console.log('    --dry-run            Preview changes without writing');
  console.log('');
  console.log(colorize('  EXAMPLES', 'bold'));
  console.log('    promptreports                            # Token summary');
  console.log('    promptreports providers --days 30        # 30-day provider costs');
  console.log('    promptreports env sync --diff            # Show env drift');
  console.log('    promptreports health                     # Post-deploy check');
  console.log('    promptreports costs --by model           # Cost by AI model');
  console.log('    promptreports costs --by commit          # Cost per git commit');
  console.log('    promptreports costs --push-to-app        # Push correlated payload to Token Forensics');
  console.log('    promptreports context                    # Context window analysis');
  console.log('    promptreports models                     # Model optimization tips');
  console.log('    promptreports prompts audit              # Prompt drift scan');
  console.log('    promptreports dead-code                  # Find dead code');
  console.log('    promptreports sessions --list            # Session history');
  console.log('    promptreports sessions --replay abc123   # Replay a session');
  console.log('    promptreports sessions --search "prisma" # Search sessions');
  console.log('    promptreports logs --source sentry       # Sentry errors only');
  console.log('    promptreports logs --since 1h --level error');
  console.log('    promptreports deps --audit               # Security audit');
  console.log('    promptreports deps --outdated            # Check for updates');
  console.log('    promptreports schema --drift             # Schema vs DB');
  console.log('    promptreports git-intel                  # Full git analysis');
  console.log('    promptreports git-intel --changelog      # Auto changelog');
  console.log('    promptreports setup export --all --encrypt mypass');
  console.log('    promptreports setup import bundle.json --decrypt mypass');
  console.log('    promptreports doctor                     # System check');
  console.log('    promptreports audit                      # Claude Code expert audit');
  console.log('    promptreports audit claude-md            # Deep CLAUDE.md slim-down analysis');
  console.log('    promptreports audit --push               # Audit + push to Command Center');
  console.log('    promptreports audit --json               # JSON audit results');
  console.log('    promptreports context --ghosts           # Find silent token waste');
  console.log('    promptreports filter -- npm test         # Compress noisy test output');
  console.log('    promptreports filter -- playwright test  # Dedupe stack frames, truncate blocks');
  console.log('    promptreports campaign launch "V2 export flow"   # Launch a campaign');
  console.log('    promptreports campaign launch npm:my-package     # Trigger from npm release');
  console.log('    promptreports campaign list              # List your campaigns');
  console.log('    promptreports campaign show <id>         # Show one campaign');
  console.log('    promptreports push --dry-run             # Preview push');
  console.log('');
}

// ─── Command Router ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { command, subcommand, flags } = parseGlobalFlags(process.argv);

  try {
    switch (command) {
      case 'summary':     await summaryCommand(flags); break;
      case 'push':        await pushCommand(flags); break;
      case 'providers':   await providersCommand(flags); break;
      case 'doctor':      await doctorCommand(flags); break;
      case 'audit':       await auditCommand(flags); break;
      case 'filter':      await filterCommand(flags); break;
      case 'campaign':    await campaignCommand(flags); break;
      case 'env':         await envSyncCommand(flags); break;
      case 'logs':        await logsCommand(flags); break;
      case 'health':      await healthCommand(flags); break;
      case 'context':     await contextCommand(flags); break;
      case 'costs':       await costsCommand(flags); break;
      case 'models':      await modelsCommand(flags); break;
      case 'dead-code':   await deadCodeCommand(flags); break;
      case 'deps':        await depsCommand(flags); break;
      case 'schema':      await schemaCommand(flags); break;
      case 'git-intel':   await gitIntelCommand(flags); break;
      case 'sessions':    await sessionsCommand(flags); break;

      case 'prompts':
        await promptsCommand(flags);
        break;

      case 'setup':
        if (subcommand === 'export' || subcommand === 'import') {
          await setupCommand(subcommand, flags);
        } else {
          console.error(`Unknown setup subcommand: ${subcommand}. Use: setup export|import`);
          process.exit(1);
        }
        break;

      case 'help':
      case '--help':
      case '-h':
        printHelp();
        break;

      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(colorize(`\n  Error: ${message}\n`, 'red'));
    process.exit(1);
  }
}

main();
