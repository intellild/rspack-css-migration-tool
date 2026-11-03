import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { format, type Options as PrettierOptions } from 'prettier';
import { normalizeCssSelectorsByDeclarations } from './css-declaration-normalize';

export interface OutputContentPair {
  beforeName: string;
  afterName: string;
}

export interface CompareOutputContentsOptions {
  beforeRoot: string;
  afterRoot: string;
  normalizeCssSelectors?: boolean;
  diffContext?: number;
  prettierOptions?: PrettierOptions;
}

export type OutputContentDiffStatus =
  'equivalent' | 'changed' | 'skipped' | 'error';

export interface OutputContentDiff {
  beforeName: string;
  afterName: string;
  status: OutputContentDiffStatus;
  parser: string | null;
  beforeFormattedBytes: number | null;
  afterFormattedBytes: number | null;
  cssDeclarationBlocksMatched: number;
  cssSelectorsNormalized: number;
  addedLines: number;
  removedLines: number;
  patch: string;
  message?: string;
}

export interface OutputContentComparison {
  files: OutputContentDiff[];
  formatted: number;
  changed: number;
  equivalent: number;
  skipped: number;
  errors: number;
}

export interface RenderOutputContentSummaryOptions {
  diffFilename?: string;
  top?: number;
}

export async function compareOutputContents(
  pairs: OutputContentPair[],
  options: CompareOutputContentsOptions,
): Promise<OutputContentComparison> {
  const beforeRoot = path.resolve(options.beforeRoot);
  const afterRoot = path.resolve(options.afterRoot);
  const files: OutputContentDiff[] = [];

  for (const pair of pairs) {
    const parser = getPrettierParser(pair.beforeName);
    if (!parser || parser !== getPrettierParser(pair.afterName)) {
      files.push({
        ...pair,
        status: 'skipped',
        parser: null,
        beforeFormattedBytes: null,
        afterFormattedBytes: null,
        cssDeclarationBlocksMatched: 0,
        cssSelectorsNormalized: 0,
        addedLines: 0,
        removedLines: 0,
        patch: '',
        message: 'unsupported or mismatched text format',
      });
      continue;
    }

    try {
      const beforePath = resolveAssetPath(beforeRoot, pair.beforeName);
      const afterPath = resolveAssetPath(afterRoot, pair.afterName);
      const [beforeFormatted, afterFormatted] = await Promise.all([
        formatOutputText(readFileSync(beforePath, 'utf8'), pair.beforeName, {
          ...options.prettierOptions,
          parser,
        }),
        formatOutputText(readFileSync(afterPath, 'utf8'), pair.afterName, {
          ...options.prettierOptions,
          parser,
        }),
      ]);
      const shouldNormalizeCssSelectors =
        parser === 'css' && (options.normalizeCssSelectors ?? true);
      const normalized = shouldNormalizeCssSelectors
        ? normalizeCssSelectorsByDeclarations(beforeFormatted, afterFormatted)
        : {
            beforeContent: beforeFormatted,
            afterContent: afterFormatted,
            matchedDeclarationBlocks: 0,
            normalizedSelectors: 0,
          };
      const changed = normalized.beforeContent !== normalized.afterContent;
      const patch = changed
        ? createTwoFilesPatch(
            `before/${pair.beforeName}`,
            `after/${pair.afterName}`,
            normalized.beforeContent,
            normalized.afterContent,
            'Prettier formatted',
            'Prettier formatted',
            { context: options.diffContext ?? 3 },
          )
        : '';
      const lineChanges = countPatchLineChanges(patch);

      files.push({
        ...pair,
        status: changed ? 'changed' : 'equivalent',
        parser,
        beforeFormattedBytes: Buffer.byteLength(beforeFormatted),
        afterFormattedBytes: Buffer.byteLength(afterFormatted),
        cssDeclarationBlocksMatched: normalized.matchedDeclarationBlocks,
        cssSelectorsNormalized: normalized.normalizedSelectors,
        ...lineChanges,
        patch,
      });
    } catch (error) {
      files.push({
        ...pair,
        status: 'error',
        parser,
        beforeFormattedBytes: null,
        afterFormattedBytes: null,
        cssDeclarationBlocksMatched: 0,
        cssSelectorsNormalized: 0,
        addedLines: 0,
        removedLines: 0,
        patch: '',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    files,
    formatted: files.filter(
      (file) => file.status === 'changed' || file.status === 'equivalent',
    ).length,
    changed: files.filter((file) => file.status === 'changed').length,
    equivalent: files.filter((file) => file.status === 'equivalent').length,
    skipped: files.filter((file) => file.status === 'skipped').length,
    errors: files.filter((file) => file.status === 'error').length,
  };
}

export async function formatOutputText(
  content: string,
  filename: string,
  options: PrettierOptions = {},
): Promise<string> {
  const parser = options.parser ?? getPrettierParser(filename);
  if (!parser) throw new Error(`No Prettier parser for output: ${filename}`);
  return format(content, { ...options, filepath: filename, parser });
}

export function renderOutputContentDiff(
  comparison: OutputContentComparison,
): string {
  const patches = comparison.files
    .filter((file) => file.status === 'changed')
    .map((file) => file.patch.trimEnd());
  if (!patches.length) {
    return '# No content differences after Prettier formatting and normalization.\n';
  }
  return `${patches.join('\n\n')}\n`;
}

export function renderOutputContentSummaryMarkdown(
  comparison: OutputContentComparison,
  options: RenderOutputContentSummaryOptions = {},
): string {
  const top = options.top ?? 50;
  const lines = [
    '## Prettier-formatted Content Diff',
    '',
    `- Formatted: ${comparison.formatted}`,
    `- Equivalent after normalization: ${comparison.equivalent}`,
    `- Changed: ${comparison.changed}`,
    `- Skipped: ${comparison.skipped}`,
    `- Format errors: ${comparison.errors}`,
  ];
  if (options.diffFilename) {
    lines.push(`- Unified diff: \`${options.diffFilename}\``);
  }

  lines.push('');
  lines.push(
    '| Before | After | Status | Formatted Size Diff | +Lines | -Lines | Matched Blocks | Normalized Selectors |',
  );
  lines.push('|---|---|---|---:|---:|---:|---:|---:|');
  for (const file of comparison.files.slice(0, top)) {
    const sizeDiff =
      file.beforeFormattedBytes === null || file.afterFormattedBytes === null
        ? 'n/a'
        : formatSignedBytes(
            file.afterFormattedBytes - file.beforeFormattedBytes,
          );
    const status = file.message
      ? `${file.status}: ${escapeTableCell(file.message)}`
      : file.status;
    lines.push(
      `| \`${file.beforeName}\` | \`${file.afterName}\` | ${status} | ${sizeDiff} | ${file.addedLines} | ${file.removedLines} | ${file.cssDeclarationBlocksMatched} | ${file.cssSelectorsNormalized} |`,
    );
  }
  if (comparison.files.length > top) {
    lines.push(
      `| ... | ... | ${comparison.files.length - top} more | ... | ... | ... | ... | ... |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function getPrettierParser(filename: string): string | null {
  const lower = filename.toLowerCase().replace(/[?#].*$/, '');
  if (lower.endsWith('.css')) return 'css';
  if (
    lower.endsWith('.js') ||
    lower.endsWith('.mjs') ||
    lower.endsWith('.cjs')
  ) {
    return 'babel';
  }
  if (
    lower.endsWith('.json') ||
    lower.endsWith('.map') ||
    lower.endsWith('.css.map') ||
    lower.endsWith('.js.map')
  ) {
    return 'json';
  }
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.svg')) return 'html';
  return null;
}

function resolveAssetPath(root: string, assetName: string): string {
  const absolutePath = path.resolve(root, assetName);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Asset escapes output root: ${assetName}`);
  }
  return absolutePath;
}

function countPatchLineChanges(patch: string): {
  addedLines: number;
  removedLines: number;
} {
  let addedLines = 0;
  let removedLines = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) addedLines += 1;
    if (line.startsWith('-')) removedLines += 1;
  }
  return { addedLines, removedLines };
}

function formatSignedBytes(bytes: number): string {
  const sign = bytes >= 0 ? '+' : '';
  if (Math.abs(bytes) >= 1024) return `${sign}${(bytes / 1024).toFixed(1)} KB`;
  return `${sign}${bytes} B`;
}

function escapeTableCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}
