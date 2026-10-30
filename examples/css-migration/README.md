# CSS migration example

This project builds the same source twice:

- `rspack.css-loader.config.mjs` uses `css-loader` and
  `CssExtractRspackPlugin`.
- `rspack.builtin-css.config.mjs` uses Rspack's built-in `type: 'css'`.

Both configurations install `RspackOutputGraphPlugin`. Their CSS filename
prefixes intentionally differ so the report must use module/chunk graph data
instead of filename equality.

From the repository root, run:

```bash
pnpm run example
```

The command builds both variants and writes `dist/report.md`. The same setup is
also executed by the repository's integration test.
