import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { createRsbuild, type RsbuildConfig } from '@rsbuild/core';
import { expect, test } from '@rstest/core';
import type { PublicPath } from '@rspack/core';
import { parse } from 'postcss';
import {
  compareOutputContents,
  compareOutputGraphs,
  DEFAULT_OUTPUT_GRAPH_FILENAME,
  loadOutputGraph,
  pluginBuiltinCss,
  RspackOutputGraphPlugin,
} from '../src/index';

async function buildUrlFixture(
  root: string,
  {
    builtinCss = true,
    publicPath = '/',
    request = './theme.css?url',
    output = {},
    tools = {},
    watchChange = false,
  }: {
    builtinCss?: boolean;
    publicPath?: PublicPath;
    request?: string;
    output?: RsbuildConfig['output'];
    tools?: RsbuildConfig['tools'];
    watchChange?: boolean;
  } = {},
) {
  const src = path.join(root, 'src');
  mkdirSync(src, { recursive: true });
  writeFileSync(
    path.join(src, 'index.js'),
    `import url from ${JSON.stringify(request)}; export { url };`,
  );
  writeFileSync(
    path.join(src, 'theme.css'),
    '@import "./nested.css" layer(theme) screen;\n.main { background: url("./icon.svg"); color: red; }',
  );
  writeFileSync(path.join(src, 'nested.css'), '.nested { color: blue; }');
  writeFileSync(path.join(src, 'theme.module.css'), '.main { color: red; }');
  writeFileSync(
    path.join(src, 'icon.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>',
  );
  const variant = builtinCss ? 'builtin-css' : 'css-loader';
  const rsbuild = await createRsbuild({
    cwd: root,
    rsbuildConfig: {
      plugins: builtinCss ? [pluginBuiltinCss()] : [],
      source: { entry: { main: './src/index.js' } },
      output: {
        target: 'web',
        minify: false,
        dataUriLimit: 0,
        sourceMap: false,
        ...output,
        distPath: { root: `dist/${variant}`, css: 'static/css' },
        filename: {
          js: 'bundle.cjs',
          css: '[name].[contenthash:8].css',
          ...output.filename,
        },
      },
      tools: {
        lightningcssLoader: false,
        ...tools,
        rspack(config) {
          config.mode = 'production';
          config.output ??= {};
          config.output.publicPath = publicPath;
          config.output.library = { type: 'commonjs2' };
          config.plugins ??= [];
          config.plugins.push(new RspackOutputGraphPlugin());
        },
      },
    },
  });
  if (watchChange) {
    const compiler = await rsbuild.createCompiler();
    let watcher: ReturnType<typeof compiler.watch> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        let builds = 0;
        watcher = compiler.watch({}, (error, stats) => {
          if (error) return reject(error);
          if (stats?.hasErrors()) return reject(new Error(stats.toString()));
          if (builds++ === 0) {
            writeFileSync(
              path.join(src, 'nested.css'),
              '.nested { color: green; }',
            );
          } else {
            resolve();
          }
        });
      });
    } finally {
      if (watcher) {
        await new Promise<void>((resolve, reject) =>
          watcher!.close((error) => (error ? reject(error) : resolve())),
        );
      }
      await new Promise<void>((resolve, reject) =>
        compiler.close((error) => (error ? reject(error) : resolve())),
      );
    }
  } else {
    await rsbuild.build();
  }
  const dist = path.join(root, 'dist', variant);
  const files = readdirSync(dist, { recursive: true }) as string[];
  const bundle = files.find((file) => file.endsWith('bundle.cjs'));
  if (!bundle) throw new Error('Missing URL fixture bundle');
  const module = { exports: {} as { url: string } };
  const appliedStyles: unknown[] = [];
  runInNewContext(readFileSync(path.join(dist, bundle), 'utf8'), {
    module,
    exports: module.exports,
    self: {},
    document: {
      currentScript: {
        tagName: 'SCRIPT',
        src: 'https://example.com/app/bundle.cjs',
      },
      getElementsByTagName: () => [],
      head: { appendChild: (element: unknown) => appliedStyles.push(element) },
    },
  });
  const cssFiles = files.filter((file) => file.endsWith('.css'));
  const currentCss = cssFiles.filter((file) =>
    module.exports.url.endsWith(file),
  );
  return {
    dist,
    graph: loadOutputGraph(path.join(dist, DEFAULT_OUTPUT_GRAPH_FILENAME)),
    url: module.exports.url,
    cssFiles: currentCss,
    css: currentCss
      .map((file) => readFileSync(path.join(dist, file), 'utf8'))
      .join('\n'),
    files,
    appliedStyles,
  };
}

