import { createRequire } from 'node:module';
import type {
  CSSLoaderOptions,
  CSSModules,
  RsbuildPlugin,
  Rspack,
  RspackChain,
} from '@rsbuild/core';

export interface BuiltinCssModulesOptions {
  localIdentHashDigest?: string;
  localIdentHashDigestLength?: number;
  localIdentHashFunction?: string;
  localIdentHashSalt?: string;
  localIdentName?: string;
  /** Rename keyframes, as css-loader does by default. */
  animation?: boolean;
  dashedIdents?: boolean;
  customIdents?: boolean;
  container?: boolean;
  grid?: boolean;
  function?: boolean;
}

export interface PluginBuiltinCssOptions {
  exportType?: Rspack.CssParserOptions['exportType'];
  exportsConvention?: Rspack.CssModuleGeneratorOptions['exportsConvention'];
  exportsOnly?: boolean;
  esModule?: boolean;
  modules?: BuiltinCssModulesOptions;
}

const EXPORTS_CONVENTIONS = {
  asIs: 'as-is',
  camelCase: 'camel-case',
  camelCaseOnly: 'camel-case-only',
  dashes: 'dashes',
  dashesOnly: 'dashes-only',
} as const;

function splitResource(resource: string) {
  const fragmentIndex = resource.indexOf('#');
  const fragment = fragmentIndex < 0 ? '' : resource.slice(fragmentIndex);
  const withoutFragment =
    fragmentIndex < 0 ? resource : resource.slice(0, fragmentIndex);
  const queryIndex = withoutFragment.indexOf('?');
  return {
    path:
      queryIndex < 0 ? withoutFragment : withoutFragment.slice(0, queryIndex),
    query: queryIndex < 0 ? '' : withoutFragment.slice(queryIndex),
    fragment,
  };
}

function matchesModules(resource: string, auto: CSSModules['auto']): boolean {
  const { path } = splitResource(resource);
  if (auto === false) return false;
  if (auto instanceof RegExp) {
    return new RegExp(auto.source, auto.flags).test(path);
  }
  if (typeof auto === 'function') return auto(path, '', '');
  return /\.modules?\.\w+$/i.test(path);
}

