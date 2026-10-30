# CSS migration example

This project builds the same source twice:

- `rspack.css-loader.config.mjs` uses `css-loader` and
  `CssExtractRspackPlugin`.
- `rspack.builtin-css.config.mjs` uses Rspack's built-in `type: 'css/auto'`.

Both configurations install `RspackOutputGraphPlugin`. Their CSS filename
prefixes intentionally differ so the report must use module/chunk graph data
instead of filename equality.

The source graph includes nested imports, a JavaScript cycle, repeated CSS and
CSS Module imports, two first-level lazy chunks, and a lazy chunk nested inside
another lazy chunk. CSS Modules use the same readable local-name template in
both builds, while deliberately retaining each implementation's different hash
value.

From the repository root, run:

```bash
pnpm run example
```

The command builds both variants, formats matched text assets with Prettier,
normalizes CSS Modules hash noise, and writes:

- `dist/report.md` for graph matching and formatted-content statistics.
- `dist/report.diff` for the unified content diff.

The same setup is also executed by the repository's integration test.
