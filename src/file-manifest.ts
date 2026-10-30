import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  bytesToHuman,
  getAssetExtension,
  getAssetKind,
  normalizeAssetName,
  signedBytes,
  type AssetKind,
  type NormalizeAssetNameOptions,
} from './normalize';

export interface OutputFileRecord {
  path: string;
  normalizedPath: string;
  extension: string;
  kind: AssetKind;
  bytes: number;
  sha256?: string;
}

export interface OutputFileManifest {
  root: string;
  files: OutputFileRecord[];
}

export interface CreateOutputFileManifestOptions extends NormalizeAssetNameOptions {
  extensions?: string[];
  hashContent?: boolean;
  ignore?: RegExp[];
}

export interface FileManifestComparison {
  beforeRoot: string;
  afterRoot: string;
  matched: MatchedOutputFile[];
  added: OutputFileRecord[];
  removed: OutputFileRecord[];
  summary: FileManifestSummary[];
}

export interface FileManifestSummary {
  kind: AssetKind;
  beforeCount: number;
  afterCount: number;
  beforeBytes: number;
  afterBytes: number;
  countDiff: number;
  bytesDiff: number;
}

export interface MatchedOutputFile {
  before: OutputFileRecord;
  after: OutputFileRecord;
  bytesDiff: number;
  contentChanged: boolean | null;
}

function normalizeExtensions(extensions?: string[]): Set<string> | null {
  if (!extensions?.length) return null;
  return new Set(
    extensions.map((extension) =>
      extension.startsWith('.') ? extension.toLowerCase() : `.${extension}`,
    ),
  );
}

function shouldIgnore(relativePath: string, ignore?: RegExp[]): boolean {
  return Boolean(ignore?.some((pattern) => pattern.test(relativePath)));
}

function hashFile(absolutePath: string): string {
  return createHash('sha256').update(readFileSync(absolutePath)).digest('hex');
}

export function createOutputFileManifest(
  root: string,
  options: CreateOutputFileManifestOptions = {},
): OutputFileManifest {
  const absoluteRoot = path.resolve(root);
  if (!existsSync(absoluteRoot)) {
    throw new Error(`Output root does not exist: ${absoluteRoot}`);
  }

  const extensionFilter = normalizeExtensions(options.extensions);
  const files: OutputFileRecord[] = [];
  const stack = [absoluteRoot];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      const relativePath = path
        .relative(absoluteRoot, absolutePath)
        .split(path.sep)
        .join('/');

      if (shouldIgnore(relativePath, options.ignore)) continue;
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;

      const extension = getAssetExtension(relativePath);
      if (extensionFilter && !extensionFilter.has(extension)) continue;

      files.push({
        path: relativePath,
        normalizedPath: normalizeAssetName(relativePath, options),
        extension,
        kind: getAssetKind(relativePath),
        bytes: statSync(absolutePath).size,
        sha256: options.hashContent ? hashFile(absolutePath) : undefined,
      });
    }
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  return { root: absoluteRoot, files };
}

function groupByNormalizedPath(
  files: OutputFileRecord[],
): Map<string, OutputFileRecord[]> {
  const groups = new Map<string, OutputFileRecord[]>();
  for (const file of files) {
    const key = `${file.extension}\0${file.normalizedPath}`;
    const group = groups.get(key);
    if (group) {
      group.push(file);
    } else {
      groups.set(key, [file]);
    }
  }
  for (const group of groups.values()) {
    group.sort((left, right) => left.path.localeCompare(right.path));
  }
  return groups;
}

