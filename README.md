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
  --out report.md
```

When both directories contain an output graph, the script uses module/chunk
relationships automatically. Otherwise it falls back to normalized filenames.
Use `--require-graph` in CI to prevent an accidental fallback.

Before generating the unified diff, supported text assets are formatted with
Prettier. CSS Modules hash suffixes and the filename separator difference
between css-loader and built-in CSS are normalized after formatting. The report
records formatted sizes and line changes; use `--no-css-module-normalize` when
the generated identifiers themselves need to be inspected.

## Example and test fixture

[`examples/css-migration`](./examples/css-migration) builds the same source
once with css-loader and once with built-in CSS. It includes nested, circular,
repeated, and lazy module relationships plus CSS Modules. The output names and
CSS Modules hashes differ between builds, so the fixture verifies graph-based
pairing and normalized content diffs rather than filename equality.

```bash
pnpm run example
```

The comparison report and unified diff are written to
`examples/css-migration/dist/report.md` and
`examples/css-migration/dist/report.diff`.

## Development

```bash
pnpm run build
pnpm run test
pnpm run lint
```
