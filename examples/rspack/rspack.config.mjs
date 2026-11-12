import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rspack } from '@rspack/core';
import { RspackOutputGraphPlugin } from 'rspack-css-migration-tool';

export const exampleRoot = path.dirname(fileURLToPath(import.meta.url));
export const cssModuleLocalIdentName = 'cm_[name]_[local]__[hash:base64:5]';

export function runRspackBuild(config) {
  const compiler = rspack(config);
  return new Promise((resolve, reject) => {
    compiler.run((error, stats) => {
      const finish = (buildError) => {
        compiler.close((closeError) => {
          if (buildError) reject(buildError);
          else if (closeError) reject(closeError);
          else resolve();
        });
      };

      if (error) {
        finish(error);
      } else if (!stats || stats.hasErrors()) {
        finish(
          new Error(stats?.toString({ colors: false }) ?? 'Rspack failed'),
        );
      } else {
        finish();
      }
    });
  });
}

export function createRspackConfig({
  builtinCss = process.env.BUILTIN_CSS === 'true',
  outputRoot = path.join(exampleRoot, 'dist'),
  OutputGraphPlugin = RspackOutputGraphPlugin,
} = {}) {
  const name = builtinCss ? 'builtin-css' : 'css-loader';
  const cssFilename = `assets/${builtinCss ? 'builtin' : 'legacy'}-[name].[contenthash:8].css`;
  return {
    name,
    mode: 'production',
    context: exampleRoot,
    entry: './src/index.js',
    devtool: false,
    output: {
      path: path.join(outputRoot, name),
      clean: true,
      filename: 'assets/[name].[contenthash:8].js',
      chunkFilename: 'assets/[name].[contenthash:8].js',
      publicPath: '',
      cssFilename,
      cssChunkFilename: cssFilename,
    },
    module: {
      rules: [
        builtinCss
          ? { test: /\.css$/i, type: 'css/auto' }
          : {
              test: /\.css$/i,
              type: 'javascript/auto',
              use: [
                rspack.CssExtractRspackPlugin.loader,
                {
                  loader: 'css-loader',
                  options: {
                    modules: {
                      auto: /\.module\.css$/i,
                      namedExport: true,
                      exportLocalsConvention: 'as-is',
                      localIdentName: cssModuleLocalIdentName,
                    },
                  },
                },
              ],
            },
      ],
      parser: {
        'css/auto': {
          namedExports: true,
          animation: true,
          dashedIdents: false,
          customIdents: false,
          container: false,
          grid: false,
          function: false,
        },
      },
      generator: {
        'css/auto': {
          exportsConvention: 'as-is',
          localIdentName: cssModuleLocalIdentName,
        },
      },
    },
    optimization: {
      chunkIds: 'named',
      minimize: false,
    },
    plugins: [
      ...(!builtinCss
        ? [
            new rspack.CssExtractRspackPlugin({
              filename: cssFilename,
              chunkFilename: cssFilename,
            }),
          ]
        : []),
      new OutputGraphPlugin(),
    ],
  };
}

export default createRspackConfig();
