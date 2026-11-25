# Rspack CSS migration example

`rspack.config.mjs` contains one configuration. Set `BUILTIN_CSS=true` to use
Rspack's built-in CSS; otherwise it builds the `css-loader` and
`CssExtractRspackPlugin` baseline.

Run from the repository root:

```bash
pnpm install
pnpm run build
BUILTIN_CSS=false node examples/rspack/build.mjs
BUILTIN_CSS=true node examples/rspack/build.mjs
node scripts/compare-output-files.mjs \
  --before examples/rspack/dist/css-loader \
  --after examples/rspack/dist/builtin-css \
  --extensions css \
  --require-graph \
  --check \
  --out examples/rspack/dist/report.md
```

Or run both builds and the comparison in one step:

```bash
pnpm run example:rspack
```

`node examples/rspack/build.mjs` also accepts `css-loader`, `builtin-css`, or
`all` (default).

The example emits four CSS assets with intentionally different filenames and
generated CSS Modules selectors between the two builds. Check `dist/report.md`
for four matched and equivalent CSS assets with zero added, removed, or changed
files, and `dist/report.diff` for no content differences.
