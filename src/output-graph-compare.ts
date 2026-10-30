import { readFileSync } from 'node:fs';
import { bytesToHuman, signedBytes, type AssetKind } from './normalize';
import {
  renderOutputContentSummaryMarkdown,
  type OutputContentComparison,
} from './output-content-compare';
import type { OutputGraph, OutputGraphAsset } from './output-graph-plugin';

export interface OutputGraphComparisonOptions {
  minScore?: number;
  extensions?: string[];
  top?: number;
  contentComparison?: OutputContentComparison;
  contentDiffFilename?: string;
}

export interface OutputGraphComparison {
  beforeName: string;
  afterName: string;
  matched: MatchedOutputGraphAsset[];
  added: OutputGraphAsset[];
  removed: OutputGraphAsset[];
  summary: OutputGraphSummary[];
}

export interface MatchedOutputGraphAsset {
  before: OutputGraphAsset;
  after: OutputGraphAsset;
  bytesDiff: number;
  score: number;
  reasons: string[];
}

export interface OutputGraphSummary {
  kind: AssetKind;
  beforeCount: number;
  afterCount: number;
  beforeBytes: number;
  afterBytes: number;
  countDiff: number;
  bytesDiff: number;
}

interface ScoredPair {
  score: number;
  reasons: string[];
}

export function loadOutputGraph(filePath: string): OutputGraph {
  const graph = JSON.parse(readFileSync(filePath, 'utf8')) as OutputGraph;
  if (graph.version !== 1 || !Array.isArray(graph.assets)) {
    throw new Error(`Unsupported output graph manifest: ${filePath}`);
  }
  return graph;
}

export function compareOutputGraphs(
  before: OutputGraph,
  after: OutputGraph,
  options: OutputGraphComparisonOptions = {},
): OutputGraphComparison {
  const minScore = options.minScore ?? 0.35;
  if (minScore < 0 || minScore > 1) {
    throw new Error(`minScore must be between 0 and 1, received ${minScore}`);
  }

  const extensions = normalizeExtensionFilter(options.extensions);
  const beforeAssets = filterAssets(before.assets, extensions);
  const afterAssets = filterAssets(after.assets, extensions);
  const matched = matchAssets(beforeAssets, afterAssets, minScore);
  const usedBefore = new Set(matched.map((match) => match.before));
  const usedAfter = new Set(matched.map((match) => match.after));

  return {
    beforeName: before.compilation.name ?? before.compilation.hash ?? 'before',
    afterName: after.compilation.name ?? after.compilation.hash ?? 'after',
    matched,
    added: afterAssets.filter((asset) => !usedAfter.has(asset)),
    removed: beforeAssets.filter((asset) => !usedBefore.has(asset)),
    summary: summarizeOutputGraphAssets(beforeAssets, afterAssets),
  };
}

function matchAssets(
  beforeAssets: OutputGraphAsset[],
  afterAssets: OutputGraphAsset[],
  minScore: number,
): MatchedOutputGraphAsset[] {
  const extensions = new Set([
    ...beforeAssets.map((asset) => asset.extension),
    ...afterAssets.map((asset) => asset.extension),
  ]);
  const matches: MatchedOutputGraphAsset[] = [];

  for (const extension of [...extensions].sort()) {
    const beforeGroup = beforeAssets.filter(
      (asset) => asset.extension === extension,
    );
    const afterGroup = afterAssets.filter(
      (asset) => asset.extension === extension,
    );
    if (!beforeGroup.length || !afterGroup.length) continue;

    const pairs = beforeGroup.map((beforeAsset) =>
      afterGroup.map((afterAsset) => scoreAssetPair(beforeAsset, afterAsset)),
    );
    const weights = pairs.map((row) =>
      row.map((pair) => (pair.score >= minScore ? pair.score : 0)),
    );

    for (const [beforeIndex, afterIndex] of maximumWeightAssignment(weights)) {
      const pair = pairs[beforeIndex]?.[afterIndex];
      const beforeAsset = beforeGroup[beforeIndex];
      const afterAsset = afterGroup[afterIndex];
      if (!pair || !beforeAsset || !afterAsset || pair.score < minScore) {
        continue;
      }
      matches.push({
        before: beforeAsset,
        after: afterAsset,
        bytesDiff: afterAsset.bytes - beforeAsset.bytes,
        score: pair.score,
        reasons: pair.reasons,
      });
    }
  }

  return matches.sort((left, right) =>
    left.before.name.localeCompare(right.before.name),
  );
}

function normalizeExtensionFilter(extensions?: string[]): Set<string> | null {
  if (!extensions?.length) return null;
  return new Set(
    extensions.map((extension) =>
      extension.startsWith('.') ? extension.toLowerCase() : `.${extension}`,
    ),
  );
}

