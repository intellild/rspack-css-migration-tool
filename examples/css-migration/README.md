# CSS migration example

This example builds the same source twice:

- `rspack.css-loader.config.mjs` uses `css-loader` and
  `CssExtractRspackPlugin`.
- `rspack.builtin-css.config.mjs` uses Rspack's built-in `type: 'css/auto'`.

Both configurations install `RspackOutputGraphPlugin`. Their CSS filename
prefixes intentionally differ so the report must use module/chunk graph data
instead of filename equality.

The source graph includes nested imports, a JavaScript cycle, repeated CSS and
CSS Module imports, two first-level lazy chunks, and a lazy chunk nested inside
another lazy chunk. CSS Modules deliberately retain the different generated
class names produced by each implementation.

## Run the migration step by step

Run every command below from the repository root.

1. Install the workspace dependencies.

```bash
pnpm install
```

2. Build `rspack-css-migration-tool`. The example configurations load the
   plugin from `dist/index.js`.

```bash
pnpm run build
```

3. Build the baseline with `css-loader`.

```bash
node examples/css-migration/build.mjs css-loader
```

The baseline configuration uses `type: 'javascript/auto'`,
`CssExtractRspackPlugin.loader`, `css-loader`, and
`CssExtractRspackPlugin`. Its output is written to
`examples/css-migration/dist/css-loader`.

4. Review the migration in `rspack.builtin-css.config.mjs`. The migrated
   configuration removes `css-loader` and `CssExtractRspackPlugin`, changes the
   CSS rule to `type: 'css/auto'`, and moves the CSS Modules settings to
   `module.parser['css/auto']` and `module.generator['css/auto']`.

5. Build the migrated version with Rspack's built-in CSS support.

```bash
node examples/css-migration/build.mjs builtin-css
```

Its output is written to `examples/css-migration/dist/builtin-css`.

6. Compare the two output directories.

```bash
node scripts/compare-output-files.mjs \
  --before examples/css-migration/dist/css-loader \
  --after examples/css-migration/dist/builtin-css \
  --extensions css \
  --require-graph \
  --check \
  --out examples/css-migration/dist/report.md
```

The comparer first uses each build's output graph to pair renamed entry and
async CSS assets. It then formats each pair, matches declaration blocks by
SimHash distance, and normalizes only the generated class selectors belonging
to matched blocks. `--check` exits with a failure when assets are added or
removed, content changes, formatting is skipped, or comparison errors occur.

7. Verify the generated files:

- `examples/css-migration/dist/report.md` must show `Matched: 4`, `Added: 0`,
  `Removed: 0`, `Equivalent after normalization: 4`, and `Changed: 0`.
- `examples/css-migration/dist/report.diff` must say that there are no content
  differences after formatting and normalization.

8. Run the complete workflow with one command when changing the fixture or the
   comparison code.

```bash
pnpm run example
```

The same build and comparison behavior is covered by `tests/example.test.ts`.
