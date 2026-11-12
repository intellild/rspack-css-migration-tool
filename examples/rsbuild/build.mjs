import { createRsbuild } from '@rsbuild/core';
import { createRsbuildConfig, exampleRoot } from './rsbuild.config.mjs';

const target =
  process.argv[2] ??
  (process.env.BUILTIN_CSS === undefined
    ? 'all'
    : process.env.BUILTIN_CSS === 'true'
      ? 'builtin-css'
      : 'css-loader');
if (!['css-loader', 'builtin-css', 'all'].includes(target)) {
  throw new Error(
    `Unknown build target "${target}". Use css-loader, builtin-css, or all.`,
  );
}

for (const name of target === 'all'
  ? ['css-loader', 'builtin-css']
  : [target]) {
  console.log(`Building ${name}...`);
  const rsbuild = await createRsbuild({
    cwd: exampleRoot,
    rsbuildConfig: createRsbuildConfig({ builtinCss: name === 'builtin-css' }),
  });
  await rsbuild.build();
  console.log(`Built ${name}`);
}
