import { readFileSync } from 'node:fs';
import {
  bytesToHuman,
  getAssetKind,
  normalizeAssetName,
  signedBytes,
  type AssetKind,
  type NormalizeAssetNameOptions,
} from './normalize';

export interface ScmManifestRecord {
  path: string;
  normalizedPath: string;
  kind: AssetKind;
  bytes: number;
}

export interface ScmManifest {
  source: string;
  files: ScmManifestRecord[];
}

export interface ScmManifestComparison {
  beforeSource: string;
  afterSource: string;
  matched: ScmManifestMatch[];
  added: ScmManifestRecord[];
  removed: ScmManifestRecord[];
  summary: ScmManifestSummary[];
}

export interface ScmManifestMatch {
  before: ScmManifestRecord;
  after: ScmManifestRecord;
  bytesDiff: number;
}

export interface ScmManifestSummary {
  kind: AssetKind;
  beforeCount: number;
  afterCount: number;
  beforeBytes: number;
  afterBytes: number;
  countDiff: number;
  bytesDiff: number;
}

const LOG_MANIFEST_LINE = /(dist\/\S+?)\s+([\d.]+)\s*kB/g;

export function parseScmManifestLog(
  text: string,
  source: string,
  options: NormalizeAssetNameOptions = {},
): ScmManifest {
  const files: ScmManifestRecord[] = [];
  let match: RegExpExecArray | null;

  while ((match = LOG_MANIFEST_LINE.exec(text))) {
    const assetPath = match[1];
    const kb = Number.parseFloat(match[2] ?? '0');
    if (!assetPath || !Number.isFinite(kb)) continue;

    files.push({
      path: assetPath,
      normalizedPath: normalizeAssetName(assetPath, options),
      kind: getAssetKind(assetPath),
      bytes: Math.round(kb * 1024),
    });
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  return { source, files };
}

export function loadScmManifestLog(
  filePath: string,
  options: NormalizeAssetNameOptions = {},
): ScmManifest {
  return parseScmManifestLog(readFileSync(filePath, 'utf8'), filePath, options);
}

export function compareScmManifests(
  before: ScmManifest,
  after: ScmManifest,
): ScmManifestComparison {
  const beforeByPath = groupByNormalizedPath(before.files);
  const afterByPath = groupByNormalizedPath(after.files);
  const keys = new Set([...beforeByPath.keys(), ...afterByPath.keys()]);
  const matched: ScmManifestMatch[] = [];
  const added: ScmManifestRecord[] = [];
  const removed: ScmManifestRecord[] = [];

  for (const key of [...keys].sort()) {
    const beforeGroup = [...(beforeByPath.get(key) ?? [])];
    const afterGroup = [...(afterByPath.get(key) ?? [])];
    const pairCount = Math.min(beforeGroup.length, afterGroup.length);

    for (let index = 0; index < pairCount; index += 1) {
      const beforeFile = beforeGroup[index];
      const afterFile = afterGroup[index];
      if (!beforeFile || !afterFile) continue;
      matched.push({
        before: beforeFile,
        after: afterFile,
        bytesDiff: afterFile.bytes - beforeFile.bytes,
      });
    }

    removed.push(...beforeGroup.slice(pairCount));
    added.push(...afterGroup.slice(pairCount));
  }

  return {
    beforeSource: before.source,
    afterSource: after.source,
    matched,
    added,
    removed,
    summary: summarizeScmManifests(before.files, after.files),
  };
}

function groupByNormalizedPath(
  files: ScmManifestRecord[],
): Map<string, ScmManifestRecord[]> {
  const groups = new Map<string, ScmManifestRecord[]>();
  for (const file of files) {
    const group = groups.get(file.normalizedPath);
    if (group) {
      group.push(file);
    } else {
      groups.set(file.normalizedPath, [file]);
    }
  }
  return groups;
}

function summarizeScmManifests(
  beforeFiles: ScmManifestRecord[],
  afterFiles: ScmManifestRecord[],
): ScmManifestSummary[] {
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

export interface RenderScmManifestDiffOptions {
  title?: string;
  top?: number;
}

export function renderScmManifestDiffMarkdown(
  comparison: ScmManifestComparison,
  options: RenderScmManifestDiffOptions = {},
): string {
  const top = options.top ?? 50;
  const changed = comparison.matched
    .filter((item) => item.bytesDiff !== 0)
    .sort(
      (left, right) => Math.abs(right.bytesDiff) - Math.abs(left.bytesDiff),
    );
  const lines = [
    `# ${options.title ?? 'SCM Manifest Diff Report'}`,
    '',
    `- Before: \`${comparison.beforeSource}\``,
    `- After: \`${comparison.afterSource}\``,
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

  lines.push('', `## Changed Assets (${changed.length})`, '');
  lines.push('| Before | After | Size Diff |');
  lines.push('|---|---|---:|');
  for (const item of changed.slice(0, top)) {
    lines.push(
      `| \`${item.before.path}\` | \`${item.after.path}\` | ${signedBytes(item.bytesDiff)} |`,
    );
  }
  if (changed.length > top) {
    lines.push(`| ... | ... | ${changed.length - top} more |`);
  }

  lines.push('', `## Added Assets (${comparison.added.length})`, '');
  for (const file of comparison.added.slice(0, top)) {
    lines.push(`- \`${file.path}\` (${bytesToHuman(file.bytes)})`);
  }
  if (comparison.added.length > top) {
    lines.push(`- ... ${comparison.added.length - top} more`);
  }

  lines.push('', `## Removed Assets (${comparison.removed.length})`, '');
  for (const file of comparison.removed.slice(0, top)) {
    lines.push(`- \`${file.path}\` (${bytesToHuman(file.bytes)})`);
  }
  if (comparison.removed.length > top) {
    lines.push(`- ... ${comparison.removed.length - top} more`);
  }

  return `${lines.join('\n')}\n`;
}
