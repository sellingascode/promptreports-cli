/**
 * Shared session scanning logic for Claude Code .jsonl files.
 * Extracted from model-token-tracker.ts for reuse across CLI commands.
 * Zero external dependencies — only Node.js built-ins.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Usage {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
}

export interface MessageEntry {
  type: string;
  timestamp: string;
  sessionId: string;
  uuid?: string;
  message?: {
    role: string;
    model?: string;
    usage?: Usage;
    content?: Array<{ type: string; text?: string }>;
  };
  cwd?: string;
}

export interface TurnRecord {
  turnNumber: number;
  timestamp: string;
  role: 'user' | 'assistant';
  inputTokens: number;
  outputTokens: number;
  cacheWrite: number;
  cacheRead: number;
  totalTokens: number;
  model: string;
  contentTypes: string[];
  userPromptPreview: string;
  cumulativeTokens: number;
  costUsd: number;
  sessionId: string;
  efficiencyScore: number;
  /** Cross-system correlation — populated when buildPayload() is called with commit data. */
  gitCommitHash?: string;
  gitCommitMessage?: string;
  gitCommitAuthor?: string;
  gitCommitDate?: string;
  openrouterRequestId?: string;
}

export interface GitCommitInfo {
  hash: string;
  date: string;
  subject: string;
  author: string;
  /** Epoch ms — precomputed so we don't re-parse on every turn. */
  timeMs: number;
}

export interface SessionStats {
  sessionId: string;
  project: string;
  startedAt: string;
  endedAt: string;
  messageCount: number;
  userMessages: number;
  assistantMessages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreation: number;
  totalCacheRead: number;
  totalTokens: number;
  model: string;
  estimatedCostUsd: number;
  cacheHitRate: number;
  tokensPerMessage: number;
  turns: TurnRecord[];
  longestUserMessage: number;
  longestAssistantResponse: number;
  avgOutputPerTurn: number;
  peakCacheWriteTurn: number;
  sessionDurationMinutes: number;
}

export interface PlatformPayload {
  collectedAt: string;
  periodDays: number;
  source: string;
  pushId?: string;
  aggregate: {
    sessions: number;
    messages: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheWrite: number;
    cacheRead: number;
    cacheHitRate: number;
    estimatedCostUsd: number;
  };
  sessions: Array<{
    sessionId: string;
    startedAt: string;
    endedAt: string;
    messageCount: number;
    totalTokens: number;
    model: string;
    estimatedCostUsd: number;
    cacheHitRate: number;
    gitCommitHash?: string;
    gitCommitMessage?: string;
    openrouterRequestCount?: number;
    modelMix?: Record<string, number>;
  }>;
  turns: TurnRecord[];
  suggestions: string[];
  patterns: {
    outputToInputRatio: number;
    cacheCreationPercent: number;
    avgSessionLength: number;
    opusPercent: number;
    longSessions: number;
  };
  commits?: Array<{
    hash: string;
    message: string;
    date: string;
    author: string;
    filesChanged: number;
    linesAdded: number;
    linesRemoved: number;
    turns: number;
    tokens: number;
    costUsd: number;
    avgCostPerTurn: number;
    efficiency: number;
  }>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CLAUDE_DIR = join(homedir(), '.claude');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');

/** Opus 4.6 pricing per million tokens */
export const PRICING = {
  input: 15.0,
  output: 75.0,
  cacheWrite: 18.75,
  cacheRead: 1.50,
};

// ─── Scanning ───────────────────────────────────────────────────────────────

/**
 * Scan ~/.claude/projects/ for .jsonl session files.
 * Returns file paths sorted by modification time (newest first).
 */
export function scanProjectSessions(days: number = 7): string[] {
  const jsonlFiles: string[] = [];
  if (!existsSync(PROJECTS_DIR)) return jsonlFiles;

  for (const project of readdirSync(PROJECTS_DIR)) {
    const projectDir = join(PROJECTS_DIR, project);
    try {
      if (!statSync(projectDir).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const file of readdirSync(projectDir)) {
      if (file.endsWith('.jsonl')) {
        jsonlFiles.push(join(projectDir, file));
      }
    }
  }

  return jsonlFiles;
}

/**
 * Parse a .jsonl file into MessageEntry[].
 */
export function parseSession(filePath: string): MessageEntry[] {
  const entries: MessageEntry[] = [];
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return entries;
  }

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }
  return entries;
}

