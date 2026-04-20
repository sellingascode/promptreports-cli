/**
 * campaign command — launch, list, and check demand-gen campaigns from the CLI.
 *
 * Usage:
 *   promptreports campaign launch <feature>         # kick off a manual launch campaign
 *   promptreports campaign launch npm:<pkg>         # launch from npm release
 *   promptreports campaign list                     # list your campaigns
 *   promptreports campaign show <id>                # show one campaign
 *
 * Auth:
 *   PROMPTREPORTS_API_KEY env var (same as other commands)
 *   PROMPTREPORTS_API_URL  override (default: https://promptreports.ai)
 */
import type { GlobalFlags } from '../cli';
import { colorize } from '../utils/format';

const DEFAULT_BASE = 'https://promptreports.ai';
const DEFAULT_CHANNELS = ['email', 'twitter', 'linkedin', 'reddit', 'hackernews', 'devto'];

interface ApiCampaign {
  id: string;
  name: string;
  status: string;
  type: string;
  triggerType: string;
  createdAt: string;
}

function getBaseUrl(): string {
  return process.env.PROMPTREPORTS_API_URL || DEFAULT_BASE;
}

function requireApiKey(): string {
  const key = process.env.PROMPTREPORTS_API_KEY;
  if (!key) {
    console.error(
      colorize('✗ ', 'red') +
        'PROMPTREPORTS_API_KEY is not set. Generate one at https://promptreports.ai/settings/api-keys.'
    );
    process.exit(1);
  }
  return key;
}

async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: T }> {
  const url = `${getBaseUrl()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${requireApiKey()}`,
      ...(init.headers ?? {}),
    },
  });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { ok: res.ok, status: res.status, data: data as T };
}

// ─── Subcommands ────────────────────────────────────────────────────────────

async function launch(feature: string, flags: GlobalFlags): Promise<void> {
  if (!feature) {
    console.error('Usage: promptreports campaign launch <feature>');
    process.exit(1);
  }

  let name = feature;
  let triggerType: 'manual' | 'npm_release' = 'manual';
  let sourceMetadata: Record<string, unknown> = { feature };

  // Shorthand: `npm:<pkg>` → npm_release trigger
  if (feature.startsWith('npm:')) {
    const pkg = feature.slice(4);
    name = `${pkg} launch`;
    triggerType = 'npm_release';
    sourceMetadata = { package: pkg };
  }

  if (flags.dryRun) {
    console.log(colorize('[dry-run] ', 'gray') + `Would POST to ${getBaseUrl()}/api/campaigns`);
    console.log(JSON.stringify({ name, triggerType, sourceMetadata, channels: DEFAULT_CHANNELS }, null, 2));
    return;
  }

  console.log(colorize('→ ', 'cyan') + `Creating campaign "${name}"...`);

  const { ok, status, data } = await apiFetch<{ campaign?: ApiCampaign; error?: string }>(
    '/api/campaigns',
    {
      method: 'POST',
      body: JSON.stringify({
        name,
        description: `Launched from CLI — ${feature}`,
        type: triggerType === 'npm_release' ? 'launch' : 'announcement',
        triggerType,
        sourceFeature: triggerType,
        channels: DEFAULT_CHANNELS,
      }),
    }
  );

  if (!ok || !data.campaign) {
    console.error(
      colorize('✗ ', 'red') + `Failed (${status}): ${data.error ?? 'unknown error'}`
    );
    process.exit(1);
  }

  const campaign = data.campaign;
  console.log(colorize('✓ ', 'green') + `Campaign created: ${campaign.id}`);
  console.log(`   name:    ${campaign.name}`);
  console.log(`   status:  ${campaign.status}`);
  console.log(`   url:     ${getBaseUrl()}/campaigns/${campaign.id}`);

  // Kick off content generation so drafts are ready by the time the user opens the UI.
  console.log(colorize('→ ', 'cyan') + 'Triggering content generation...');
  const gen = await apiFetch(`/api/campaigns/${campaign.id}/generate-content`, {
    method: 'POST',
    body: JSON.stringify({
      feature: {
        name,
        ...sourceMetadata,
      },
    }),
  });
  if (!gen.ok) {
    console.log(colorize('⚠ ', 'yellow') + 'Content generation request failed — you can retry from the dashboard.');
  } else {
    console.log(colorize('✓ ', 'green') + 'Content generation queued.');
  }
}