test('CSS URL imports compile nested styles and preserve asset paths for each public path', async () => {
  for (const publicPath of [
    'auto',
    '',
    './',
    '../',
    '/',
    'https://cdn.example.com/',
    () => 'https://cdn.example.com/',
  ]) {
    const root = mkdtempSync(path.join(tmpdir(), 'builtin-css-url-'));
    try {
      const before = await buildUrlFixture(root, {
        builtinCss: false,
        publicPath,
      });
      const after = await buildUrlFixture(root, { publicPath });
      expect(after.cssFiles).toHaveLength(1);
      expect(after.url).toContain(after.cssFiles[0]);
      expect(after.css).toContain('.nested');
      expect(after.css).toContain('@layer theme');
      expect(after.css).toContain('@media screen');
      expect(after.css).not.toContain('@import');
      const image = after.files.find((file) => file.endsWith('.svg'));
      expect(image).toBeDefined();
      const resolvedPublicPath =
        typeof publicPath === 'function' ? publicPath() : publicPath;
      const assetUrl =
        resolvedPublicPath === 'auto'
          ? `${path.posix.relative(path.posix.dirname(after.cssFiles[0]), '.')}/${image}`
          : `${resolvedPublicPath}${image}`;
      expect(after.css).toContain(assetUrl);
      expect(before.css).toContain(assetUrl);
      expect(after.appliedStyles).toEqual([]);
      expect(after.files).not.toContain('__builtin_css_url__.js');
      const comparison = compareOutputGraphs(before.graph, after.graph, {
        extensions: ['css'],
      });
      expect(comparison.matched).toHaveLength(1);
      expect(comparison.added).toEqual([]);
      expect(comparison.removed).toEqual([]);
      expect(
        after.graph.chunks
          .flatMap((chunk) => chunk.moduleIdentifiers)
          .join('\n'),
      ).not.toContain('css-loader');
      const contents = await compareOutputContents(
        comparison.matched.map((match) => ({
          beforeName: match.before.name,
          afterName: match.after.name,
        })),
        { beforeRoot: before.dist, afterRoot: after.dist },
      );
      expect(contents).toMatchObject({ formatted: 1, skipped: 0, errors: 0 });
      // Native CSS preserves quotes and adds whitespace around inlined imports.
      // Compare the parsed structure to the baseline without those differences.
      const structure = (css: string) =>
        JSON.parse(
          JSON.stringify(parse(css).toJSON(), (key, value) =>
            ['raws', 'source', 'inputs'].includes(key)
              ? undefined
              : key === 'value'
                ? value.replace(/url\((["'])(.*?)\1\)/g, 'url($2)')
                : value,
          ),
        );
      expect(structure(after.css)).toEqual(structure(before.css));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}, 30_000);

test('CSS URL child compilation preserves PostCSS, source maps, and filename callbacks', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'builtin-css-url-transforms-'));
  try {
    const result = await buildUrlFixture(root, {
      output: {
        sourceMap: { css: true, js: 'source-map' },
        filename: {
          css: ({ chunk }) => `custom/${chunk?.name}.[contenthash:5].css`,
        },
      },
      tools: {
        postcss: {
          postcssOptions: {
            plugins: [
              {
                postcssPlugin: 'css-url-fixture',
                Declaration: {
                  color(declaration) {
                    declaration.value = 'green';
                  },
                },
              },
            ],
          },
        },
      },
    });
    expect(result.cssFiles[0]).toMatch(
      /^static\/css\/custom\/theme\.\w{5}\.css$/,
    );
    expect(result.css).not.toContain('color: red');
    expect(result.css).not.toContain('color: blue');
    expect(result.css).toContain('color: green');
    expect(result.files).toContain(`${result.cssFiles[0]}.map`);
    expect(result.files).not.toContain('__builtin_css_url__.js.map');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

test('changing an imported stylesheet rebuilds the CSS URL and content in watch mode', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'builtin-css-url-watch-'));
  try {
    const result = await buildUrlFixture(root, { watchChange: true });
    expect(result.css).toContain('.nested { color: green; }');
    expect(result.css).not.toContain('color: blue');
    expect(result.url).toContain(result.cssFiles[0]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

test('CSS URL imports still emit standalone CSS when ordinary CSS is injected or disabled', async () => {
  for (const output of [
    { injectStyles: true },
    { emitCss: false },
    { target: 'node' as const },
  ]) {
    const root = mkdtempSync(path.join(tmpdir(), 'builtin-css-url-output-'));
    try {
      const result = await buildUrlFixture(root, { output });
      expect(result.cssFiles).toHaveLength(1);
      expect(result.url).toContain(result.cssFiles[0]);
      expect(result.appliedStyles).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}, 30_000);

test('CSS Modules URL imports retain Rsbuild errors', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'builtin-css-url-modules-'));
  try {
    await expect(
      buildUrlFixture(root, { request: './theme.module.css?url' }),
    ).rejects.toThrow('Rspack build failed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
