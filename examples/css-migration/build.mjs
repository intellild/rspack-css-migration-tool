import path from 'node:path';
import { RspackOutputGraphPlugin } from '../../dist/index.js';
import {
  createMigrationConfigs,
  exampleRoot,
  runRspackBuild,
} from './config.mjs';

const configs = createMigrationConfigs(
  path.join(exampleRoot, 'dist'),
  RspackOutputGraphPlugin,
);
const target = process.argv[2] ?? 'all';
const selectedConfigs =
  target === 'all'
    ? configs
    : configs.filter((config) => config.name === target);
if (!selectedConfigs.length) {
  throw new Error(
    `Unknown build target "${target}". Use css-loader, builtin-css, or all.`,
  );
}

for (const config of selectedConfigs) {
  console.log(`Building ${config.name}...`);
  await runRspackBuild(config);
  console.log(`Built ${config.name}`);
}
