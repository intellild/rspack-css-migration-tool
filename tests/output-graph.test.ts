import { describe, expect, test } from '@rstest/core';
import {
  compareOutputGraphs,
  createOutputGraph,
  type OutputGraph,
  type OutputGraphAsset,
} from '../src/index';

function asset(
  name: string,
  styleModuleKeys: string[],
  bytes = 100,
): OutputGraphAsset {
  return {
    name,
    normalizedName: name,
    extension: '.css',
    kind: 'css',
    bytes,
    chunkKeys: [],
    entrypoints: [],
    moduleIdentifiers: [],
    moduleResources: styleModuleKeys,
    moduleKeys: styleModuleKeys,
    styleModuleKeys,
    issuerModuleKeys: [],
  };
}

function graph(name: string, assets: OutputGraphAsset[]): OutputGraph {
  return {
    version: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    compilation: { name, hash: null, context: '/project' },
    assets,
    chunks: [],
  };
}

describe('createOutputGraph', () => {
  test('reads chunkGraph modules and moduleGraph issuers', () => {
    const chunk = {
      id: 1,
      ids: [1],
      name: 'main',
      files: new Set(['assets/main.12345678.css', 'assets/main.js']),
      auxiliaryFiles: new Set(['assets/main.js.map']),
      canBeInitial: () => true,
    };
    const issuer = {
      resource: '/project/src/index.js',
      identifier: () => '/project/src/index.js',
    };
    const styleModule = {
      type: 'css/mini-extract',
      resource: '/project/src/main.css?used',
      identifier: () => '/loaders/css-loader.js!/project/src/main.css?used',
    };
    const styleLoaderModule = {
      resource: '/project/src/main.css?used',
      identifier: () =>
        '/loaders/extract.js!/loaders/css-loader.js!/project/src/main.css?used',
    };
    const jsModule = {
      type: 'javascript/auto',
      resource: '/project/src/index.js',
      identifier: () => '/project/src/index.js',
      modules: [
        {
          type: 'javascript/esm',
          resource: '/project/src/cycle/a.js',
          identifier: () => '/project/src/cycle/a.js',
        },
        {
          type: 'javascript/esm',
          resource: '/project/src/cycle/b.js',
          identifier: () => '/project/src/cycle/b.js',
        },
      ],
    };
    const sizes = new Map([
      ['assets/main.12345678.css', 120],
      ['assets/main.js', 80],
      ['assets/main.js.map', 200],
      ['favicon.ico', 10],
    ]);

    const output = createOutputGraph(
      {
        name: 'before',
        hash: 'hash',
        compiler: { context: '/project' },
        chunks: new Set([chunk]),
        entrypoints: new Map([['app', { getChunks: () => new Set([chunk]) }]]),
        chunkGraph: {
          getChunkModulesIterable: () => [styleModule, jsModule],
          getModuleId: (module) => (module === styleModule ? 1 : 2),
        },
        moduleGraph: {
          getIssuer: (module) => {
            if (module === styleModule) return styleLoaderModule;
            if (module === styleLoaderModule) return issuer;
            return undefined;
          },
        },
        getAssets: () =>
          [...sizes].map(([name]) => ({
            name,
            source: { size: () => sizes.get(name) ?? 0 },
          })),
        getAsset: (name) => ({
          source: { size: () => sizes.get(name) ?? 0 },
        }),
      },
      { context: '/project' },
    );

    expect(output.assets.map((item) => item.name)).toEqual([
      'assets/main.12345678.css',
      'assets/main.js',
      'assets/main.js.map',
      'favicon.ico',
    ]);
    const css = output.assets[0];
    expect(css?.normalizedName).toBe('assets/main.css');
    expect(css?.entrypoints).toEqual(['app']);
    expect(css?.styleModuleKeys).toEqual(['resource:src/main.css']);
    expect(css?.issuerModuleKeys).toEqual(['resource:src/index.js']);
    expect(css?.bytes).toBe(120);
    expect(output.chunks[0]?.moduleResources).toEqual(
      expect.arrayContaining(['src/cycle/a.js', 'src/cycle/b.js']),
    );
    expect(
      output.chunks[0]?.modules.find(
        (module) => module.resource === 'src/index.js',
      ),
    ).toMatchObject({
      id: 2,
      resource: 'src/index.js',
    });
    expect(
      output.chunks[0]?.modules.find(
        (module) => module.resource === 'src/main.css',
      ),
    ).toMatchObject({
      id: 1,
      resource: 'src/main.css',
      style: true,
      issuer: { key: 'resource:src/index.js' },
    });
  });
});

describe('compareOutputGraphs', () => {
  test('matches renamed CSS assets by their style modules', () => {
    const comparison = compareOutputGraphs(
      graph('before', [asset('legacy-main.css', ['resource:src/main.css'])]),
      graph('after', [
        asset('builtin-app.css', ['resource:src/main.css'], 110),
      ]),
      { extensions: ['css'] },
    );

    expect(comparison.matched).toHaveLength(1);
    expect(comparison.matched[0]).toMatchObject({
      before: { name: 'legacy-main.css' },
      after: { name: 'builtin-app.css' },
      bytesDiff: 10,
    });
    expect(comparison.matched[0]?.reasons).toContain(
      'style module overlap 100%',
    );
    expect(comparison.added).toEqual([]);
    expect(comparison.removed).toEqual([]);
  });

  test('uses a global assignment instead of a locally greedy match', () => {
    const comparison = compareOutputGraphs(
      graph('before', [
        asset('before-a.css', ['a', 'b']),
        asset('before-b.css', ['a']),
      ]),
      graph('after', [
        asset('after-x.css', ['a']),
        asset('after-y.css', ['b']),
      ]),
      { extensions: ['css'] },
    );

    expect(
      comparison.matched.map((match) => [match.before.name, match.after.name]),
    ).toEqual([
      ['before-a.css', 'after-y.css'],
      ['before-b.css', 'after-x.css'],
    ]);
  });
});
