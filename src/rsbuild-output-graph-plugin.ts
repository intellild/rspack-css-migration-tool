import type { RsbuildPlugin } from '@rsbuild/core';
import {
  RspackOutputGraphPlugin,
  type RspackOutputGraphPluginOptions,
} from './output-graph-plugin';

/** Collect output graphs in every Rsbuild environment without changing CSS rules. */
export function pluginOutputGraph(
  options: RspackOutputGraphPluginOptions = {},
): RsbuildPlugin {
  return {
    name: 'rspack-css-migration:output-graph',
    setup(api) {
      api.modifyBundlerChain((chain) => {
        chain
          .plugin('rspack-css-migration-output-graph')
          .use(RspackOutputGraphPlugin, [
            { context: api.context.rootPath, ...options },
          ]);
      });
    },
  };
}