/**
 * Calculate cost for a single Usage object.
 */
export function costForUsage(u: Usage): number {
  return ((u.input_tokens || 0) / 1e6) * PRICING.input
    + ((u.output_tokens || 0) / 1e6) * PRICING.output
    + ((u.cache_creation_input_tokens || 0) / 1e6) * PRICING.cacheWrite
    + ((u.cache_read_input_tokens || 0) / 1e6) * PRICING.cacheRead;
}

/**
 * Estimate token count from a string (rough: 1 token ~= 4 chars).
 */
function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 4);
}

/**
 * Analyze a session's message entries and return SessionStats.
 * Filters to entries within the given `days` window.
 */
export function analyzeSession(entries: MessageEntry[], days: number = 7): SessionStats | null {
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  const filtered = entries.filter(e => e.timestamp && new Date(e.timestamp).getTime() >= cutoff);
  if (filtered.length === 0) return null;

  const sessionId = filtered[0]?.sessionId || 'unknown';
  const project = basename(filtered[0]?.cwd || 'unknown');

  const turns: TurnRecord[] = [];
  let totalInput = 0, totalOutput = 0, totalCacheCreate = 0, totalCacheRead = 0;
  let userMessages = 0, assistantMessages = 0;
  let longestUser = 0, longestAssistant = 0;
  let model = 'unknown';
  let peakCacheWrite = 0, peakCacheWriteTurn = 0;
  let cumulative = 0;
  let turnNum = 0;
  let lastUserPrompt = '';

  for (const entry of filtered) {
    if (entry.type === 'user') {
      userMessages++;
      const content = entry.message?.content;
      let preview = '';
      if (Array.isArray(content)) {
        preview = content.map(c => c.text || '').join(' ').slice(0, 120);
        const tokens = estimateTokens(preview);
        if (tokens > longestUser) longestUser = tokens;
      } else if (typeof content === 'string') {
        preview = (content as string).slice(0, 120);
      }
      lastUserPrompt = preview;
    }

    if (entry.type === 'assistant' && entry.message?.usage) {
      assistantMessages++;
      turnNum++;
      const u = entry.message.usage;
      const turnInput = u.input_tokens || 0;
      const turnOutput = u.output_tokens || 0;
      const turnCacheWrite = u.cache_creation_input_tokens || 0;
      const turnCacheRead = u.cache_read_input_tokens || 0;
      const turnTotal = turnInput + turnOutput + turnCacheWrite;

      totalInput += turnInput;
      totalOutput += turnOutput;
      totalCacheCreate += turnCacheWrite;
      totalCacheRead += turnCacheRead;
      cumulative += turnTotal;

      if (turnOutput > longestAssistant) longestAssistant = turnOutput;
      if (turnCacheWrite > peakCacheWrite) { peakCacheWrite = turnCacheWrite; peakCacheWriteTurn = turnNum; }
      if (entry.message.model) model = entry.message.model;

      const contentTypes = Array.isArray(entry.message.content)
        ? entry.message.content.map(c => c.type).filter(Boolean)
        : [];

      const turnCost = costForUsage(u);

      // Efficiency score 0-100
      const inputScore = Math.max(0, 100 - (turnInput / 500) * 100);
      const costScore = Math.max(0, 100 - (turnCost / 0.50) * 100);
      const cacheScore = (turnCacheRead / Math.max(1, turnCacheRead + turnCacheWrite + turnInput)) * 100;
      const outputScore = Math.max(0, 100 - (turnOutput / 2000) * 100);
      const efficiencyScore = Math.round(
        inputScore * 0.25 + costScore * 0.25 + cacheScore * 0.25 + outputScore * 0.25
      );

      turns.push({
        turnNumber: turnNum,
        timestamp: entry.timestamp,
        role: 'assistant',
        inputTokens: turnInput,
        outputTokens: turnOutput,
        cacheWrite: turnCacheWrite,
        cacheRead: turnCacheRead,
        totalTokens: turnTotal,
        model: entry.message.model || model,
        contentTypes,
        userPromptPreview: lastUserPrompt,
        cumulativeTokens: cumulative,
        costUsd: turnCost,
        sessionId,
        efficiencyScore: Math.max(0, Math.min(100, efficiencyScore)),
      });
    }
  }

  const messageCount = userMessages + assistantMessages;
  if (messageCount === 0) return null;

  const totalTokens = totalInput + totalOutput + totalCacheCreate;
  const totalInputAll = totalInput + totalCacheCreate + totalCacheRead;
  const cacheHitRate = totalInputAll > 0 ? totalCacheRead / totalInputAll : 0;
  const estimatedCostUsd = ((totalInput / 1e6) * PRICING.input) + ((totalOutput / 1e6) * PRICING.output)
    + ((totalCacheCreate / 1e6) * PRICING.cacheWrite) + ((totalCacheRead / 1e6) * PRICING.cacheRead);

  const timestamps = filtered.filter(e => e.timestamp).map(e => new Date(e.timestamp).getTime());
  const duration = timestamps.length > 1 ? (Math.max(...timestamps) - Math.min(...timestamps)) / 60000 : 0;

  return {
    sessionId,
    project,
    startedAt: filtered[0]?.timestamp || '',
    endedAt: filtered[filtered.length - 1]?.timestamp || '',
    messageCount,
    userMessages,
    assistantMessages,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalCacheCreation: totalCacheCreate,
    totalCacheRead: totalCacheRead,
    totalTokens,
    model,
    estimatedCostUsd,
    cacheHitRate,
    tokensPerMessage: messageCount > 0 ? Math.round(totalTokens / messageCount) : 0,
    turns,
    longestUserMessage: longestUser,
    longestAssistantResponse: longestAssistant,
    avgOutputPerTurn: assistantMessages > 0 ? Math.round(totalOutput / assistantMessages) : 0,
    peakCacheWriteTurn,
    sessionDurationMinutes: Math.round(duration),
  };
}

