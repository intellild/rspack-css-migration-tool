---
name: rspack-css-migration
description: Migrate css-loader and Rsbuild CSS pipelines to Rspack built-in CSS and compare build outputs. Use for CSS migration, builtin CSS adoption, or migration verification.
---

# Rspack CSS migration

Inspect the project's Rspack/Rsbuild version, CSS rules, CSS Modules settings,
preprocessors, PostCSS plugins, CSS queries, and style imports before editing.
Use the package's `pluginBuiltinCss` for Rsbuild. For direct Rspack usage, keep
one configuration and switch its CSS rules and extraction plugin with an
environment variable, as shown in `examples/rspack/rspack.config.mjs`.

## Build a baseline

Build with the existing css-loader pipeline first. Install
`RspackOutputGraphPlugin` in both builds and write them to separate output
directories. Preserve the baseline when building the migrated version.

## Convert configuration

Follow the “已有的配置转换” section of
[the Rsbuild builtin CSS RFC](https://bytedance.larkoffice.com/wiki/YF4swBYBziv9hbkyJEDcUlmFnjg).
Use the option names supported by the installed Rspack version; the current
names are `parser.namedExports` and `generator.exportsConvention`.

- Map `output.cssModules.auto === false` to `type: 'css'`. Otherwise use
  `css/auto` and preserve RegExp/path-based function auto conditions,
  `.module.*`, `.modules.*`, and explicit `?module` requests. Move auto
  callbacks that depend on the query or fragment into explicit Rspack rules;
  native resource predicates receive the resource path only.
- For matching CSS Modules, map `mode: 'local'` to `css/module`, `global` to
  `css/global`, and `pure` to `css/module` with `parser.pure: true`. Evaluate
  a mode function with each resource path. Warn that `icss` has no independent
  switch and falls back to `css/module`.
- Map `namedExport` to `parser.namedExports`.
- Map `exportLocalsConvention` values `asIs`, `camelCase`, `camelCaseOnly`,
  `dashes`, and `dashesOnly` to `as-is`, `camel-case`, `camel-case-only`,
  `dashes`, and `dashes-only`.
- Preserve `localIdentName` unless the migration explicitly overrides it.
  Keep hash settings under the plugin's `modules` option.
- Map `emitCss` to stylesheet export (`exportType: 'link'`). Map
  `injectStyles` to `exportType: 'style'`. For environments that do not emit
  CSS, use `generator.exportsOnly: true`.
- Map `?inline` to `type: 'css'` with `parser.exportType: 'text'`. Keep
  `?raw` and text import attributes on the existing `asset/source` pipeline.
- Remove css-loader, the extraction/style/ignore loaders, and
  `CssExtractRspackPlugin`. Preserve Sass/Less/Stylus, PostCSS, and Lightning
  CSS loaders and the configured entry/async CSS output filenames.
- Ignore `tools.cssLoader`. Move its supported settings to
  `output.cssModules` or `pluginBuiltinCss` options. Migrate URL filtering
  separately to Rspack `externals`; do not silently drop required exclusions.
- Warn when `exportGlobals` is used; builtin CSS has no equivalent switch.

Use these module parser defaults to stay close to css-loader:

```js
{
  animation: true,
  dashedIdents: false,
  customIdents: false,
  container: false,
  grid: false,
  function: false,
}
```

Plugin options override the corresponding converted settings. Keep
`exportType`, `exportsConvention`, `exportsOnly`, and `esModule` at the top
level, with identifier hash/name settings and parser switches in `modules`.

## Migrate CSS `?url` imports

Check the installed Rspack version and its `import.meta.resolve` semantics
before changing source code. Syntax support alone does not mean resource URL
support: Rspack 2.0.0 introduced the experimental API, and the verified 2.3.0
implementation still returns a module ID, like `require.resolve`. Do not
invent a minimum version for URL support or treat `importMetaResolve: true`
as a capability check.

For a version with verified resource URL support, find imports, re-exports,
and dynamic imports that request CSS with `?url`, including preprocessor
files. Replace the URL lookup with `import.meta.resolve`, remove the query,
and remove the obsolete CSS `?url` rule:

```js
// Before
import stylesheetUrl from './styles.css?url';

// After
const stylesheetUrl = import.meta.resolve('./styles.css');
```

Enable `module.parser.javascript.importMetaResolve: true` where that version
requires it. Confirm in a real build that the returned value names an emitted
stylesheet, respects publicPath, and does not apply styles automatically.

For versions without verified resource URL support, keep the `?url` imports.
`pluginBuiltinCss` replaces Rsbuild's CSS URL loader with the package's
`rspack-css-migration-tool/css-url-loader`. Its pitch creates a child compiler
using native CSS and the remaining preprocessors, takes the emitted
stylesheet and assets, and exports the stylesheet URL. It preserves nested
imports, automatic/relative/CDN public paths, and configured filenames.
Register child assets and file/context/missing/build dependencies on the
importing module so cached builds and watch rebuilds retain them. CSS Modules
with `?url` remain an error; use `?inline` for compiled CSS text.

Check the emitted CSS, nested `@import` and `url()` assets, public paths, and
the resulting stylesheet URL in a real build. Do not replace the lookup with
a side-effect CSS import, which changes when styles are applied.

## Verify the migration

Build both environment-variable variants and compare their CSS outputs:

```bash
rspack-css-output-compare \
  --before path/to/css-loader-dist \
  --after path/to/builtin-css-dist \
  --extensions css \
  --require-graph \
  --check \
  --out path/to/report.md
```

Investigate added/removed assets and content differences. Verify exported
CSS Module names, async CSS loading, emitted stylesheet URLs, injected styles,
inline/raw imports, and environments with `exportsOnly`. Generated identifiers
may differ; use graph pairing and declaration normalization to compare styles.