async function list(flags: GlobalFlags): Promise<void> {
  const { ok, status, data } = await apiFetch<{
    campaigns?: ApiCampaign[];
    error?: string;
  }>('/api/campaigns?limit=50');

  if (!ok) {
    console.error(colorize('✗ ', 'red') + `Failed (${status}): ${data.error ?? 'unknown error'}`);
    process.exit(1);
  }

  const campaigns = data.campaigns ?? [];

  if (flags.json) {
    console.log(JSON.stringify(campaigns, null, 2));
    return;
  }

  if (campaigns.length === 0) {
    console.log(colorize('(no campaigns — run `promptreports campaign launch <feature>`)', 'gray'));
    return;
  }
  console.log(colorize(`Campaigns (${campaigns.length}):`, 'cyan'));
  for (const c of campaigns) {
    const statusColor: 'green' | 'yellow' | 'cyan' | 'gray' =
      c.status === 'active' ? 'green' : c.status === 'paused' ? 'yellow' : c.status === 'completed' ? 'cyan' : 'gray';
    console.log(
      `  ${colorize(c.status.padEnd(10), statusColor)} ${c.name}  ${colorize(`(${c.id})`, 'gray')}`
    );
  }
}

async function show(id: string, flags: GlobalFlags): Promise<void> {
  if (!id) {
    console.error('Usage: promptreports campaign show <id>');
    process.exit(1);
  }
  const { ok, status, data } = await apiFetch<{
    campaign?: ApiCampaign & { description?: string | null };
    error?: string;
  }>(`/api/campaigns/${encodeURIComponent(id)}`);
  if (!ok || !data.campaign) {
    console.error(colorize('✗ ', 'red') + `Failed (${status}): ${data.error ?? 'not found'}`);
    process.exit(1);
  }
  if (flags.json) {
    console.log(JSON.stringify(data.campaign, null, 2));
    return;
  }
  const c = data.campaign;
  console.log(`${colorize(c.name, 'cyan')}  ${colorize(`[${c.status}]`, 'gray')}`);
  if (c.description) console.log(`  ${c.description}`);
  console.log(`  ${colorize('id', 'gray')}      ${c.id}`);
  console.log(`  ${colorize('type', 'gray')}    ${c.type}`);
  console.log(`  ${colorize('trigger', 'gray')} ${c.triggerType}`);
  console.log(`  ${colorize('url', 'gray')}     ${getBaseUrl()}/campaigns/${c.id}`);
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

export async function campaignCommand(flags: GlobalFlags): Promise<void> {
  const [sub, ...rest] = flags.args;
  switch (sub) {
    case 'launch':
      await launch(rest[0] ?? '', flags);
      break;
    case 'list':
    case 'ls':
      await list(flags);
      break;
    case 'show':
    case 'get':
      await show(rest[0] ?? '', flags);
      break;
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      console.error(`Unknown campaign subcommand: ${sub}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
${colorize('promptreports campaign', 'cyan')} — demand-gen campaign manager

${colorize('USAGE', 'gray')}
  promptreports campaign launch <feature>      Create and kick off a campaign
  promptreports campaign launch npm:<pkg>      Launch as npm release
  promptreports campaign list                  List campaigns
  promptreports campaign show <id>             Show one campaign

${colorize('ENV', 'gray')}
  PROMPTREPORTS_API_KEY                        Required — your API key
  PROMPTREPORTS_API_URL                        Override (default: ${DEFAULT_BASE})

${colorize('FLAGS', 'gray')}
  --dry-run                                    Print request, don't send
  --json                                       JSON output (list/show)
`);
}