function filterAssets(
  assets: OutputGraphAsset[],
  extensions: Set<string> | null,
): OutputGraphAsset[] {
  return assets
    .filter((asset) => !extensions || extensions.has(asset.extension))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function scoreAssetPair(
  before: OutputGraphAsset,
  after: OutputGraphAsset,
): ScoredPair {
  const evidence: Array<{
    similarity: number;
    weight: number;
    reason?: string;
  }> = [];

  if (before.name === after.name) {
    evidence.push({ similarity: 1, weight: 1, reason: 'same asset name' });
  } else if (before.normalizedName === after.normalizedName) {
    evidence.push({
      similarity: 1,
      weight: 0.92,
      reason: 'same normalized asset name',
    });
  }

  const styleModuleOverlap = jaccard(
    before.styleModuleKeys ?? [],
    after.styleModuleKeys ?? [],
  );
  if (styleModuleOverlap > 0) {
    evidence.push({
      similarity: styleModuleOverlap,
      weight: 0.9,
      reason: `style module overlap ${toPercent(styleModuleOverlap)}`,
    });
  } else {
    const moduleKeyOverlap = jaccard(
      before.moduleKeys ?? before.moduleResources,
      after.moduleKeys ?? after.moduleResources,
    );
    if (moduleKeyOverlap > 0) {
      evidence.push({
        similarity: moduleKeyOverlap,
        weight: 0.65,
        reason: `module overlap ${toPercent(moduleKeyOverlap)}`,
      });
    }
  }

  const issuerOverlap = jaccard(
    before.issuerModuleKeys ?? [],
    after.issuerModuleKeys ?? [],
  );
  if (issuerOverlap > 0) {
    evidence.push({
      similarity: issuerOverlap,
      weight: 0.35,
      reason: `issuer overlap ${toPercent(issuerOverlap)}`,
    });
  }

  const entrypointOverlap = jaccard(before.entrypoints, after.entrypoints);
  if (entrypointOverlap > 0) {
    evidence.push({
      similarity: entrypointOverlap,
      weight: 0.3,
      reason: `entrypoint overlap ${toPercent(entrypointOverlap)}`,
    });
  }

  const chunkOverlap = jaccard(before.chunkKeys, after.chunkKeys);
  if (chunkOverlap > 0) {
    evidence.push({
      similarity: chunkOverlap,
      weight: 0.35,
      reason: `chunk overlap ${toPercent(chunkOverlap)}`,
    });
  }

  if (before.bytes > 0 && after.bytes > 0) {
    evidence.push({
      similarity:
        Math.min(before.bytes, after.bytes) /
        Math.max(before.bytes, after.bytes),
      weight: 0.08,
    });
  }

  const score =
    1 -
    evidence.reduce(
      (remaining, item) => remaining * (1 - item.weight * item.similarity),
      1,
    );

  return {
    score: Math.min(1, score),
    reasons: evidence.flatMap((item) => (item.reason ? [item.reason] : [])),
  };
}

/**
 * Hungarian assignment for a rectangular maximum-weight matrix. Dummy rows or
 * columns have zero weight, so a low-confidence asset can remain unmatched.
 */
function maximumWeightAssignment(weights: number[][]): Array<[number, number]> {
  const rowCount = weights.length;
  const columnCount = weights[0]?.length ?? 0;
  if (!rowCount || !columnCount) return [];

  const size = Math.max(rowCount, columnCount);
  const rowMatch = new Array<number>(size + 1).fill(0);
  const columnPotential = new Array<number>(size + 1).fill(0);
  const rowPotential = new Array<number>(size + 1).fill(0);

  for (let row = 1; row <= size; row += 1) {
    rowMatch[0] = row;
    let column = 0;
    const minValue = new Array<number>(size + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array<boolean>(size + 1).fill(false);
    const previous = new Array<number>(size + 1).fill(0);

    do {
      used[column] = true;
      const currentRow = rowMatch[column] ?? 0;
      let delta = Number.POSITIVE_INFINITY;
      let nextColumn = 0;

      for (
        let candidateColumn = 1;
        candidateColumn <= size;
        candidateColumn += 1
      ) {
        if (used[candidateColumn]) continue;
        const weight =
          currentRow <= rowCount && candidateColumn <= columnCount
            ? (weights[currentRow - 1]?.[candidateColumn - 1] ?? 0)
            : 0;
        const cost = 1 - weight;
        const reducedCost =
          cost -
          (rowPotential[currentRow] ?? 0) -
          (columnPotential[candidateColumn] ?? 0);

        if (reducedCost < (minValue[candidateColumn] ?? 0)) {
          minValue[candidateColumn] = reducedCost;
          previous[candidateColumn] = column;
        }
        if ((minValue[candidateColumn] ?? 0) < delta) {
          delta = minValue[candidateColumn] ?? 0;
          nextColumn = candidateColumn;
        }
      }

      for (
        let candidateColumn = 0;
        candidateColumn <= size;
        candidateColumn += 1
      ) {
        if (used[candidateColumn]) {
          const matchedRow = rowMatch[candidateColumn] ?? 0;
          rowPotential[matchedRow] = (rowPotential[matchedRow] ?? 0) + delta;
          columnPotential[candidateColumn] =
            (columnPotential[candidateColumn] ?? 0) - delta;
        } else {
          minValue[candidateColumn] = (minValue[candidateColumn] ?? 0) - delta;
        }
      }
      column = nextColumn;
    } while ((rowMatch[column] ?? 0) !== 0);

    do {
      const previousColumn = previous[column] ?? 0;
      rowMatch[column] = rowMatch[previousColumn] ?? 0;
      column = previousColumn;
    } while (column !== 0);
  }

  const result: Array<[number, number]> = [];
  for (let column = 1; column <= size; column += 1) {
    const row = rowMatch[column] ?? 0;
    if (row > 0 && row <= rowCount && column <= columnCount) {
      result.push([row - 1, column - 1]);
    }
  }
  return result;
}

function jaccard(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const value of leftSet) {
    if (rightSet.has(value)) intersection += 1;
  }
  const union = new Set([...leftSet, ...rightSet]).size;
  return union ? intersection / union : 0;
}

function toPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function summarizeOutputGraphAssets(
  beforeAssets: OutputGraphAsset[],
  afterAssets: OutputGraphAsset[],
): OutputGraphSummary[] {
  const kinds = new Set<AssetKind>([
    ...beforeAssets.map((asset) => asset.kind),
    ...afterAssets.map((asset) => asset.kind),
  ]);

  return [...kinds].sort().map((kind) => {
    const before = beforeAssets.filter((asset) => asset.kind === kind);
    const after = afterAssets.filter((asset) => asset.kind === kind);
    const beforeBytes = before.reduce((sum, asset) => sum + asset.bytes, 0);
    const afterBytes = after.reduce((sum, asset) => sum + asset.bytes, 0);

    return {
      kind,
      beforeCount: before.length,
      afterCount: after.length,
      beforeBytes,
      afterBytes,
      countDiff: after.length - before.length,
      bytesDiff: afterBytes - beforeBytes,
    };
  });
}

export function renderOutputGraphDiffMarkdown(
  comparison: OutputGraphComparison,
  options: OutputGraphComparisonOptions = {},
): string {
  const top = options.top ?? 50;
  const changed = comparison.matched
    .filter(
      (match) =>
        match.bytesDiff !== 0 || match.before.name !== match.after.name,
    )
    .sort(
      (left, right) => Math.abs(right.bytesDiff) - Math.abs(left.bytesDiff),
    );
  const lines = [
    '# Rspack Output Graph Diff Report',
    '',
    `- Before: \`${comparison.beforeName}\``,
    `- After: \`${comparison.afterName}\``,
    `- Matched: ${comparison.matched.length}`,
    `- Added: ${comparison.added.length}`,
    `- Removed: ${comparison.removed.length}`,
    '',
    '## Summary',
    '',
    '| Kind | Before | After | Count Diff | Size Diff |',
    '|---|---:|---:|---:|---:|',
  ];

  for (const row of comparison.summary) {
    lines.push(
      `| ${row.kind} | ${row.beforeCount} / ${bytesToHuman(row.beforeBytes)} | ${row.afterCount} / ${bytesToHuman(row.afterBytes)} | ${row.countDiff >= 0 ? '+' : ''}${row.countDiff} | ${signedBytes(row.bytesDiff)} |`,
    );
  }

  lines.push('', `## Matched Asset Changes (${changed.length})`, '');
  lines.push('| Before | After | Size Diff | Score | Reasons |');
  lines.push('|---|---|---:|---:|---|');
  for (const match of changed.slice(0, top)) {
    lines.push(
      `| \`${match.before.name}\` | \`${match.after.name}\` | ${signedBytes(match.bytesDiff)} | ${match.score.toFixed(2)} | ${match.reasons.join(', ')} |`,
    );
  }
  if (changed.length > top) {
    lines.push(`| ... | ... | ... | ... | ${changed.length - top} more |`);
  }

  lines.push('', `## Added Assets (${comparison.added.length})`, '');
  for (const asset of comparison.added.slice(0, top)) {
    lines.push(`- \`${asset.name}\` (${bytesToHuman(asset.bytes)})`);
  }
  if (comparison.added.length > top) {
    lines.push(`- ... ${comparison.added.length - top} more`);
  }

  lines.push('', `## Removed Assets (${comparison.removed.length})`, '');
  for (const asset of comparison.removed.slice(0, top)) {
    lines.push(`- \`${asset.name}\` (${bytesToHuman(asset.bytes)})`);
  }
  if (comparison.removed.length > top) {
    lines.push(`- ... ${comparison.removed.length - top} more`);
  }

  if (options.contentComparison) {
    lines.push(
      '',
      ...renderOutputContentSummaryMarkdown(options.contentComparison, {
        diffFilename: options.contentDiffFilename,
        top,
      })
        .trimEnd()
        .split('\n'),
    );
  }

  return `${lines.join('\n')}\n`;
}
