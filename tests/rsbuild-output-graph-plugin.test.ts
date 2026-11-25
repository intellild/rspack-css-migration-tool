import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { expect, test } from '@rstest/core';
import {
  DEFAULT_OUTPUT_GRAPH_FILENAME,
  loadOutputGraph,
  pluginOutputGraph,
} from '../src/index';

for (const builtinCss of [false, true]) {
  test(`Rsbuild output graph preserves complete evidence with builtin CSS ${builtinCss}`, async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rsbuild-output-graph-'));
    try {
      mkdirSync(path.join(root, 'src'));
      writeFileSync(
        path.join(root, 'src/index.js'),
        "import './main.css'; console.log(import('./lazy.js'));",
      );
      writeFileSync(path.join(root, 'src/main.css'), '.main { color: red; }');
      writeFileSync(
        path.join(root, 'src/lazy.js'),
        "import './lazy.css'; export const lazy = 1;",
      );
      writeFileSync(path.join(root, 'src/lazy.css'), '.lazy { color: blue; }');
      const filename = builtinCss
        ? 'analysis/graph.json'
        : DEFAULT_OUTPUT_GRAPH_FILENAME;
      const rsbuild = await createRsbuild({
        cwd: root,
        rsbuildConfig: {
          plugins: [pluginOutputGraph({ filename })],
          source: { entry: { main: './src/index.js' } },
          output: { minify: false, sourceMap: false },
          tools: {
            lightningcssLoader: false,
            ...(builtinCss
              ? {
                  bundlerChain(chain, { CHAIN_ID }) {
                    const mainRule = chain.module
                      .rule(CHAIN_ID.RULE.CSS)
                      .oneOf(CHAIN_ID.ONE_OF.CSS_MAIN);
                    mainRule.uses.delete(CHAIN_ID.USE.CSS);
                    mainRule.uses.delete(CHAIN_ID.USE.MINI_CSS_EXTRACT);
                    mainRule
                      .type('css')
                      .set('generator', { exportsOnly: false });
                    chain.plugins.delete(CHAIN_ID.PLUGIN.MINI_CSS_EXTRACT);
                  },
                }
              : {}),
          },
          environments: {
            client: { output: { distPath: { root: './dist/client' } } },
            server: {
              output: {
                target: 'node',
                emitCss: true,
                distPath: { root: './dist/server' },
              },
            },
          },
        },
      });
      await rsbuild.build();
      for (const environment of ['client', 'server']) {
        const graph = loadOutputGraph(
          path.join(root, 'dist', environment, filename),
        );
        expect(graph.compilation.context).toBe(root);
        expect(graph.assets.some((asset) => asset.extension === '.css')).toBe(
          true,
        );
        expect(graph.assets.some((asset) => asset.extension === '.js')).toBe(
          true,
        );
        const modules = graph.chunks.flatMap((chunk) => chunk.modules);
        expect(
          modules.some((module) => module.resource === 'src/index.js'),
        ).toBe(true);
        expect(
          modules.some((module) => module.resource === 'src/lazy.js'),
        ).toBe(true);
        expect(
          modules.some(
            (module) => module.style && module.resource === 'src/main.css',
          ),
        ).toBe(true);
        expect(
          modules.some(
            (module) => module.style && module.resource === 'src/lazy.css',
          ),
        ).toBe(true);
        if (builtinCss) {
          expect(
            modules.some((module) => module.identifier.includes('css-loader')),
          ).toBe(false);
        } else {
          expect(
            modules.some((module) => module.identifier.includes('css-loader')),
          ).toBe(true);
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
}
