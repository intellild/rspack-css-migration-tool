# rspack-css-migration-tool

Utilities for comparing build output while migrating from `css-loader` and
`CssExtractRspackPlugin` to Rspack's built-in CSS support.

## Output graph plugin

Install the plugin in both the pre-migration and post-migration Rspack
configurations:

```js
import { RspackOutputGraphPlugin } from 'rspack-css-migration-tool';

export default {
  plugins: [new RspackOutputGraphPlugin()],
};
```

Each build emits
`.rspack-css-migration-tool/output-graph.json`. The manifest records:

```text
moduleGraph
  Module -> issuer and stable resource key
       ↓
chunkGraph
  Chunk -> modules
       ↓
Chunk files
  Asset -> chunk -> CSS modules
       ↓
compareOutputGraphs
  Globally optimal one-to-one asset matching
```

Absolute module resources below the compiler context are stored as relative
paths. This makes `src/app.css` comparable even when the css-loader module
identifier and Rspack built-in CSS module identifier are different.

Plugin options:

```js
new RspackOutputGraphPlugin({
  filename: '.rspack-css-migration-tool/output-graph.json',
  context: process.cwd(),
  includeModules: true,
  includeAuxiliaryFiles: true,
  stripHash: true,
  collapseNumericChunks: true,
});
```

## Compare two builds

Build the package first, then compare two output directories:

```bash
pnpm run build
node scripts/compare-output-files.mjs \
  --before path/to/css-loader-dist \
  --after path/to/builtin-css-dist \
  --extensions css \
  --diff-out report.diff \
  --check \
  --out report.md
```

When both directories contain an output graph, the script uses module/chunk
relationships automatically. Otherwise it falls back to normalized filenames.
Use `--require-graph` in CI to prevent an accidental fallback.

Before generating the unified diff, supported text assets are formatted with
Prettier. CSS declaration blocks are parsed with PostCSS and fingerprinted with
SimHash. Rules with compatible selector structure and nearby declaration
fingerprints are paired, then differing generated class selectors are
normalized without guessing hash shapes from regular expressions. The report
records matched blocks, normalized selectors, formatted sizes, and line
changes. Use `--no-css-selector-normalize` to inspect generated identifiers.
Use `--check` in CI to fail on added, removed, changed, skipped, or invalid
content.

## Rsbuild built-in CSS plugin

```js
import { defineConfig } from '@rsbuild/core';
import { pluginBuiltinCss } from 'rspack-css-migration-tool';

export default defineConfig({
  plugins: [
    pluginBuiltinCss({
      exportType: 'link',
      exportsConvention: 'as-is',
      exportsOnly: false,
      esModule: true,
      modules: {
        localIdentHashDigest: 'base64url',
        localIdentHashDigestLength: 6,
        localIdentHashFunction: 'xxhash64',
        localIdentHashSalt: 'my-salt',
        localIdentName: '[uniqueName]-[id]-[local]',
        animation: true,
        dashedIdents: false,
        customIdents: false,
        container: false,
        grid: false,
        function: false,
      },
    }),
  ],
});
```

The plugin converts `output.cssModules`, `output.emitCss`, and
`output.injectStyles` to built-in CSS rules, preserves CSS filenames and
preprocessor/PostCSS/Lightning CSS loaders, and removes css-loader and the
extraction plugin. It supports local/global/pure modes, RegExp/function auto
conditions based on resource paths, `?module`, `?inline`, and existing raw/text
imports. Auto callbacks that depend on a query or fragment require explicit
Rspack rules and produce a migration warning.

Plugin options override converted settings. Without overrides, export
conventions, local identifier names, and named exports come from Rsbuild.
Hash defaults are `base64url`, length `6`, and `xxhash64`, with no salt.
Animation renaming is enabled; dashed/custom identifiers, container/grid
names, and CSS function renaming are disabled.

`tools.cssLoader` is ignored. `icss` falls back to `css/module` with a warning;
`exportGlobals` has no equivalent switch.

CSS `?url` imports use a dedicated loader that runs a child compiler with
built-in CSS, emits a standalone stylesheet and its assets, and exports
`import.meta.rspackPublicPath + filename`. This preserves preprocessing,
`@import`, `url()`, CSS filenames, and automatic/relative/CDN public paths
without applying styles. CSS Modules with `?url` remain unsupported, as in
Rsbuild; use `?inline` for their compiled text. Child assets and dependencies
are registered on the importing module for caching, rebuilding, and output
graph comparison. A child compilation adds build work for each distinct URL
import.

Follow [the migration skill](./.trae/skills/rspack-css-migration/SKILL.md)
to check the installed Rspack version before rewriting `?url` to
`import.meta.resolve`. Rspack 2.3.0 returns a module ID from that API,
so this version keeps `?url` and uses the compatibility loader. Only perform
the source rewrite after verifying resource URL support in the target
version. Rsbuild is an optional peer dependency, required only when using
`pluginBuiltinCss`.

## Examples and test fixtures

[`examples/rspack`](./examples/rspack) and
[`examples/rsbuild`](./examples/rsbuild) each build the same source
once with css-loader and once with built-in CSS. They include nested, circular,
repeated, and lazy module relationships plus CSS Modules. The output names and
generated CSS Module selectors differ between builds, so the fixture verifies
graph-based pairing and declaration-based content comparison rather than
filename equality.

```bash
pnpm run example
# Or run either example:
pnpm run example:rspack
pnpm run example:rsbuild
```

Both examples use one configuration with `BUILTIN_CSS=true` selecting the
migrated pipeline. In the Rsbuild example this variable controls whether the
plugin is loaded:

```bash
pnpm run build
BUILTIN_CSS=false node examples/rspack/build.mjs
BUILTIN_CSS=true node examples/rspack/build.mjs
BUILTIN_CSS=false node examples/rsbuild/build.mjs
BUILTIN_CSS=true node examples/rsbuild/build.mjs
```

Each example writes its comparison report and unified diff to
`dist/report.md` and `dist/report.diff` within its directory.

## Development

```bash
pnpm run build
pnpm run test
pnpm run lint
```
