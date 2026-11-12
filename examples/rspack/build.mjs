import { createRspackConfig, runRspackBuild } from './rspack.config.mjs';

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
  const config = createRspackConfig({ builtinCss: name === 'builtin-css' });
  console.log(`Building ${config.name}...`);
  await runRspackBuild(config);
  console.log(`Built ${config.name}`);
}
