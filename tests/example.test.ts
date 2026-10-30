import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rspack } from '@rspack/core';
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
import { createMigrationConfigs } from '../examples/css-migration/config.mjs';

function build(config: Parameters<typeof rspack>[0]): Promise<void> {
  const compiler = rspack(config);
  return new Promise((resolve, reject) => {
    compiler.run((error, stats) => {
      const finish = (buildError?: Error) => {
        compiler.close((closeError) => {
          if (buildError) reject(buildError);
          else if (closeError) reject(closeError);
          else resolve();
        });
      };

      if (error) {
        finish(error);
      } else if (!stats || stats.hasErrors()) {
        finish(
          new Error(stats?.toString({ colors: false }) ?? 'Rspack failed'),
        );
      } else {
        finish();
      }
    });
  });
}

test('the example migrates from css-loader and still matches both CSS outputs', async () => {
  const outputRoot = mkdtempSync(
    path.join(tmpdir(), 'rspack-css-migration-example-'),
  );

  try {
    const configs = createMigrationConfigs(
      outputRoot,
      RspackOutputGraphPlugin,
    ) as Parameters<typeof rspack>[0][];
    for (const config of configs) await build(config);

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
      equivalent: 3,
      changed: 1,
      skipped: 0,
      errors: 0,
    });
    expect(
      contentComparison.files.every(
        (file) => file.cssModuleHashesNormalized > 0,
      ),
    ).toBe(true);

    const contentDiff = renderOutputContentDiff(contentComparison);
    expect(contentDiff).not.toMatch(/__[A-Za-z0-9_-]{5}\b/);
    expect(contentDiff).toContain('--accent-color');
    const report = renderOutputGraphDiffMarkdown(comparison, {
      contentComparison,
      contentDiffFilename: 'report.diff',
    });
    expect(report).toContain('Prettier-formatted Content Diff');
    expect(report).toContain('Equivalent after normalization: 3');

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
