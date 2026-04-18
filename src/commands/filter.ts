/**
 * filter command — Stream-compresses noisy subprocess output before your agent reads it.
 *
 * Wraps any command and its stdout/stderr. Collapses repeated lines, dedupes stack frames,
 * truncates long passing-test blocks, and preserves errors/warnings. Exit code is passed through.
 *
 * Zero external dependencies. Cross-platform via { shell: true }.
 *
 * Usage:
 *   promptreports filter -- npm test
 *   promptreports filter -- playwright test
 *   promptreports filter -- docker build .
 *   promptreports filter --keep-last 50 -- npm run ci
 */

import { spawn } from 'node:child_process';
import type { GlobalFlags } from '../cli';
import { colorize } from '../utils/format';

const ERROR_KEYWORDS = /\b(error|fail(ed|ure)?|exception|traceback|fatal|panic|rejected|denied|warning)\b/i;
const NODE_WARN = /\(node:\d+\) \[DEP\d+\]/;
const STACK_FRAME = /^\s*at\s+/;
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

interface FilterOptions {
  keepLast: number;
  maxRepeat: number;
  truncateAfter: number;
}

interface CompressionStats {
  inLines: number;
  outLines: number;
  duplicatesCollapsed: number;
  stackFramesCollapsed: number;
  sectionsTruncated: number;
}

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

function normalize(s: string): string {
  return stripAnsi(s).replace(/\s+/g, ' ').trim();
}

function isErrorLike(line: string): boolean {
  const s = stripAnsi(line);
  return ERROR_KEYWORDS.test(s) && !NODE_WARN.test(s);
}

function isStackFrame(line: string): boolean {
  return STACK_FRAME.test(stripAnsi(line));
}

function parseArgs(raw: string[]): { opts: FilterOptions; cmd: string[] } {
  const opts: FilterOptions = { keepLast: 20, maxRepeat: 2, truncateAfter: 50 };
  const cmd: string[] = [];

  let seenDashDash = false;
  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (seenDashDash) { cmd.push(arg); continue; }
    if (arg === '--') { seenDashDash = true; continue; }
    if (arg === 'filter') continue;
    if (arg === '--keep-last' && i + 1 < raw.length) { opts.keepLast = parseInt(raw[++i], 10) || 20; continue; }
    if (arg === '--max-repeat' && i + 1 < raw.length) { opts.maxRepeat = parseInt(raw[++i], 10) || 2; continue; }
    if (arg === '--truncate-after' && i + 1 < raw.length) { opts.truncateAfter = parseInt(raw[++i], 10) || 50; continue; }
    if (arg.startsWith('--')) continue;
    cmd.push(arg);
  }

  return { opts, cmd };
}

/**
 * Compress a captured buffer of output lines. Preserves errors, collapses repeats,
 * truncates long uniform blocks, keeps tail.
 */
