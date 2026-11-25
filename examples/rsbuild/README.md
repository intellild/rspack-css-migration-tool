# Rsbuild CSS migration example

`rsbuild.config.mjs` uses Rsbuild's `css-loader` baseline (`css: false`) unless
`BUILTIN_CSS=true`, which enables Rsbuild's native `css` configuration
(requiring an Rsbuild version with built-in CSS support).

Run from the repository root:

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

Or run both builds and the comparison in one step:

```bash
pnpm run example:rsbuild
```

`node examples/rsbuild/build.mjs` also accepts `css-loader`, `builtin-css`, or
`all` (default).

The example emits four CSS assets with intentionally different filenames and
generated selectors between the two builds. Check `dist/report.md` for four
matched and equivalent CSS assets with zero added, removed, or changed files,
and `dist/report.diff` for no content differences.

Follow [the migration skill](../../skills/rspack-css-migration/SKILL.md) to run
and verify a migration.
