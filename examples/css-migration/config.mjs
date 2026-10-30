import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rspack } from '@rspack/core';

export const exampleRoot = path.dirname(fileURLToPath(import.meta.url));

function commonConfig(name, outputPath, OutputGraphPlugin) {
  return {
    name,
    mode: 'production',
    context: exampleRoot,
    entry: './src/index.js',
    devtool: false,
    output: {
      path: outputPath,
      clean: true,
      filename: 'assets/[name].[contenthash:8].js',
      chunkFilename: 'assets/[name].[contenthash:8].js',
      publicPath: '',
    },
    optimization: {
      chunkIds: 'named',
      minimize: false,
    },
    plugins: [new OutputGraphPlugin()],
  };
}

export function createCssLoaderConfig(outputPath, OutputGraphPlugin) {
  const config = commonConfig('css-loader', outputPath, OutputGraphPlugin);
  config.output.cssFilename = 'assets/legacy-[name].[contenthash:8].css';
  config.output.cssChunkFilename = 'assets/legacy-[name].[contenthash:8].css';
  config.module = {
    rules: [
      {
        test: /\.css$/i,
        type: 'javascript/auto',
        use: [rspack.CssExtractRspackPlugin.loader, 'css-loader'],
      },
    ],
  };
  config.plugins.unshift(
    new rspack.CssExtractRspackPlugin({
      filename: 'assets/legacy-[name].[contenthash:8].css',
      chunkFilename: 'assets/legacy-[name].[contenthash:8].css',
    }),
  );
  return config;
}

export function createBuiltinCssConfig(outputPath, OutputGraphPlugin) {
  const config = commonConfig('builtin-css', outputPath, OutputGraphPlugin);
  config.output.cssFilename = 'assets/builtin-[name].[contenthash:8].css';
  config.output.cssChunkFilename = 'assets/builtin-[name].[contenthash:8].css';
  config.module = {
    rules: [{ test: /\.css$/i, type: 'css' }],
  };
  return config;
}

export function createMigrationConfigs(outputRoot, OutputGraphPlugin) {
  return [
    createCssLoaderConfig(
      path.join(outputRoot, 'css-loader'),
      OutputGraphPlugin,
    ),
    createBuiltinCssConfig(
      path.join(outputRoot, 'builtin-css'),
      OutputGraphPlugin,
    ),
  ];
}
