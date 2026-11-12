# Rspack CSS migration example

`rspack.config.mjs` contains one configuration. `BUILTIN_CSS=true` selects
Rspack's built-in CSS; otherwise it uses css-loader and
`CssExtractRspackPlugin`.

Run these commands from the repository root:

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

Run both builds and the comparison with `pnpm run example:rspack`.
Without an environment variable, `node examples/rspack/build.mjs` builds both
variants. The runner also accepts `css-loader`, `builtin-css`, or `all`.

Both variants install `RspackOutputGraphPlugin`. The fixture includes nested,
circular, repeated, and lazy module imports plus CSS Modules. Its entry and
async CSS filenames deliberately differ between pipelines, so comparison uses
module/chunk relationships. Declaration normalization handles generated class
name differences.

`dist/report.md` should show four matched and equivalent CSS assets, with no
added, removed, or changed assets. `dist/report.diff` should report no content
differences after formatting and normalization.
