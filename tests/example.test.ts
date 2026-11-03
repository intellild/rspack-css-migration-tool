import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@rstest/core';
import {
  compareOutputContents,
  compareOutputGraphs,
  DEFAULT_OUTPUT_GRAPH_FILENAME,
  loadOutputGraph,
  renderOutputContentDiff,
  renderOutputGraphDiffMarkdown,
  RspackOutputGraphPlugin,
} from '../src/index';
import {
  createMigrationConfigs,
  runRspackBuild,
} from '../examples/css-migration/config.mjs';

test('the example migrates from css-loader and still matches both CSS outputs', async () => {
  const outputRoot = mkdtempSync(
    path.join(tmpdir(), 'rspack-css-migration-example-'),
  );

  try {
    const configs = createMigrationConfigs(outputRoot, RspackOutputGraphPlugin);
    for (const config of configs) await runRspackBuild(config);

    const beforeGraphPath = path.join(
      outputRoot,
      'css-loader',
      DEFAULT_OUTPUT_GRAPH_FILENAME,
    );
    const afterGraphPath = path.join(
      outputRoot,
      'builtin-css',
      DEFAULT_OUTPUT_GRAPH_FILENAME,
    );
    const before = loadOutputGraph(beforeGraphPath);
    const after = loadOutputGraph(afterGraphPath);
    const comparison = compareOutputGraphs(before, after, {
      extensions: ['css'],
    });

    expect(comparison.matched).toHaveLength(4);
    expect(comparison.added).toEqual([]);
    expect(comparison.removed).toEqual([]);
    expect(
      comparison.matched.every(
        (match) =>
          match.before.name.includes('legacy-') &&
          match.after.name.includes('builtin-') &&
          match.reasons.some((reason) =>
            reason.startsWith('style module overlap'),
          ),
      ),
    ).toBe(true);

    const beforeMainChunk = before.chunks.find(
      (chunk) => chunk.name === 'main',
    );
    expect(beforeMainChunk?.moduleResources).toEqual(
      expect.arrayContaining(['src/cycle/a.js', 'src/cycle/b.js']),
    );
    expect(before.chunks.map((chunk) => chunk.name)).toEqual(
      expect.arrayContaining([
        'main',
        'dashboard',
        'dashboard-details',
        'settings',
      ]),
    );

    const mainCss = comparison.matched.find((match) =>
      match.before.entrypoints.includes('main'),
    );
    expect(mainCss?.before.styleModuleKeys).toEqual(
      expect.arrayContaining([
        'resource:src/components/app-shell.module.css',
        'resource:src/components/card/card.module.css',
        'resource:src/shared/theme.module.css',
        'resource:src/styles/shared.css',
      ]),
    );
    expect(
      mainCss?.before.styleModuleKeys.filter(
        (key) => key === 'resource:src/styles/shared.css',
      ),
    ).toHaveLength(1);

    const contentComparison = await compareOutputContents(
      comparison.matched.map((match) => ({
        beforeName: match.before.name,
        afterName: match.after.name,
      })),
      {
        beforeRoot: path.join(outputRoot, 'css-loader'),
        afterRoot: path.join(outputRoot, 'builtin-css'),
      },
    );
    expect(contentComparison).toMatchObject({
      formatted: 4,
      equivalent: 4,
      changed: 0,
      skipped: 0,
      errors: 0,
    });
    expect(
      contentComparison.files.every(
        (file) =>
          file.cssDeclarationBlocksMatched > 0 &&
          file.cssSelectorsNormalized > 0,
      ),
    ).toBe(true);

    const contentDiff = renderOutputContentDiff(contentComparison);
    expect(contentDiff).toContain('No content differences');
    const report = renderOutputGraphDiffMarkdown(comparison, {
      contentComparison,
      contentDiffFilename: 'report.diff',
    });
    expect(report).toContain('Prettier-formatted Content Diff');
    expect(report).toContain('Equivalent after normalization: 4');

    const rawBeforeCss = comparison.matched
      .map((match) =>
        readFileSync(
          path.join(outputRoot, 'css-loader', match.before.name),
          'utf8',
        ),
      )
      .join('\n');
    const rawAfterCss = comparison.matched
      .map((match) =>
        readFileSync(
          path.join(outputRoot, 'builtin-css', match.after.name),
          'utf8',
        ),
      )
      .join('\n');
    expect(rawBeforeCss).toMatch(/cm_[A-Za-z0-9_-]+__[A-Za-z0-9_-]{5}/);
    expect(rawAfterCss).toMatch(/cm_[-A-Za-z0-9_.\\]+__[A-Za-z0-9_-]{5}/);
    expect(rawBeforeCss).not.toBe(rawAfterCss);
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
}, 30_000);
