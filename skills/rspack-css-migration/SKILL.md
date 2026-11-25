---
name: rspack-css-migration
description: Migrate Rspack projects to built-in CSS and verify output parity. Use for css-loader and CssExtractRspackPlugin migrations.
---

# Rspack CSS migration

Treat the migration as an output-equivalence exercise: capture a reproducible
`css-loader` baseline, migrate the configuration, pair corresponding output
assets, inspect content diffs, and report whether the result is equivalent.

## Discover the consumer project

Identify:

- The consumer package root and package manager.
- Every active Rspack configuration and environment-specific branch.
- The production build command and output directory.
- All CSS rules and `CssExtractRspackPlugin` instances.
- CSS Modules options, preprocessors, PostCSS steps, filename templates,
  public paths, minimizers, source maps, and split-chunk behavior.

Do not migrate an already failing build. Establish the baseline behavior or
record the pre-existing failure first.

## Use the installed tool

Use the `rspack-css-migration-tool` package installed in the consumer project
(in a monorepo, from the package that owns the build). Verify the CLI:

```bash
pnpm --dir <consumer-package-root> exec rspack-css-output-compare --help
```

If the dependency is missing, install it as a devDependency using the project's
package manager.

## Capture the baseline

Import `RspackOutputGraphPlugin` from `rspack-css-migration-tool` and add it to
the baseline configuration:

```js
import { RspackOutputGraphPlugin } from 'rspack-css-migration-tool';

export default {
  plugins: [
    // Existing plugins...
    new RspackOutputGraphPlugin(),
  ],
};
```

Build the unmodified `css-loader` configuration into a clean, dedicated output
directory. Keep this directory unchanged during the migration and confirm that
`<baseline-output-directory>/.rspack-css-migration-tool/output-graph.json`
exists.

## Rsbuild consumers

For Rsbuild, register `pluginOutputGraph()` from `rspack-css-migration-tool` in
both the baseline and migrated configurations:

```js
import { pluginOutputGraph } from 'rspack-css-migration-tool';

export default {
  plugins: [pluginOutputGraph()],
};
```

When building multiple environments, give each environment its own output
directory so graph manifests do not overwrite one another. Enable built-in CSS
using Rsbuild's native `css` configuration and retain `css: false` as the
baseline.

## Migrate the configuration

Preserve a reproducible way to run the baseline build. Apply only the changes
required for built-in CSS:

- Change the CSS rule from `type: 'javascript/auto'` to `type: 'css/auto'`.
- Remove `CssExtractRspackPlugin.loader` and `css-loader` from the rule.
- Remove `CssExtractRspackPlugin` from `plugins`.
- Preserve preprocessors and transforms that built-in CSS does not replace,
  such as Sass, Less, or project-specific PostCSS loaders.
- Preserve `output.cssFilename`, `output.cssChunkFilename`, public path,
  source-map, optimization, and split-chunk behavior unless a deliberate change
  is required.
- Add `RspackOutputGraphPlugin` to the migrated configuration.

Translate CSS Modules options:

| css-loader option                | Built-in CSS option                              |
| -------------------------------- | ------------------------------------------------ |
| `modules.namedExport`            | `module.parser['css/auto'].namedExports`         |
| `modules.exportLocalsConvention` | `module.generator['css/auto'].exportsConvention` |
| `modules.localIdentName`         | `module.generator['css/auto'].localIdentName`    |

Do not assume custom `modules.auto`, `exportOnlyLocals`, import filters, URL
filters, or loader-specific transforms have direct equivalents; trace their
behavior and reproduce it explicitly or report the compatibility gap.

Build the migrated configuration into a second clean output directory and
confirm that its `.rspack-css-migration-tool/output-graph.json` exists before
comparing.

## Compare outputs

Run the comparer with explicit report and unified-diff paths:

```bash
pnpm --dir <consumer-package-root> exec rspack-css-output-compare \
  --before <baseline-output-directory> \
  --after <migrated-output-directory> \
  --extensions css \
  --require-graph \
  --check \
  --diff-out <report-path>.diff \
  --out <report-path>.md
```

The report and diff are written even when `--check` exits with status 1.
Verify both files exist and are non-empty:

```bash
test -s <report-path>.md
test -s <report-path>.diff
```

By default, the comparer formats outputs with Prettier, canonicalizes `url()`
quoting, and normalizes generated CSS Modules class selectors while preserving
declaration values, rule order, at-rule context, and added or removed rules.

To inspect raw generated class-name and `url()` quoting differences as well, run
a second comparison:

```bash
pnpm --dir <consumer-package-root> exec rspack-css-output-compare \
  --before <baseline-output-directory> \
  --after <migrated-output-directory> \
  --extensions css \
  --require-graph \
  --no-css-selector-normalize \
  --no-css-url-quote-normalize \
  --diff-out <report-path>.raw.diff \
  --out <report-path>.raw.md
```

## Review pairing and differences

Check asset pairing in the report before interpreting content diffs:

- Every expected baseline CSS asset should have exactly one migrated match, with
  `Added` and `Removed` both zero.
- Review match scores and reasons if any pairing looks unexpected; treat
  unmatched or low-confidence assets as a build-graph difference rather than a
  content issue.
- Do not change output filenames just to force filename equality, do not rely on
  filename-only matching, and do not weaken comparison flags to pass `--check`.

Inspect the report, diffs, and emitted files for remaining differences:

- **CSS Modules class hashes:** accept raw selector differences only when
  declaration blocks and selector structure match, each generated name is used
  consistently by its build, and relevant tests pass.
- **Rule or chunk order:** accept order-only differences only when overlapping
  selectors, specificity, layers, media queries, and runtime loading order
  cannot change rendering, or when browser tests confirm equivalent rendering.
- **Formatting only:** already eliminated by Prettier; do not report formatting
  as a behavioral change.
- **Declaration, URL, source-map, or asset changes:** treat as real behavioral
  changes until explained and verified.
- **Added, removed, skipped, or errored files:** do not conclude the migration
  is correct while any remain unexplained.

## Validate the consumer

Run the consumer's production build, focused CSS/component tests, and
browser or visual tests when order-sensitive output changed. Verify lazy chunks
and CSS Modules usage at runtime, not only initial entry output.

## Report the conclusion

Summarize:

```text
Pairing: <matched>/<baseline>/<migrated>, <added> added, <removed> removed
Automated comparison: <equivalent> equivalent, <changed> changed, <skipped> skipped, <errors> errors
Reviewed exceptions:
- <before asset> -> <after asset>: <class hash, order, or real content change>
  Evidence: <normalized diff, raw diff, emitted files, and runtime test result>
Conclusion: correct | incorrect | unable to confirm
```

Use `correct` only when every output is paired or otherwise accounted for and
all remaining differences are proven non-behavioral. Use `incorrect` for a
confirmed behavior change. Use `unable to confirm` when order, generated-name
usage, unmatched assets, or runtime behavior cannot be verified.