/**
 * Load git commits for the current repo within a time window.
 * Returns [] outside a git repo or on any execSync failure — never throws.
 */
export function loadGitCommits(days: number): GitCommitInfo[] {
  try {
    const log = execSync(`git log --format="%H|%aI|%s|%an" --since="${days} days ago"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return log.trim().split('\n').filter(Boolean).map(line => {
      const [hash, date, subject, author] = line.split('|');
      return {
        hash: hash || '',
        date: date || '',
        subject: subject || '',
        author: author || '',
        timeMs: date ? new Date(date).getTime() : 0,
      };
    }).filter(c => c.hash && c.timeMs > 0);
  } catch {
    return [];
  }
}

/**
 * Pick the commit whose timestamp lies within `windowMs` of `turnTimeMs` and is
 * closest to it. Prefers commits *after* the turn (likely caused by it); falls
 * back to the most recent prior commit. Returns null if nothing is in range.
 */
export function correlateCommit(turnTimeMs: number, commits: GitCommitInfo[], windowMs = 3600000): GitCommitInfo | null {
  if (!commits.length || !turnTimeMs) return null;
  let best: GitCommitInfo | null = null;
  let bestDist = Infinity;
  for (const c of commits) {
    const dist = Math.abs(c.timeMs - turnTimeMs);
    if (dist <= windowMs && dist < bestDist) {
      best = c;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Build a PlatformPayload from analyzed session stats.
 *
 * When the CWD is a git repo, each turn is stitched to the nearest commit
 * within ±1h so the platform can render git → session → request → cost traces
 * (see TOKEN_FORENSICS_MOCKUP.html). Non-repo environments silently skip this.
 */
export function buildPayload(stats: SessionStats[], days: number): PlatformPayload {
  const t = stats.reduce((a, s) => ({
    input: a.input + s.totalInputTokens,
    output: a.output + s.totalOutputTokens,
    cw: a.cw + s.totalCacheCreation,
    cr: a.cr + s.totalCacheRead,
    msgs: a.msgs + s.messageCount,
    cost: a.cost + s.estimatedCostUsd,
  }), { input: 0, output: 0, cw: 0, cr: 0, msgs: 0, cost: 0 });

  const total = t.input + t.output + t.cw;
  const allInput = t.input + t.cw + t.cr;
  const cacheHitRate = allInput > 0 ? t.cr / allInput : 0;
  const opusSessions = stats.filter(s => s.model.includes('opus'));
  const cwPct = total > 0 ? (t.cw / total * 100) : 0;

  // Git correlation — load once, re-use across every turn and session.
  const commits = loadGitCommits(days);

  const allTurns: TurnRecord[] = [];
  for (const s of stats) {
    for (const turn of s.turns) {
      const turnTime = turn.timestamp ? new Date(turn.timestamp).getTime() : 0;
      const commit = correlateCommit(turnTime, commits);
      allTurns.push({
        ...turn,
        model: turn.model || s.model,
        ...(commit && {
          gitCommitHash: commit.hash,
          gitCommitMessage: commit.subject,
          gitCommitAuthor: commit.author,
          gitCommitDate: commit.date,
        }),
      });
    }
  }

  // Per-commit rollup so the platform can render a traces panel without
  // re-scanning all turns on every GET.
  const commitRollup = new Map<string, { hash: string; message: string; date: string; author: string; turns: number; tokens: number; costUsd: number }>();
  for (const turn of allTurns) {
    if (!turn.gitCommitHash) continue;
    const k = turn.gitCommitHash;
    let entry = commitRollup.get(k);
    if (!entry) {
      entry = { hash: k, message: turn.gitCommitMessage || '', date: turn.gitCommitDate || '', author: turn.gitCommitAuthor || '', turns: 0, tokens: 0, costUsd: 0 };
      commitRollup.set(k, entry);
    }
    entry.turns += 1;
    entry.tokens += turn.totalTokens;
    entry.costUsd += turn.costUsd;
  }

  // Per-session commit + model-mix rollup so the traces tab can render chain rows.
  const sessionCommitMap = new Map<string, string>();
  const sessionModelMix = new Map<string, Record<string, number>>();
  for (const turn of allTurns) {
    if (turn.gitCommitHash && !sessionCommitMap.has(turn.sessionId)) {
      sessionCommitMap.set(turn.sessionId, turn.gitCommitHash);
    }
    const mix = sessionModelMix.get(turn.sessionId) || {};
    const key = normalizeModelName(turn.model);
    mix[key] = (mix[key] || 0) + 1;
    sessionModelMix.set(turn.sessionId, mix);
  }

  return {
    collectedAt: new Date().toISOString(),
    periodDays: days,
    source: 'promptreports-cli',
    aggregate: {
      sessions: stats.length,
      messages: t.msgs,
      totalTokens: total,
      inputTokens: t.input,
      outputTokens: t.output,
      cacheWrite: t.cw,
      cacheRead: t.cr,
      cacheHitRate,
      estimatedCostUsd: t.cost,
    },
    sessions: stats.map(s => {
      const commitHash = sessionCommitMap.get(s.sessionId);
      const commit = commitHash ? commitRollup.get(commitHash) : undefined;
      return {
        sessionId: s.sessionId,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        messageCount: s.messageCount,
        totalTokens: s.totalTokens,
        model: s.model,
        estimatedCostUsd: s.estimatedCostUsd,
        cacheHitRate: s.cacheHitRate,
        openrouterRequestCount: s.turns.length,
        modelMix: sessionModelMix.get(s.sessionId) || {},
        ...(commit && {
          gitCommitHash: commit.hash,
          gitCommitMessage: commit.message,
        }),
      };
    }),
    turns: allTurns,
    suggestions: generateSuggestions(stats),
    patterns: {
      outputToInputRatio: t.input > 0 ? t.output / t.input : 0,
      cacheCreationPercent: cwPct,
      avgSessionLength: stats.length > 0 ? t.msgs / stats.length : 0,
      opusPercent: stats.length > 0 ? (opusSessions.length / stats.length) * 100 : 0,
      longSessions: stats.filter(s => s.messageCount > 30).length,
    },
    commits: [...commitRollup.values()].map(c => ({
      hash: c.hash,
      message: c.message,
      date: c.date,
      author: c.author,
      filesChanged: 0,
      linesAdded: 0,
      linesRemoved: 0,
      turns: c.turns,
      tokens: c.tokens,
      costUsd: c.costUsd,
      avgCostPerTurn: c.turns > 0 ? c.costUsd / c.turns : 0,
      efficiency: 0,
    })),
  };
}

function normalizeModelName(model: string): string {
  const m = (model || '').toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return m || 'unknown';
}

/**
 * Generate optimization suggestions from session stats.
 */
function generateSuggestions(stats: SessionStats[]): string[] {
  const suggestions: string[] = [];
  const t = stats.reduce((a, s) => ({
    output: a.output + s.totalOutputTokens,
    input: a.input + s.totalInputTokens,
    cw: a.cw + s.totalCacheCreation,
    cr: a.cr + s.totalCacheRead,
    msgs: a.msgs + s.messageCount,
  }), { output: 0, input: 0, cw: 0, cr: 0, msgs: 0 });

  const allInput = t.input + t.cw + t.cr;
  const cacheHitRate = allInput > 0 ? t.cr / allInput : 0;
  const grand = t.output + t.input + t.cw;

  const longSessions = stats.filter(s => s.messageCount > 30);
  if (longSessions.length > 0) {
    suggestions.push(`${longSessions.length} sessions exceed 30 messages. Summarize and restart at message 15-20.`);
  }

  if (t.output > t.input * 2) {
    suggestions.push(`Output is ${(t.output / (t.input || 1)).toFixed(1)}x input. Add "Be concise." to prompts.`);
  }

  const cwPct = grand > 0 ? (t.cw / grand * 100) : 0;
  if (cwPct > 70) {
    suggestions.push(`Cache creation is ${cwPct.toFixed(0)}% of tokens. Trim CLAUDE.md to <2000 words.`);
  }

  if (cacheHitRate < 0.3) {
    suggestions.push(`Cache hit rate ${(cacheHitRate * 100).toFixed(1)}% is low. Use consistent prompt structures.`);
  }

  const opusSessions = stats.filter(s => s.model.includes('opus'));
  if (opusSessions.length > stats.length * 0.8 && stats.length > 2) {
    suggestions.push(`${((opusSessions.length / stats.length) * 100).toFixed(0)}% Opus sessions. Use Sonnet for simple tasks.`);
  }

  const avgOutput = stats.reduce((a, s) => a + s.avgOutputPerTurn, 0) / (stats.length || 1);
  if (avgOutput > 500) {
    suggestions.push(`Average ${Math.round(avgOutput)} output tokens/turn. Use "only output the code, no explanation."`);
  }

  if (suggestions.length === 0) {
    suggestions.push('Usage looks efficient. Cache hit rate is good, sessions are reasonable length.');
  }

  return suggestions;
}
