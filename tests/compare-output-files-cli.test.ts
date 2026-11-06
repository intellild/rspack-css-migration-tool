import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@rstest/core';

const projectRoot = process.cwd();
const comparerPath = path.join(projectRoot, 'scripts/compare-output-files.mjs');

test('writes normalized and raw diffs for matched output files', () => {
  execFileSync('pnpm', ['run', 'build'], {
    cwd: projectRoot,
    stdio: 'pipe',
  });

  const root = mkdtempSync(path.join(tmpdir(), 'output-cli-'));
  const beforeRoot = path.join(root, 'before');
  const afterRoot = path.join(root, 'after');
  mkdirSync(beforeRoot);
  mkdirSync(afterRoot);

  try {
    writeFileSync(
      path.join(beforeRoot, 'hash.css'),
      '.button_before123 { color: red; }',
    );
    writeFileSync(
      path.join(afterRoot, 'hash.css'),
      '.button_after456 { color: red; }',
    );
    writeFileSync(
      path.join(beforeRoot, 'order.css'),
      '.first { color: red; }\n.second { color: blue; }',
    );
    writeFileSync(
      path.join(afterRoot, 'order.css'),
      '.second { color: blue; }\n.first { color: red; }',
    );

    const reportPath = path.join(root, 'reports/default/report.md');
    const diffPath = path.join(root, 'reports/default/report.diff');
    const normalized = runComparer([
      '--before',
      beforeRoot,
      '--after',
      afterRoot,
      '--extensions',
      'css',
      '--no-graph',
      '--check',
      '--out',
      reportPath,
      '--diff-out',
      diffPath,
    ]);

    expect(normalized.status).toBe(1);
    expect(normalized.stderr).toContain(
      'Output check failed: 1 changed contents',
    );
    expect(normalized.stdout).toContain(`Report saved to: ${reportPath}`);
    expect(normalized.stdout).toContain(`Content diff saved to: ${diffPath}`);

    const report = readFileSync(reportPath, 'utf8');
    const diff = readFileSync(diffPath, 'utf8');
    expect(report).toContain('Equivalent after normalization: 1');
    expect(report).toContain('Changed: 1');
    expect(report).toMatch(
      /\| `hash\.css`\s+\| `hash\.css`\s+\| equivalent \|/,
    );
    expect(report).toMatch(/\| `order\.css` \| `order\.css` \| changed\s+\|/);
    expect(diff).toContain('--- before/order.css');
    expect(diff).toContain('+++ after/order.css');
    expect(diff).not.toContain('button_before123');
    expect(diff).not.toContain('button_after456');

    const rawReportPath = path.join(root, 'reports/raw/report.md');
    const rawDiffPath = path.join(root, 'reports/raw/report.diff');
    const raw = runComparer([
      '--before',
      beforeRoot,
      '--after',
      afterRoot,
      '--extensions',
      'css',
      '--no-graph',
      '--no-css-selector-normalize',
      '--check',
      '--out',
      rawReportPath,
      '--diff-out',
      rawDiffPath,
    ]);

    expect(raw.status).toBe(1);
    const rawReport = readFileSync(rawReportPath, 'utf8');
    const rawDiff = readFileSync(rawDiffPath, 'utf8');
    expect(rawReport).toContain('Equivalent after normalization: 0');
    expect(rawReport).toContain('Changed: 2');
    expect(rawDiff).toContain('button_before123');
    expect(rawDiff).toContain('button_after456');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

function runComparer(args: string[]) {
  return spawnSync(process.execPath, [comparerPath, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
}
