import { RspackOutputGraphPlugin } from '../../dist/index.js';
import { createCssLoaderConfig, exampleRoot } from './config.mjs';
import path from 'node:path';

export default createCssLoaderConfig(
  path.join(exampleRoot, 'dist/css-loader'),
  RspackOutputGraphPlugin,
);
