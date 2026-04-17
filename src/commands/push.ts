/**
 * Push command — Push stats to promptreports.ai
 */

import { loadApiKey } from '../utils/license.js';
import { scanClaudeSessions } from '../scanners/claude-sessions.js';
import { pushToplatform } from '../output/platform-push.js';

export async function push(args: string[]): Promise<void> {
  const dryRun = args.includes('--dry-run');
  const doAll = args.includes('--all');
  const tokenIdx = args.indexOf('--token');
  const oneTimeToken = tokenIdx >= 0 ? args[tokenIdx + 1] : null;

  const apiKey = oneTimeToken || loadApiKey();

  if (!apiKey) {
    console.log(`
  This command requires a PromptReports.ai account.

  Free: npx @promptreports/cli              (always works)
  Paid: npx @promptreports/cli push         (requires API key)

  Get your API key: https://promptreports.ai/settings/api
  Then run: npx @promptreports/cli login
    `);
    return;
  }

  const daysIdx = args.indexOf('--days');
  const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) || 7 : 7;

  console.log('');
  console.log('  Gathering data for push...');

  const sessions = scanClaudeSessions(days);
  if (sessions.length === 0) {
    console.log('  No Claude Code sessions found. Nothing to push.');
    return;
  }

  console.log(`  Found ${sessions.length} sessions with data.`);

  if (dryRun) {
    console.log('');
    console.log('  [DRY RUN] Would push:');
    console.log(`    Sessions: ${sessions.length}`);
    const totalTurns = sessions.reduce((sum, s) => sum + s.turns.length, 0);
    console.log(`    Turns: ${totalTurns}`);
    console.log(`    Period: ${days} days`);
    console.log('');
    console.log('  Run without --dry-run to push.');
    return;
  }

  try {
    const result = await pushToplatform(sessions, apiKey, days);
    console.log(`  ✓ Pushed: ${result.message}`);
    console.log('');
    console.log('  View your dashboard: https://promptreports.ai/swarm/ops-intelligence');
  } catch (err: unknown) {
    console.error(`  ✗ Push failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    console.log('  Check your API key: npx @promptreports/cli doctor');
  }
}