function compress(lines: string[], opts: FilterOptions): { output: string[]; stats: CompressionStats } {
  const stats: CompressionStats = {
    inLines: lines.length,
    outLines: 0,
    duplicatesCollapsed: 0,
    stackFramesCollapsed: 0,
    sectionsTruncated: 0,
  };

  const errorLineSet = new Set<number>();
  lines.forEach((l, i) => { if (isErrorLike(l)) errorLineSet.add(i); });

  const tailStart = Math.max(0, lines.length - opts.keepLast);

  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const mustKeep = errorLineSet.has(i) || i >= tailStart;

    // Collapse run of identical (normalized) lines
    const baseline = normalize(lines[i]);
    let runEnd = i;
    while (runEnd + 1 < lines.length && normalize(lines[runEnd + 1]) === baseline && !errorLineSet.has(runEnd + 1)) {
      runEnd++;
    }
    const runLen = runEnd - i + 1;

    if (runLen > opts.maxRepeat && !mustKeep) {
      out.push(lines[i]);
      out.push(colorize(`  [repeated ${runLen - 1} more times]`, 'dim'));
      stats.duplicatesCollapsed += runLen - 1;
      i = runEnd + 1;
      continue;
    }

    // Collapse stack-frame block
    if (isStackFrame(lines[i]) && !mustKeep) {
      let frameEnd = i;
      while (frameEnd + 1 < lines.length && isStackFrame(lines[frameEnd + 1]) && !errorLineSet.has(frameEnd + 1)) {
        frameEnd++;
      }
      const frameLen = frameEnd - i + 1;
      if (frameLen >= 4) {
        out.push(lines[i]);
        out.push(lines[i + 1]);
        out.push(colorize(`  [... ${frameLen - 3} stack frames elided ...]`, 'dim'));
        out.push(lines[frameEnd]);
        stats.stackFramesCollapsed += frameLen - 3;
        i = frameEnd + 1;
        continue;
      }
    }

    // Truncate long uniform-pattern block (e.g., passing test lines)
    if (runLen === 1 && !mustKeep) {
      let uniformEnd = i;
      const prefix = stripAnsi(lines[i]).slice(0, 8);
      if (prefix.length >= 2) {
        while (
          uniformEnd + 1 < lines.length
          && stripAnsi(lines[uniformEnd + 1]).slice(0, 8) === prefix
          && !errorLineSet.has(uniformEnd + 1)
          && !(uniformEnd + 1 >= tailStart)
        ) {
          uniformEnd++;
        }
        const uniformLen = uniformEnd - i + 1;
        if (uniformLen > opts.truncateAfter) {
          const keepHead = Math.min(3, uniformLen);
          for (let k = 0; k < keepHead; k++) out.push(lines[i + k]);
          out.push(colorize(`  [... ${uniformLen - keepHead} similar lines elided ...]`, 'dim'));
          stats.sectionsTruncated += uniformLen - keepHead;
          i = uniformEnd + 1;
          continue;
        }
      }
    }

    out.push(lines[i]);
    i++;
  }

  stats.outLines = out.length;
  return { output: out, stats };
}

export async function filterCommand(flags: GlobalFlags): Promise<void> {
  const { opts, cmd } = parseArgs(flags.args);

  if (cmd.length === 0) {
    console.error(colorize('\n  Error: no command to filter. Usage: promptreports filter -- <cmd> [args...]\n', 'red'));
    console.error(colorize('  Example: promptreports filter -- npm test\n', 'dim'));
    process.exit(2);
  }

  const cmdline = cmd.join(' ');
  if (!flags.quiet) {
    console.log(colorize(`  filter: running ${colorize(cmdline, 'bold')}`, 'dim'));
  }

  const captured: string[] = [];
  let stdoutBuf = '';
  let stderrBuf = '';

  const child = spawn(cmdline, { shell: true, stdio: ['inherit', 'pipe', 'pipe'] });

  const collect = (chunk: unknown, which: 'out' | 'err') => {
    const text = typeof chunk === 'string' ? chunk : (chunk as { toString(enc?: string): string }).toString('utf-8');
    if (which === 'out') {
      stdoutBuf += text;
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() || '';
      captured.push(...lines);
    } else {
      stderrBuf += text;
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop() || '';
      captured.push(...lines);
    }
  };

  child.stdout?.on('data', (c: unknown) => collect(c, 'out'));
  child.stderr?.on('data', (c: unknown) => collect(c, 'err'));

  const exitCode: number = await new Promise((resolve) => {
    child.on('close', (code: number | null) => resolve(code ?? 0));
    child.on('error', (err: Error) => {
      console.error(colorize(`  filter: spawn error — ${err.message}`, 'red'));
      resolve(127);
    });
  });

  if (stdoutBuf) captured.push(stdoutBuf);
  if (stderrBuf) captured.push(stderrBuf);

  const { output, stats } = compress(captured, opts);

  for (const line of output) console.log(line);

  if (flags.json) {
    process.stderr.write(JSON.stringify({
      exitCode,
      stats,
      reductionPercent: stats.inLines > 0 ? ((1 - stats.outLines / stats.inLines) * 100).toFixed(1) : '0',
    }) + '\n');
  } else if (!flags.quiet) {
    const saved = stats.inLines - stats.outLines;
    const pct = stats.inLines > 0 ? ((saved / stats.inLines) * 100).toFixed(1) : '0';
    console.log('');
    console.log(colorize(
      `  filter: ${stats.inLines} lines in → ${stats.outLines} out (${pct}% reduction)  exit ${exitCode}`,
      saved > 0 ? 'green' : 'dim'
    ));
  }

  process.exit(exitCode);
}
