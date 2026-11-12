import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRsbuild, type RsbuildConfig } from '@rsbuild/core';
import { expect, rs, test } from '@rstest/core';
import {
  compareOutputContents,
  compareOutputGraphs,
  DEFAULT_OUTPUT_GRAPH_FILENAME,
  loadOutputGraph,
  pluginBuiltinCss,
  RspackOutputGraphPlugin,
  type PluginBuiltinCssOptions,
} from '../src/index';
import {
  createRsbuildConfig,
  exampleRoot,
} from '../examples/rsbuild/rsbuild.config.mjs';

test('the Rsbuild example removes css-loader and preserves all CSS output', async () => {
  const outputRoot = mkdtempSync(path.join(tmpdir(), 'rsbuild-css-migration-'));
  try {
    for (const builtinCss of [false, true]) {
      const rsbuild = await createRsbuild({
        cwd: exampleRoot,
        rsbuildConfig: createRsbuildConfig({
          builtinCss,
          outputRoot,
          builtinCssPlugin: pluginBuiltinCss,
          OutputGraphPlugin: RspackOutputGraphPlugin,
        }),
      });
      await rsbuild.build();
    }

    const beforeRoot = path.join(outputRoot, 'css-loader');
    const afterRoot = path.join(outputRoot, 'builtin-css');
    const before = loadOutputGraph(
      path.join(beforeRoot, DEFAULT_OUTPUT_GRAPH_FILENAME),
    );
    const after = loadOutputGraph(
      path.join(afterRoot, DEFAULT_OUTPUT_GRAPH_FILENAME),
    );
    const comparison = compareOutputGraphs(before, after, {
      extensions: ['css'],
    });
    expect(comparison.matched).toHaveLength(4);
    expect(comparison.added).toEqual([]);
    expect(comparison.removed).toEqual([]);
    expect(
      after.chunks.flatMap((chunk) => chunk.moduleIdentifiers).join('\n'),
    ).not.toContain('css-loader');
    expect(
      after.chunks
        .flatMap((chunk) => chunk.modules)
        .some((module) => module.type === 'css/module'),
    ).toBe(true);
    const contents = await compareOutputContents(
      comparison.matched.map((match) => ({
        beforeName: match.before.name,
        afterName: match.after.name,
      })),
      { beforeRoot, afterRoot },
    );
    expect(contents).toMatchObject({
      equivalent: 4,
      changed: 0,
      skipped: 0,
      errors: 0,
    });
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
}, 30_000);

const require = createRequire(import.meta.url);
const stylesheet = `
.foo-bar {
  --brand: red;
  color: var(--brand);
  container-name: layout;
  grid-template-areas: "main";
  animation: pulse 1s;
}
@keyframes pulse {
  to { opacity: 0.5; }
}
`;

async function buildFixture(
  root: string,
  {
    output = {},
    options = {},
    css = stylesheet,
    request = './style.module.css',
    tools = {},
    sideEffectImport = false,
  }: {
    output?: RsbuildConfig['output'];
    options?: PluginBuiltinCssOptions;
    css?: string;
    request?: string;
    tools?: RsbuildConfig['tools'];
    sideEffectImport?: boolean;
  } = {},
) {
  mkdirSync(path.join(root, 'src'));
  writeFileSync(
    path.join(root, 'src/index.js'),
    sideEffectImport
      ? `import ${JSON.stringify(request)}; export const value = null;`
      : `import value from ${JSON.stringify(request)}; export { value };`,
  );
  writeFileSync(path.join(root, 'src/style.module.css'), css);
  const rsbuild = await createRsbuild({
    cwd: root,
    rsbuildConfig: {
      plugins: [pluginBuiltinCss(options)],
      source: { entry: { main: './src/index.js' } },
      output: {
        target: 'node',
        emitCss: true,
        minify: false,
        sourceMap: false,
        filename: { js: 'bundle.cjs', css: 'style.css' },
        ...output,
        cssModules: {
          auto: true,
          namedExport: false,
          exportLocalsConvention: 'camelCaseOnly',
          localIdentName: 'scoped-[local]-[hash]',
          ...output.cssModules,
        },
      },
      tools: {
        lightningcssLoader: false,
        ...tools,
        rspack(config) {
          config.mode = 'production';
          config.output.library = { type: 'commonjs2' };
        },
      },
    },
  });
  await rsbuild.build();
  const dist = path.join(root, 'dist');
  const files = readdirSync(dist, { recursive: true });
  const bundle = files.find((file) => file.endsWith('bundle.cjs'));
  if (!bundle) throw new Error('Missing fixture bundle');
  const cssFiles = files.filter((file) => file.endsWith('.css'));
  return {
    value: require(path.join(dist, bundle)).value,
    css: cssFiles
      .map((file) => readFileSync(path.join(dist, file), 'utf8'))
      .join('\n'),
    cssFiles,
  };
}

test('converted CSS Modules preserve exports and css-loader-like identifier behavior', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rsbuild-css-modules-'));
  try {
    const result = await buildFixture(root);
    expect(result.value.fooBar).toMatch(/^scoped-foo-bar-[\w-]{6}$/);
    expect(result.value).not.toHaveProperty('foo-bar');
    expect(result.css).toContain('--brand:');
    expect(result.css).toContain('var(--brand)');
    expect(result.css).toMatch(/container-name:\s*layout/);
    expect(result.css).toContain('"main"');
    expect(result.css).toMatch(/@keyframes scoped-pulse-[\w-]{6}/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

test('plugin options override the converted identifier and export convention', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rsbuild-css-options-'));
  try {
    const result = await buildFixture(root, {
      options: {
        exportsConvention: 'as-is',
        modules: { localIdentName: 'builtin-[local]', animation: false },
      },
    });
    expect(result.value['foo-bar']).toBe('builtin-foo-bar');
    expect(result.value).not.toHaveProperty('fooBar');
    expect(result.css).toMatch(/@keyframes pulse/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

test('exportsOnly keeps module exports without emitting stylesheets', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rsbuild-css-exports-only-'));
  try {
    const result = await buildFixture(root, { output: { emitCss: false } });
    expect(result.value.fooBar).toMatch(/^scoped-foo-bar-/);
    expect(result.cssFiles).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

test('inline CSS exports processed text and raw CSS exports its original source', async () => {
  for (const query of ['inline', 'raw']) {
    const root = mkdtempSync(path.join(tmpdir(), `rsbuild-css-${query}-`));
    try {
      const result = await buildFixture(root, {
        request: `./style.module.css?${query}`,
      });
      expect(typeof result.value).toBe('string');
      expect(result.value).toContain('.foo-bar');
      expect(result.cssFiles).toEqual([]);
      if (query === 'raw') expect(result.value).toBe(stylesheet);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}, 30_000);

test('CommonJS text export includes CSS Module mappings and default CSS text', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rsbuild-css-text-'));
  try {
    const result = await buildFixture(root, {
      options: { exportType: 'text', esModule: false },
    });
    expect(typeof result.value.default).toBe('string');
    expect(result.value.default).toContain('.scoped-foo-bar-');
    expect(result.value.fooBar).toMatch(/^scoped-foo-bar-/);
    expect(result.cssFiles).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

test('tools.cssLoader is ignored before its callback can change module behavior', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rsbuild-css-loader-options-'));
  const cssLoader = rs.fn(() => ({ modules: false }));
  try {
    const result = await buildFixture(root, { tools: { cssLoader } });
    expect(cssLoader).not.toHaveBeenCalled();
    expect(result.value.fooBar).toMatch(/^scoped-foo-bar-/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

test('global mode and disabled auto detection preserve global selectors', async () => {
  for (const cssModules of [{ mode: 'global' as const }, { auto: false }]) {
    const root = mkdtempSync(path.join(tmpdir(), 'rsbuild-css-global-'));
    try {
      const result = await buildFixture(root, {
        output: { cssModules },
        sideEffectImport: true,
      });
      expect(result.css).toContain('.foo-bar');
      expect(result.css).not.toContain('.scoped-foo-bar-');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}, 30_000);

test('auto and mode callbacks receive each stylesheet resource', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rsbuild-css-callbacks-'));
  const auto = rs.fn((resource: string) => resource.endsWith('.module.css'));
  const mode = rs.fn(() => 'local' as const);
  try {
    const result = await buildFixture(root, {
      output: { cssModules: { auto, mode } },
    });
    expect(result.value.fooBar).toMatch(/^scoped-foo-bar-/);
    expect(auto).toHaveBeenCalledWith(
      expect.stringMatching(/src\/style\.module\.css$/),
      '',
      '',
    );
    expect(mode).toHaveBeenCalledWith(
      expect.stringMatching(/src\/style\.module\.css$/),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

test('an explicit module query enables CSS Modules when auto detection is disabled', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rsbuild-css-module-query-'));
  try {
    const result = await buildFixture(root, {
      output: { cssModules: { auto: false } },
      request: './style.module.css?module',
    });
    expect(result.value.fooBar).toMatch(/^scoped-foo-bar-/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

test('injectStyles applies CSS through a style element without emitting CSS files', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rsbuild-css-injection-'));
  const globals = globalThis as typeof globalThis & { document?: unknown };
  const previousDocument = globals.document;
  const injected: Array<{ textContent: string }> = [];
  globals.document = {
    getElementsByTagName: () => [],
    createElement: () => ({ textContent: '', setAttribute() {} }),
    head: {
      appendChild(style: { textContent: string }) {
        injected.push(style);
      },
    },
  };
  try {
    const result = await buildFixture(root, {
      output: { injectStyles: true },
    });
    expect(result.cssFiles).toEqual([]);
    expect(result.value.fooBar).toMatch(/^scoped-foo-bar-/);
    expect(injected).toHaveLength(1);
    expect(injected[0].textContent).toContain('.scoped-foo-bar-');
  } finally {
    if (previousDocument === undefined) delete globals.document;
    else globals.document = previousDocument;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

test('pure mode rejects stylesheets with global-only selectors', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rsbuild-css-pure-'));
  try {
    await expect(
      buildFixture(root, {
        output: { cssModules: { mode: 'pure' } },
        css: 'body { color: red; }',
      }),
    ).rejects.toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
