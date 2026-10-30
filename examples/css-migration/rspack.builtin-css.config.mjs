import { RspackOutputGraphPlugin } from '../../dist/index.js';
import { createBuiltinCssConfig, exampleRoot } from './config.mjs';
import path from 'node:path';

export default createBuiltinCssConfig(
  path.join(exampleRoot, 'dist/builtin-css'),
  RspackOutputGraphPlugin,
);