/** Replace Rsbuild's CSS extraction pipeline with Rspack's built-in CSS. */
export function pluginBuiltinCss(
  options: PluginBuiltinCssOptions = {},
): RsbuildPlugin {
  const {
    localIdentHashDigest = 'base64url',
    localIdentHashDigestLength = 6,
    localIdentHashFunction = 'xxhash64',
    localIdentHashSalt,
    localIdentName,
    animation = true,
    dashedIdents = false,
    customIdents = false,
    container = false,
    grid = false,
    function: cssFunction = false,
  } = options.modules ?? {};

  return {
    name: 'rsbuild-plugin-builtin-css',
    setup(api) {
      api.modifyEnvironmentConfig((config) => {
        // The RFC migrates output.cssModules, not css-loader-specific options.
        if (config.tools?.cssLoader !== undefined) {
          api.logger.warn(
            '[builtin-css] tools.cssLoader is ignored. Use output.cssModules or pluginBuiltinCss options.',
          );
          delete config.tools.cssLoader;
        }
      });

      api.modifyBundlerChain({
        order: 'post',
        handler(chain, { CHAIN_ID, environment, target }) {
          const { output } = environment.config;
          const { cssModules } = output;
          const emitCss = output.emitCss ?? target === 'web';
          const esModule = options.esModule ?? true;
          const exportsOnly = options.exportsOnly ?? !emitCss;
          const generator: Rspack.CssModuleGeneratorOptions = {
            exportsConvention:
              options.exportsConvention ??
              EXPORTS_CONVENTIONS[cssModules.exportLocalsConvention],
            exportsOnly,
            esModule,
            localIdentHashDigest,
            localIdentHashDigestLength,
            localIdentHashFunction,
            localIdentHashSalt,
            localIdentName:
              localIdentName ??
              cssModules.localIdentName ??
              '[uniqueName]-[id]-[local]',
          };
          const baseGenerator: Rspack.CssGeneratorOptions = {
            exportsOnly,
            esModule,
          };
          const exportType =
            options.exportType ?? (output.injectStyles ? 'style' : 'link');
          const parser: Rspack.CssParserOptions = {
            // Native default is link. Explicit link currently breaks CSS
            // concatenation in Rspack 2.3.0, so use the equivalent default.
            exportType: exportType === 'link' ? undefined : exportType,
            namedExports:
              esModule &&
              (exportType === 'text' ||
                exportType === 'css-style-sheet' ||
                cssModules.namedExport),
          };
          const moduleParser: Rspack.CssAutoOrModuleParserOptions = {
            ...parser,
            animation,
            dashedIdents,
            customIdents,
            container,
            grid,
            function: cssFunction,
          };
          const warned = new Set<string>();
          const warn = (message: string) => {
            if (warned.has(message)) return;
            warned.add(message);
            api.logger.warn(`[builtin-css] ${message}`);
          };
          if (cssModules.exportGlobals) {
            warn(
              'output.cssModules.exportGlobals has no built-in CSS equivalent.',
            );
          }
          if (
            typeof cssModules.auto === 'function' &&
            cssModules.auto.length > 1
          ) {
            warn(
              'CSS Modules auto callbacks receive the resource path only. Move query/fragment conditions to tools.rspack rules.',
            );
          }
          const getMode = (resource: string) => {
            const mode =
              typeof cssModules.mode === 'function'
                ? cssModules.mode(splitResource(resource).path)
                : (cssModules.mode ?? 'local');
            if (mode === 'icss') {
              warn(
                'CSS Modules mode "icss" falls back to "css/module"; ICSS has no independent switch.',
              );
              return 'local';
            }
            return mode;
          };
          if (cssModules.mode === 'icss') getMode('');

          const convertRule = (rule: RspackChain.Rule<unknown>) => {
            for (const child of rule.rules.values()) {
              convertRule(child);
            }
            for (const child of rule.oneOfs.values()) {
              convertRule(child);
            }

            if (!rule.uses.has(CHAIN_ID.USE.CSS)) return;
            const cssOptions = rule
              .use<CSSLoaderOptions>(CHAIN_ID.USE.CSS)
              .get('options');
            const inline = cssOptions?.exportType === 'string';
            const inheritedModules =
              typeof cssOptions?.modules === 'object'
                ? cssOptions.modules
                : undefined;
            // Rsbuild resolves its mode-dependent localIdentName in this loader.
            const moduleGenerator = {
              ...generator,
              localIdentName:
                localIdentName ??
                inheritedModules?.localIdentName ??
                generator.localIdentName,
            };

            rule.uses.delete(CHAIN_ID.USE.CSS);
            rule.uses.delete(CHAIN_ID.USE.MINI_CSS_EXTRACT);
            rule.uses.delete(CHAIN_ID.USE.STYLE);
            rule.uses.delete(CHAIN_ID.USE.IGNORE_CSS);

            if (rule.uses.has(CHAIN_ID.USE.CSS_URL)) {
              rule
                .type('javascript/auto')
                .use(CHAIN_ID.USE.CSS_URL)
                .loader(
                  createRequire(import.meta.url).resolve(
                    'rspack-css-migration-tool/css-url-loader',
                  ),
                );
              return;
            }

            if (inline) {
              rule
                .type('css')
                .set('parser', {
                  ...parser,
                  exportType: 'text',
                  namedExports: esModule,
                })
                .set('generator', { exportsOnly: false, esModule });
              return;
            }

            rule.type(cssModules.auto === false ? 'css' : 'css/auto');
            for (const mode of ['global', 'pure', 'local'] as const) {
              rule
                .oneOf(`builtin-css-query-${mode}`)
                .resourceQuery(/[?&]module(?:[=&]|$)/)
                .resource((resource: string) => getMode(resource) === mode)
                .type(mode === 'global' ? 'css/global' : 'css/module')
                .set(
                  'parser',
                  mode === 'pure'
                    ? { ...moduleParser, pure: true }
                    : moduleParser,
                )
                .set('generator', moduleGenerator);
              rule
                .oneOf(`builtin-css-${mode}`)
                .resource(
                  (resource: string) =>
                    matchesModules(resource, cssModules.auto) &&
                    getMode(resource) === mode,
                )
                .type(mode === 'global' ? 'css/global' : 'css/module')
                .set(
                  'parser',
                  mode === 'pure'
                    ? { ...moduleParser, pure: true }
                    : moduleParser,
                )
                .set('generator', moduleGenerator);
            }
            rule
              .oneOf('builtin-css')
              .type('css')
              .set('parser', parser)
              .set('generator', baseGenerator);
          };

          for (const rule of chain.module.rules.values()) convertRule(rule);

          if (chain.plugins.has(CHAIN_ID.PLUGIN.MINI_CSS_EXTRACT)) {
            const extractOptions = chain
              .plugin(CHAIN_ID.PLUGIN.MINI_CSS_EXTRACT)
              .get('args')?.[0];
            if (extractOptions?.filename) {
              chain.output.set('cssFilename', extractOptions.filename);
            }
            if (extractOptions?.chunkFilename) {
              chain.output.set(
                'cssChunkFilename',
                extractOptions.chunkFilename,
              );
            }
            chain.plugins.delete(CHAIN_ID.PLUGIN.MINI_CSS_EXTRACT);
          }
        },
      });
    },
  };
}
