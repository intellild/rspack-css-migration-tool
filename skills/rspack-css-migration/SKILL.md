---
name: rspack-css-migration
description: Migrate Rspack projects to built-in CSS and verify output parity. Use for css-loader and CssExtractRspackPlugin migrations.
---

# Rspack CSS migration

Treat the migration as an output-equivalence exercise. Preserve a reproducible
css-loader baseline, migrate the configuration, pair corresponding output
assets, inspect their content diffs, and state whether the result is correct.

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

Use the `rspack-css-migration-tool` dependency installed in the consumer
project. The package includes the built plugin and comparison CLI. In a
monorepo, resolve them from the package that owns the Rspack build.

Verify the installed CLI with the consumer's package manager. For pnpm:

```bash
pnpm --dir <consumer-package-root> exec rspack-css-output-compare --help
```

If the dependency is missing, add it to that package's development dependencies
using the project's package manager and dependency policy. Use the installed
package without requiring a source checkout, a local library build, or
`pnpm link`.

## Capture the baseline

Import `RspackOutputGraphPlugin` from `rspack-css-migration-tool` and add one
instance to the baseline configuration:

```js
import { RspackOutputGraphPlugin } from 'rspack-css-migration-tool';

export default {
  plugins: [
    // Existing plugins...
    new RspackOutputGraphPlugin(),
  ],
};
```

Build the unmodified css-loader configuration into a clean, dedicated output
directory. Keep this directory unchanged during the migration. Confirm that it
contains `.rspack-css-migration-tool/output-graph.json`.

## Migrate the configuration

Preserve a separate baseline configuration or another reproducible way to run
the old build. Apply only the changes required for built-in CSS:

- Change the CSS rule from `type: 'javascript/auto'` to
  `type: 'css/auto'`.
- Remove `CssExtractRspackPlugin.loader` and `css-loader` from the rule.
- Remove `CssExtractRspackPlugin` from `plugins`.
- Preserve preprocessors and transformations that built-in CSS does not
  replace, such as Sass or project-specific PostCSS loaders.
- Preserve `output.cssFilename`, `output.cssChunkFilename`, public path,
  source-map, optimization, and split-chunk behavior unless the migration
  requires a deliberate change.
- Add `RspackOutputGraphPlugin` to the migrated configuration as well.

Translate CSS Modules options to built-in CSS configuration:

| css-loader option                | Built-in CSS option                              |
| -------------------------------- | ------------------------------------------------ |
| `modules.namedExport`            | `module.parser['css/auto'].namedExports`         |
| `modules.exportLocalsConvention` | `module.generator['css/auto'].exportsConvention` |
| `modules.localIdentName`         | `module.generator['css/auto'].localIdentName`    |

Do not assume custom `modules.auto`, `exportOnlyLocals`, import filters, URL
filters, or loader-specific transforms have direct equivalents. Trace their
actual behavior and either reproduce it explicitly or report the compatibility
gap.

Build the migrated configuration into a second clean output directory. Confirm
that its output graph exists before comparing anything.

## Pair output assets

Most migrations should produce a one-to-one correspondence between baseline
and migrated CSS assets. Filenames and content hashes may differ. The output
graph comparer uses style modules, chunks, issuers, and entrypoints to pair
renamed entry and async assets without relying on filename equality.

Check the report's pairing before interpreting content:

- Every expected baseline CSS asset should have exactly one migrated match.
- `Added` and `Removed` should normally both be zero.
- Review each match's score and reasons when the pairing is not obvious.
- Treat unmatched or low-confidence assets as a build-graph difference, not a
  content-formatting issue.

Do not rename outputs merely to force filename equality and do not use
filename-only matching as final migration evidence.

## Generate report and diff

Always request explicit report and unified-diff files:

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

The comparer creates missing parent directories for both output paths. It
writes the report and diff before returning the `--check` result, so inspect
the files even when the command exits with status 1.

Verify that both files exist and are non-empty:

```bash
test -s <report-path>.md
test -s <report-path>.diff
```

The default diff is Prettier-formatted and normalizes generated CSS class
selectors only when compatible declaration blocks can be paired. It does not
normalize declaration values, rule order, at-rule context, added rules, or
removed rules.

When generated CSS Modules names may hide the raw difference, run a second
diagnostic comparison:

```bash
pnpm --dir <consumer-package-root> exec rspack-css-output-compare \
  --before <baseline-output-directory> \
  --after <migrated-output-directory> \
  --extensions css \
  --require-graph \
  --no-css-selector-normalize \
  --diff-out <report-path>.raw.diff \
  --out <report-path>.raw.md
```

Keep the normalized diff for semantic comparison and the raw diff for
explaining generated-name changes.

## Review differences

Inspect the report, both diff modes when needed, and the corresponding emitted
files. Most pairs should be identical after formatting and normalization. A
small number may differ for understandable reasons:

- **CSS Modules class hashes:** raw selectors may differ between css-loader and
  built-in CSS. Accept this only when the normalized declaration blocks and
  selector structure are equivalent, each generated name is used consistently
  by its build, and relevant application tests pass.
- **Rule or chunk order:** inspect the exact moved rules in the diff and both
  files. CSS order can change cascade behavior, so accept an order-only
  difference only when overlapping selectors, specificity, layers, media
  queries, and dependent runtime loading cannot change the result, or when a
  browser-level test proves equivalent rendering.
- **Formatting only:** Prettier removes this noise automatically. Do not report
  formatting as a behavioral difference.
- **Declaration, URL, source-map, or asset changes:** treat these as real until
  the responsible configuration or loader behavior is explained and verified.
- **Added, removed, skipped, or errored files:** do not declare the migration
  correct while these remain unexplained.

The normalized `--check` result is a strict automated signal, not a substitute
for reviewing exceptions. Conversely, do not reject a migration solely because
the raw diff contains expected generated class names.

## Validate the consumer

Run the consumer's production build, focused CSS or component tests, and
browser or visual tests when order-sensitive output changed. Verify lazy chunks
and CSS Modules usage at runtime, not only the initial entry output.

## Diagnose pairing failures

- Missing graphs: verify the plugin is present in both effective
  configurations and inspect the actual output directories.
- Added or removed assets: compare entry, async chunk, extraction, and
  split-chunk behavior before inspecting content.
- Changed declarations: inspect the generated report and diff, then check
  retained preprocessors, PostCSS behavior, minimization, URL handling, and
  source maps.
- Weak or incorrect asset pairing: compare plugin `context`, module resources,
  and chunk membership. Do not make filenames equal merely to hide a graph
  mismatch.

Do not weaken comparison flags to make a migration pass.

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
