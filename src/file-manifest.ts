import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  getAssetExtension,
  getAssetKind,
  normalizeAssetName,
  normalizeExtensionFilter,
  normalizeSlashes,
  signedBytes,
  summarizeAssetsByKind,
  type AssetKind,
  type AssetKindSummary,
  type NormalizeAssetNameOptions,
} from './normalize';
import type { OutputContentComparison } from './output-content-compare';
import { renderComparisonReportMarkdown } from './report-markdown';

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

export type FileManifestSummary = AssetKindSummary;

export interface MatchedOutputFile {
  before: OutputFileRecord;
  after: OutputFileRecord;
  bytesDiff: number;
  contentChanged: boolean | null;
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

  const extensionFilter = normalizeExtensionFilter(options.extensions);
  const files: OutputFileRecord[] = [];
  const stack = [absoluteRoot];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      const relativePath = normalizeSlashes(
        path.relative(absoluteRoot, absolutePath),
      );

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
  return summarizeAssetsByKind(beforeFiles, afterFiles);
}

export interface RenderFileManifestDiffOptions {
  title?: string;
  top?: number;
  contentComparison?: OutputContentComparison;
  contentDiffFilename?: string;
}

export function renderOutputFileDiffMarkdown(
  comparison: FileManifestComparison,
  options: RenderFileManifestDiffOptions = {},
): string {
  const top = options.top ?? 50;
  const changed = comparison.matched
    .filter((item) => item.bytesDiff !== 0 || item.contentChanged)
    .sort(
      (left, right) => Math.abs(right.bytesDiff) - Math.abs(left.bytesDiff),
    );

  return renderComparisonReportMarkdown({
    title: options.title ?? 'Output File Diff Report',
    beforeLabel: comparison.beforeRoot,
    afterLabel: comparison.afterRoot,
    matchedCount: comparison.matched.length,
    added: comparison.added.map((file) => ({
      label: file.path,
      bytes: file.bytes,
    })),
    removed: comparison.removed.map((file) => ({
      label: file.path,
      bytes: file.bytes,
    })),
    summary: comparison.summary,
    changedSection: {
      title: 'Changed Files',
      headers: ['Before', 'After', 'Size Diff', 'Content'],
      alignments: ['---', '---', '---:', '---'],
      totalCount: changed.length,
      rows: changed.slice(0, top).map((item) => {
        const content =
          item.contentChanged === null
            ? 'not hashed'
            : item.contentChanged
              ? 'changed'
              : 'same';
        return [
          `\`${item.before.path}\``,
          `\`${item.after.path}\``,
          signedBytes(item.bytesDiff),
          content,
        ];
      }),
    },
    itemNoun: 'Files',
    top,
    contentComparison: options.contentComparison,
    contentDiffFilename: options.contentDiffFilename,
  });
}