export function compareOutputFileManifests(
  before: OutputFileManifest,
  after: OutputFileManifest,
): FileManifestComparison {
  const beforeGroups = groupByNormalizedPath(before.files);
  const afterGroups = groupByNormalizedPath(after.files);
  const keys = new Set([...beforeGroups.keys(), ...afterGroups.keys()]);
  const matched: MatchedOutputFile[] = [];
  const added: OutputFileRecord[] = [];
  const removed: OutputFileRecord[] = [];

  for (const key of [...keys].sort()) {
    const beforeGroup = [...(beforeGroups.get(key) ?? [])];
    const afterGroup = [...(afterGroups.get(key) ?? [])];
    const pairCount = Math.min(beforeGroup.length, afterGroup.length);

    for (let index = 0; index < pairCount; index += 1) {
      const beforeFile = beforeGroup[index];
      const afterFile = afterGroup[index];
      if (!beforeFile || !afterFile) continue;
      matched.push({
        before: beforeFile,
        after: afterFile,
        bytesDiff: afterFile.bytes - beforeFile.bytes,
        contentChanged:
          beforeFile.sha256 && afterFile.sha256
            ? beforeFile.sha256 !== afterFile.sha256
            : null,
      });
    }

    removed.push(...beforeGroup.slice(pairCount));
    added.push(...afterGroup.slice(pairCount));
  }

  return {
    beforeRoot: before.root,
    afterRoot: after.root,
    matched,
    added,
    removed,
    summary: summarizeFiles(before.files, after.files),
  };
}

export function summarizeFiles(
  beforeFiles: OutputFileRecord[],
  afterFiles: OutputFileRecord[],
): FileManifestSummary[] {
  const kinds = new Set<AssetKind>([
    ...beforeFiles.map((file) => file.kind),
    ...afterFiles.map((file) => file.kind),
  ]);

  return [...kinds].sort().map((kind) => {
    const before = beforeFiles.filter((file) => file.kind === kind);
    const after = afterFiles.filter((file) => file.kind === kind);
    const beforeBytes = before.reduce((sum, file) => sum + file.bytes, 0);
    const afterBytes = after.reduce((sum, file) => sum + file.bytes, 0);

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

export interface RenderFileManifestDiffOptions {
  title?: string;
  top?: number;
}

export function renderOutputFileDiffMarkdown(
  comparison: FileManifestComparison,
  options: RenderFileManifestDiffOptions = {},
): string {
  const top = options.top ?? 50;
  const lines = [
    `# ${options.title ?? 'Output File Diff Report'}`,
    '',
    `- Before: \`${comparison.beforeRoot}\``,
    `- After: \`${comparison.afterRoot}\``,
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

  const changed = comparison.matched
    .filter((item) => item.bytesDiff !== 0 || item.contentChanged)
    .sort(
      (left, right) => Math.abs(right.bytesDiff) - Math.abs(left.bytesDiff),
    );

  lines.push('', `## Changed Files (${changed.length})`, '');
  lines.push('| Before | After | Size Diff | Content |');
  lines.push('|---|---|---:|---|');
  for (const item of changed.slice(0, top)) {
    const content =
      item.contentChanged === null
        ? 'not hashed'
        : item.contentChanged
          ? 'changed'
          : 'same';
    lines.push(
      `| \`${item.before.path}\` | \`${item.after.path}\` | ${signedBytes(item.bytesDiff)} | ${content} |`,
    );
  }
  if (changed.length > top) {
    lines.push(`| ... | ... | ... | ${changed.length - top} more |`);
  }

  lines.push('', `## Added Files (${comparison.added.length})`, '');
  for (const file of comparison.added.slice(0, top)) {
    lines.push(`- \`${file.path}\` (${bytesToHuman(file.bytes)})`);
  }
  if (comparison.added.length > top) {
    lines.push(`- ... ${comparison.added.length - top} more`);
  }

  lines.push('', `## Removed Files (${comparison.removed.length})`, '');
  for (const file of comparison.removed.slice(0, top)) {
    lines.push(`- \`${file.path}\` (${bytesToHuman(file.bytes)})`);
  }
  if (comparison.removed.length > top) {
    lines.push(`- ... ${comparison.removed.length - top} more`);
  }

  return `${lines.join('\n')}\n`;
}

export function writeOutputFileDiffMarkdown(
  comparison: FileManifestComparison,
  outputPath: string,
  options: RenderFileManifestDiffOptions = {},
): void {
  writeFileSync(outputPath, renderOutputFileDiffMarkdown(comparison, options));
}
