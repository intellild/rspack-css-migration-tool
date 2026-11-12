# Rsbuild CSS migration example

`rsbuild.config.mjs` uses Rsbuild's default css-loader pipeline unless
`BUILTIN_CSS=true`, which loads `pluginBuiltinCss` from this package.
The plugin configuration demonstrates the top-level export settings and
nested `modules` hash/name and parser options.

Run these commands from the repository root:

```bash
pnpm install
pnpm run build
BUILTIN_CSS=false node examples/rsbuild/build.mjs
BUILTIN_CSS=true node examples/rsbuild/build.mjs
node scripts/compare-output-files.mjs \
  --before examples/rsbuild/dist/css-loader \
  --after examples/rsbuild/dist/builtin-css \
  --extensions css \
  --require-graph \
  --check \
  --out examples/rsbuild/dist/report.md
```

Run both builds and the comparison with `pnpm run example:rsbuild`.
Without an environment variable, `node examples/rsbuild/build.mjs` builds both
variants. The runner also accepts `css-loader`, `builtin-css`, or `all`.

The source fixture mirrors the Rspack example and emits four entry/async CSS
assets. Both builds include `RspackOutputGraphPlugin`, and their CSS filenames
and generated selectors intentionally differ.

`dist/report.md` should show four matched and equivalent CSS assets, with no
added, removed, or changed assets. The example disables Lightning CSS
transforms to compare the CSS pipeline migration directly.

For projects using CSS `?url`, follow the `import.meta.resolve` migration
instructions in
[the migration skill](../../.trae/skills/rspack-css-migration/SKILL.md).
