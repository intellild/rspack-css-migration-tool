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
  --out report.md
```

When both directories contain an output graph, the script uses module/chunk
relationships automatically. Otherwise it falls back to normalized filenames.
Use `--require-graph` in CI to prevent an accidental fallback.

## Example and test fixture

[`examples/css-migration`](./examples/css-migration) builds the same source
once with css-loader and once with built-in CSS. It deliberately gives the two
sets of CSS assets different prefixes, then verifies that graph matching still
pairs the entry and async styles correctly.

```bash
pnpm run example
```

The comparison report is written to
`examples/css-migration/dist/report.md`.

## Development

```bash
pnpm run build
pnpm run test
pnpm run lint
```
