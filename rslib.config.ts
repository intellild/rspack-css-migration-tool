import { defineConfig } from '@rslib/core';

export default defineConfig({
  dts: true,
  source: {
    entry: {
      index: './src/index.ts',
    },
  },
});
