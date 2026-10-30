import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rspack } from '@rspack/core';
import { expect, test } from '@rstest/core';
import {
  compareOutputGraphs,
  DEFAULT_OUTPUT_GRAPH_FILENAME,
  loadOutputGraph,
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

    expect(comparison.matched).toHaveLength(2);
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

    const rawGraph = readFileSync(beforeGraphPath, 'utf8');
    expect(rawGraph).toContain('src/main.css');
    expect(rawGraph).toContain('src/feature.css');
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
}, 30_000);
