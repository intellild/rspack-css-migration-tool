import { bytesToHuman, signedBytes, type AssetKindSummary } from './normalize';
import {
  renderOutputContentSummaryMarkdown,
  type OutputContentComparison,
} from './output-content-compare';

export interface ComparisonReportSection {
  title: string;
  headers: string[];
  alignments: string[];
  rows: string[][];
  totalCount: number;
}

export interface ComparisonReportInput {
  title: string;
  beforeLabel: string;
  afterLabel: string;
  matchedCount: number;
  added: Array<{ label: string; bytes: number }>;
  removed: Array<{ label: string; bytes: number }>;
  summary: AssetKindSummary[];
  changedSection: ComparisonReportSection;
  itemNoun: string;
  top: number;
  contentComparison?: OutputContentComparison;
  contentDiffFilename?: string;
}

export function renderComparisonReportMarkdown(
  input: ComparisonReportInput,
): string {
  const { top } = input;
  const lines = [
    `# ${input.title}`,
    '',
    `- Before: \`${input.beforeLabel}\``,
    `- After: \`${input.afterLabel}\``,
    `- Matched: ${input.matchedCount}`,
    `- Added: ${input.added.length}`,
    `- Removed: ${input.removed.length}`,
    '',
    '## Summary',
    '',
    '| Kind | Before | After | Count Diff | Size Diff |',
    '|---|---:|---:|---:|---:|',
  ];

  for (const row of input.summary) {
    lines.push(
      `| ${row.kind} | ${row.beforeCount} / ${bytesToHuman(row.beforeBytes)} | ${row.afterCount} / ${bytesToHuman(row.afterBytes)} | ${row.countDiff >= 0 ? '+' : ''}${row.countDiff} | ${signedBytes(row.bytesDiff)} |`,
    );
  }

  const { changedSection } = input;
  lines.push(
    '',
    `## ${changedSection.title} (${changedSection.totalCount})`,
    '',
  );
  lines.push(`| ${changedSection.headers.join(' | ')} |`);
  lines.push(`|${changedSection.alignments.join('|')}|`);
  for (const row of changedSection.rows.slice(0, top)) {
    lines.push(`| ${row.join(' | ')} |`);
  }
  if (changedSection.totalCount > top) {
    const moreCells = changedSection.headers.map((_, index) =>
      index === changedSection.headers.length - 1
        ? `${changedSection.totalCount - top} more`
        : '...',
    );
    lines.push(`| ${moreCells.join(' | ')} |`);
  }

  appendAssetList(lines, `Added ${input.itemNoun}`, input.added, top);
  appendAssetList(lines, `Removed ${input.itemNoun}`, input.removed, top);

  if (input.contentComparison) {
    lines.push(
      '',
      ...renderOutputContentSummaryMarkdown(input.contentComparison, {
        diffFilename: input.contentDiffFilename,
        top,
      })
        .trimEnd()
        .split('\n'),
    );
  }

  return `${lines.join('\n')}\n`;
}

function appendAssetList(
  lines: string[],
  heading: string,
  items: Array<{ label: string; bytes: number }>,
  top: number,
): void {
  lines.push('', `## ${heading} (${items.length})`, '');
  for (const item of items.slice(0, top)) {
    lines.push(`- \`${item.label}\` (${bytesToHuman(item.bytes)})`);
  }
  if (items.length > top) {
    lines.push(`- ... ${items.length - top} more`);
  }
}
