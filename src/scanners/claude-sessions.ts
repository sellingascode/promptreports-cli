/**
 * Claude Code session scanner — reads ~/.claude/projects/ JSONL files
 * Extracted from tools/model-token-tracker.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface TurnRecord {
  turnNumber: number;
  timestamp: string;
  role: 'user' | 'assistant';
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  costUsd: number;
  model?: string;
  userPromptPreview: string;
  sessionId?: string;
}

export interface SessionStats {
  sessionId: string;
  projectPath: string;
  startTime: string;
  endTime: string;
  messageCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  turns: TurnRecord[];
  cacheHitRate: number;
}

// Pricing (Opus 4.6 PAYG)
const PRICING = {
  input: 15 / 1_000_000,
  output: 75 / 1_000_000,
  cacheWrite: 18.75 / 1_000_000,
  cacheRead: 1.5 / 1_000_000,
};

export function scanClaudeSessions(days: number): SessionStats[] {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(claudeDir)) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const allStats: SessionStats[] = [];
  const projectDirs = fs.readdirSync(claudeDir).filter(d => {
    try { return fs.statSync(path.join(claudeDir, d)).isDirectory(); } catch { return false; }
  });

  for (const projDir of projectDirs) {
    const projPath = path.join(claudeDir, projDir);
    const files = fs.readdirSync(projPath).filter(f => f.endsWith('.jsonl'));

    for (const file of files) {
      const filePath = path.join(projPath, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtime < cutoff) continue;

        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        const entries = lines.map(line => {
          try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean);

        const stats = analyzeSession(entries, file, projDir);
        if (stats && stats.turns.length > 0) {
          allStats.push(stats);
        }
      } catch {}
    }
  }

  return allStats.sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);
}

function analyzeSession(entries: any[], sessionId: string, projectPath: string): SessionStats | null {
  const turns: TurnRecord[] = [];
  let turnNumber = 0;
  let lastUserPrompt = '';

  for (const entry of entries) {
    if (!entry?.message?.role) continue;
    const msg = entry.message;

    if (msg.role === 'user') {
      const text = msg.content?.[0]?.text || '';
      lastUserPrompt = text.slice(0, 80);
    }

    if (msg.role === 'assistant' && msg.usage) {
      turnNumber++;
      const u = msg.usage;
      const input = u.input_tokens || 0;
      const output = u.output_tokens || 0;
      const cacheWrite = u.cache_creation_input_tokens || 0;
      const cacheRead = u.cache_read_input_tokens || 0;
      const total = input + output + cacheWrite + cacheRead;
      const cost = input * PRICING.input + output * PRICING.output +
                   cacheWrite * PRICING.cacheWrite + cacheRead * PRICING.cacheRead;

      turns.push({
        turnNumber,
        timestamp: entry.timestamp || '',
        role: 'assistant',
        inputTokens: input,
        outputTokens: output,
        cacheWriteTokens: cacheWrite,
        cacheReadTokens: cacheRead,
        totalTokens: total,
        costUsd: cost,
        model: msg.model || '',
        userPromptPreview: lastUserPrompt,
        sessionId,
      });
    }
  }

  if (turns.length === 0) return null;

  const totalInput = turns.reduce((s, t) => s + t.inputTokens, 0);
  const totalOutput = turns.reduce((s, t) => s + t.outputTokens, 0);
  const totalCacheWrite = turns.reduce((s, t) => s + t.cacheWriteTokens, 0);
  const totalCacheRead = turns.reduce((s, t) => s + t.cacheReadTokens, 0);
  const totalTokens = turns.reduce((s, t) => s + t.totalTokens, 0);
  const totalCost = turns.reduce((s, t) => s + t.costUsd, 0);
  const allInput = totalInput + totalCacheWrite + totalCacheRead;
  const cacheHitRate = allInput > 0 ? (totalCacheRead / allInput) * 100 : 0;

  return {
    sessionId,
    projectPath,
    startTime: turns[0]?.timestamp || '',
    endTime: turns[turns.length - 1]?.timestamp || '',
    messageCount: turnNumber,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalTokens,
    estimatedCostUsd: totalCost,
    turns,
    cacheHitRate,
  };
}
