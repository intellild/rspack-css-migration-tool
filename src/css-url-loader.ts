import path from 'node:path';
import type { CSSLoaderOptions } from '@rsbuild/core';
import type {
  Compilation,
  Filename,
  LoaderDefinitionFunction,
  PitchLoaderDefinitionFunction,
  RuleSetRule,
} from '@rspack/core';

export interface CssUrlLoaderOptions {
  filename: Filename;
  modules?: CSSLoaderOptions['modules'];
}

function isCssModule(
  modules: CssUrlLoaderOptions['modules'],
  resource: string,
  query: string,
  fragment: string,
) {
  if (!modules) return false;
  if (modules === true || typeof modules === 'string') return true;
  const { auto } = modules;
  if (auto === false) return false;
  if (auto instanceof RegExp) {
    return new RegExp(auto.source, auto.flags).test(resource);
  }
  if (typeof auto === 'function') return auto(resource, query, fragment);
  return auto === undefined || /\.(?:modules?|icss)\.\w+$/i.test(resource);
}

// A URL import compiles global CSS even when the parent uses text/style exports
// or suppresses normal CSS output. Keep all preprocessing and resolution rules.
function stylesheetRule(rule: RuleSetRule, urlLoader: string): RuleSetRule {
  const uses = Array.isArray(rule.use)
    ? rule.use.filter(
        (use) =>
          (typeof use === 'object' && use ? use.loader : use) !== urlLoader,
      )
    : rule.use;
  const isUrlRule =
    rule.loader === urlLoader ||
    (Array.isArray(uses) &&
      Array.isArray(rule.use) &&
      uses.length !== rule.use.length);
  const result: RuleSetRule = {
    ...rule,
    rules: rule.rules?.map((child) =>
      typeof child === 'object' && child
        ? stylesheetRule(child, urlLoader)
        : child,
    ),
    oneOf: rule.oneOf?.map((child) =>
      typeof child === 'object' && child
        ? stylesheetRule(child, urlLoader)
        : child,
    ),
  };
  if (isUrlRule) {
    delete result.loader;
    delete result.options;
    result.use = uses;
  }
  if (isUrlRule || rule.type?.startsWith('css')) {
    result.type = 'css';
    result.parser = { namedExports: false };
    result.generator = { exportsOnly: false, esModule: true };
  }
  return result;
}

const cssUrlLoader: LoaderDefinitionFunction<CssUrlLoaderOptions> = function (
  source,
) {
  return source;
};

export const pitch: PitchLoaderDefinitionFunction<CssUrlLoaderOptions> =
  async function () {
    const { filename, modules } = this.getOptions();
    if (
      isCssModule(
        modules,
        this.resourcePath,
        this.resourceQuery,
        this.resourceFragment,
      ) ||
      /[?&]module(?:[=&]|$)/.test(this.resourceQuery)
    ) {
      throw new Error(
        '[builtin-css] CSS Modules do not support ?url. Use ?inline for compiled CSS text.',
      );
    }

    const nameSource =
      [path.join(this.rootContext, 'src'), this.rootContext]
        .map((root) => path.relative(root, this.resourcePath))
        .find(
          (relative) =>
            relative &&
            relative !== '..' &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative),
        ) ?? path.basename(this.resourcePath);
    const ext = path.extname(this.resourcePath);
    const name = (
      ext ? nameSource.slice(0, -ext.length) : nameSource
    ).replaceAll(path.sep, '/');
    const compilerName = `builtin-css-url|${this.resource}`;
    const internalJs = '__builtin_css_url__.js';
    const child = this._compilation.createChildCompiler(compilerName, {
      filename: internalJs,
      cssFilename: filename,
    });
    const { EntryPlugin, Compilation: RspackCompilation } =
      this._compiler.rspack;
    child.options.module = {
      ...child.options.module,
      rules: child.options.module.rules.map((rule) =>
        typeof rule === 'object' && rule
          ? stylesheetRule(rule, this.loaders[this.loaderIndex].path)
          : rule,
      ),
    };
    child.options.optimization = {
      ...child.options.optimization,
      runtimeChunk: false,
      splitChunks: false,
    };
    // The child's URL rule uses native CSS and retains the original transform
    // loaders. Resolve those loaders in the child instead of reusing parent
    // `??ident` requests, which cannot reference the child's options registry.
    new EntryPlugin(this.context ?? this.rootContext, this.resource, {
      name,
    }).apply(child);

    let cssFilename: string | undefined;
    child.hooks.thisCompilation.tap(compilerName, (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: compilerName,
          stage: RspackCompilation.PROCESS_ASSETS_STAGE_REPORT,
        },
        () => {
          const entry = compilation.entrypoints.get(name);
          cssFilename = entry?.getFiles().find((file) => file.endsWith('.css'));
          compilation.deleteAsset(internalJs);
          compilation.deleteAsset(`${internalJs}.map`);
        },
      );
    });

    const compilation = await new Promise<Compilation>((resolve, reject) => {
      child.runAsChild((error, _entries, result) => {
        if (error) return reject(error);
        if (!result) return reject(new Error('Missing CSS URL compilation'));
        if (result.errors.length) return reject(result.errors[0]);
        resolve(result);
      });
    });
    for (const file of compilation.fileDependencies) this.addDependency(file);
    for (const directory of compilation.contextDependencies) {
      this.addContextDependency(directory);
    }
    for (const file of compilation.missingDependencies) {
      this.addMissingDependency(file);
    }
    for (const file of compilation.buildDependencies) {
      this.addBuildDependency(file);
    }
    for (const warning of compilation.warnings) this.emitWarning(warning);
    if (!cssFilename) {
      throw new Error(
        '[builtin-css] CSS URL compilation emitted no stylesheet',
      );
    }
    // Register the child assets on the importing module as well, so cached
    // loader results replay them and output graphs can associate them with it.
    for (const asset of compilation.getAssets()) {
      this.emitFile(asset.name, asset.source.buffer(), undefined, asset.info);
    }
    return `export default import.meta.rspackPublicPath + ${JSON.stringify(cssFilename)};`;
  };

export default cssUrlLoader;
