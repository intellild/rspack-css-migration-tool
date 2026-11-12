import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rsbuild/core';
import {
  pluginBuiltinCss,
  RspackOutputGraphPlugin,
} from 'rspack-css-migration-tool';

export const exampleRoot = path.dirname(fileURLToPath(import.meta.url));

export function createRsbuildConfig({
  builtinCss = process.env.BUILTIN_CSS === 'true',
  outputRoot = path.join(exampleRoot, 'dist'),
  builtinCssPlugin = pluginBuiltinCss,
  OutputGraphPlugin = RspackOutputGraphPlugin,
} = {}) {
  const name = builtinCss ? 'builtin-css' : 'css-loader';
  const cssFilename = `${builtinCss ? 'builtin' : 'legacy'}-[name].[contenthash:8].css`;

  return defineConfig({
    plugins: builtinCss
      ? [
          builtinCssPlugin({
            exportType: 'link',
            exportsConvention: 'as-is',
            exportsOnly: false,
            esModule: true,
            modules: {
              localIdentHashDigest: 'base64url',
              localIdentHashDigestLength: 6,
              localIdentHashFunction: 'xxhash64',
              localIdentHashSalt: 'my-salt',
              localIdentName: '[uniqueName]-[id]-[local]',
              animation: true,
              dashedIdents: false,
              customIdents: false,
              container: false,
              grid: false,
              function: false,
            },
          }),
        ]
      : [],
    source: {
      entry: { main: './src/index.js' },
    },
    output: {
      distPath: {
        root: path.join(outputRoot, name),
        css: 'assets',
        cssAsync: 'assets',
      },
      filename: { css: cssFilename },
      assetPrefix: '',
      cleanDistPath: true,
      minify: false,
      sourceMap: false,
      cssModules: {
        auto: /\.module\.css$/i,
        namedExport: true,
        exportLocalsConvention: 'asIs',
        localIdentName: 'cm_[name]_[local]__[hash:base64:5]',
      },
    },
    tools: {
      lightningcssLoader: false,
      rspack(config) {
        config.mode = 'production';
        config.optimization.chunkIds = 'named';
        config.plugins.push(new OutputGraphPlugin());
      },
    },
  });
}

export default createRsbuildConfig();
