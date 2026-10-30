import path from 'node:path';
import { rspack } from '@rspack/core';
import { RspackOutputGraphPlugin } from '../../dist/index.js';
import { createMigrationConfigs, exampleRoot } from './config.mjs';

function build(config) {
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
        return;
      }
      if (!stats || stats.hasErrors()) {
        finish(
          new Error(stats?.toString({ colors: false }) ?? 'Rspack failed'),
        );
        return;
      }
      finish();
    });
  });
}

const configs = createMigrationConfigs(
  path.join(exampleRoot, 'dist'),
  RspackOutputGraphPlugin,
);
for (const config of configs) {
  await build(config);
  console.log(`Built ${config.name}`);
}
