# rspack-css-migration-tool

Utilities for comparing build output while migrating from `css-loader` and
`CssExtractRspackPlugin` to Rspack's built-in CSS support.

## Output graph plugin

Add `RspackOutputGraphPlugin` to both your pre-migration and post-migration
Rspack configurations:

```js
import { RspackOutputGraphPlugin } from 'rspack-css-migration-tool';

export default {
  plugins: [new RspackOutputGraphPlugin()],
};
```

Each build writes `.rspack-css-migration-tool/output-graph.json` in the output
directory for use by the comparison tool.

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

## Rsbuild output graph plugin

For Rsbuild, register `pluginOutputGraph()` in both the baseline and migrated
configurations. It accepts the same options as `RspackOutputGraphPlugin`, with
`context` defaulting to the Rsbuild project root.

```js
import { defineConfig } from '@rsbuild/core';
import { pluginOutputGraph } from 'rspack-css-migration-tool';

export default defineConfig({
  plugins: [pluginOutputGraph()],
  // On an Rsbuild version with native CSS support:
  css: {
    exportType: 'link',
    exportsConvention: 'as-is',
    modules: { localIdentName: '[local]-[hash:base64:6]' },
  },
});
```

Use `css: false` for the `css-loader` baseline. `@rsbuild/core` is an optional
peer dependency, required only when using `pluginOutputGraph`. When building
multiple environments, configure a separate output directory for each
environment so their graph files do not overwrite one another.

## Compare two builds

Build the package first, then compare the baseline and migrated output
directories:

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

Common options:

- `--require-graph`: Fail if either directory is missing its output graph
  manifest (recommended in CI).
- `--no-graph`: Skip output graphs and pair files by normalized filename instead.
- `--no-css-selector-normalize`: Keep raw generated CSS Modules class names in
  the diff to inspect selector identifier changes.
- `--no-css-url-quote-normalize`: Keep original `url()` quoting in content
  diffs.
- `--check`: Exit with status 1 if any assets are added/removed or any compared
  contents differ, skip, or error.

By default, supported text outputs are formatted before comparison, `url()`
quoting is canonicalized, and differing generated CSS Modules class names are
normalized when declarations match.

## Examples

[`examples/rspack`](./examples/rspack) and [`examples/rsbuild`](./examples/rsbuild)
demonstrate migrating a project from `css-loader` to built-in CSS and comparing
the outputs:

```bash
pnpm run example
# Or run either example:
pnpm run example:rspack
pnpm run example:rsbuild
```

Both examples use a single configuration where `BUILTIN_CSS=true` selects the
migrated pipeline (`css: { ... }` vs `css: false` in the Rsbuild example):

```bash
pnpm run build
BUILTIN_CSS=false node examples/rspack/build.mjs
BUILTIN_CSS=true node examples/rspack/build.mjs
BUILTIN_CSS=false node examples/rsbuild/build.mjs
BUILTIN_CSS=true node examples/rsbuild/build.mjs
```

Each example writes its report and unified diff to `dist/report.md` and
`dist/report.diff` within its directory.

## Development

```bash
pnpm run build
pnpm run test
pnpm run lint
```
