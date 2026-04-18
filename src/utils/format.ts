/**
 * Shared formatting utilities for CLI output.
 * Uses Unicode box-drawing characters and ANSI color codes.
 * Zero external dependencies.
 */

// ─── ANSI Color Codes ──────────────────────────────────────────────────────

const CODES: Record<string, string> = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
};

export type Color = 'green' | 'red' | 'yellow' | 'blue' | 'gray' | 'cyan' | 'magenta' | 'white' | 'bold' | 'dim';

/**
 * Wrap text in ANSI color codes.
 */
export function colorize(text: string, color: Color): string {
  const code = CODES[color];
  if (!code) return text;
  return `${code}${text}${CODES.reset}`;
}

/**
 * Status icon — checkmark or X.
 */
export function statusIcon(ok: boolean): string {
  return ok ? colorize('\u2713', 'green') : colorize('\u2717', 'red');
}

/**
 * Format a dollar amount.
 */
export function formatCost(amount: number): string {
  if (amount < 0.01 && amount > 0) return '<$0.01';
  return `$${amount.toFixed(2)}`;
}

/**
 * Format token count to human-readable (e.g., 1.2M, 45K).
 */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

/**
 * Format milliseconds to human-readable duration.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

/**
 * Print a Unicode box-drawing bordered output.
 */
export function box(title: string, content: string): void {
  const lines = content.split('\n');
  const maxLen = Math.max(title.length + 4, ...lines.map(l => stripAnsi(l).length + 4));
  const width = Math.max(maxLen, 60);

  console.log(`\u250C${''.padEnd(width, '\u2500')}\u2510`);
  console.log(`\u2502  ${title.padEnd(width - 2)}\u2502`);
  console.log(`\u251C${''.padEnd(width, '\u2500')}\u2524`);
  for (const line of lines) {
    const visible = stripAnsi(line);
    const padding = width - 2 - visible.length;
    console.log(`\u2502  ${line}${' '.repeat(Math.max(0, padding))}\u2502`);
  }
  console.log(`\u2514${''.padEnd(width, '\u2500')}\u2518`);
}

/**
 * Print a formatted table with column alignment.
 */
export function table(headers: string[], rows: string[][]): void {
  // Calculate column widths
  const widths = headers.map((h, i) => {
    const dataMax = rows.reduce((max, row) => {
      const cellLen = stripAnsi(row[i] || '').length;
      return cellLen > max ? cellLen : max;
    }, 0);
    return Math.max(stripAnsi(h).length, dataMax) + 2;
  });

  const totalWidth = widths.reduce((a, b) => a + b, 0) + widths.length + 1;

  // Top border
  console.log('\u250C' + widths.map(w => ''.padEnd(w, '\u2500')).join('\u252C') + '\u2510');

  // Header row
  const headerRow = headers.map((h, i) => ` ${h.padEnd(widths[i] - 1)}`).join('\u2502');
  console.log(`\u2502${headerRow}\u2502`);

  // Header separator
  console.log('\u251C' + widths.map(w => ''.padEnd(w, '\u2500')).join('\u253C') + '\u2524');

  // Data rows
  for (const row of rows) {
    const cells = headers.map((_, i) => {
      const cell = row[i] || '';
      const visible = stripAnsi(cell);
      const pad = widths[i] - 1 - visible.length;
      return ` ${cell}${' '.repeat(Math.max(0, pad))}`;
    }).join('\u2502');
    console.log(`\u2502${cells}\u2502`);
  }

  // Bottom border
  console.log('\u2514' + widths.map(w => ''.padEnd(w, '\u2500')).join('\u2534') + '\u2518');
}

/**
 * Progress bar: [####------] 40%
 */
export function progressBar(percent: number, width: number = 20): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
  return `[${bar}] ${Math.round(clamped)}%`;
}

/**
 * Strip ANSI escape codes from a string to get visible length.
 */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Print a section header.
 */
export function sectionHeader(title: string): void {
  console.log('');
  console.log(`\u2550\u2550\u2550 ${colorize(title, 'bold')} ${''.padEnd(Math.max(0, 55 - title.length), '\u2550')}`);
  console.log('');
}
