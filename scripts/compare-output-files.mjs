#!/usr/bin/env node
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const usage = `Usage:
  node scripts/compare-output-files.mjs --before <dir> --after <dir> [options]

Options:
  --before-graph <file>  Use an explicit graph manifest for the before build
  --after-graph <file>   Use an explicit graph manifest for the after build
  --no-graph             Ignore graph manifests and compare normalized filenames
  --require-graph        Fail unless both graph manifests are available
  --extensions css,js    Only compare these extensions
  --hash                 Hash file contents in filename-only mode
  --min-score 0.35       Minimum graph matching confidence
  --top 50               Maximum detailed rows per section
  --out report.md        Write the report instead of printing it

By default, the script uses graph manifests emitted by RspackOutputGraphPlugin
when both output directories contain them, then falls back to filename matching.
Run pnpm run build before using this script.`;

function valueOf(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

function parseArgs(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage);
    process.exit(0);
  }

  const before = valueOf(args, '--before');
  const after = valueOf(args, '--after');
  if (!before || !after) {
    console.error(usage);
    process.exit(2);
  }

  const extensions = valueOf(args, '--extensions');
  const beforeGraph = valueOf(args, '--before-graph');
  const afterGraph = valueOf(args, '--after-graph');
  if (Boolean(beforeGraph) !== Boolean(afterGraph)) {
    console.error(
      '--before-graph and --after-graph must be provided together.',
    );
    process.exit(2);
  }

  return {
    before,
    after,
    beforeGraph,
    afterGraph,
    out: valueOf(args, '--out'),
    top: Number.parseInt(valueOf(args, '--top', '50'), 10),
    minScore: Number.parseFloat(valueOf(args, '--min-score', '0.35')),
    hashContent: args.includes('--hash'),
    graph: !args.includes('--no-graph'),
    requireGraph: args.includes('--require-graph'),
    extensions: extensions
      ? extensions.split(',').map((item) => item.trim())
      : undefined,
  };
}

async function loadTool() {
  try {
    return await import('../dist/index.js');
  } catch {
    console.error('Cannot load ../dist/index.js. Run pnpm run build first.');
    process.exit(1);
  }
}

const options = parseArgs(process.argv.slice(2));
const tool = await loadTool();
const defaultGraph = tool.DEFAULT_OUTPUT_GRAPH_FILENAME;
const beforeGraph =
  options.beforeGraph ?? path.join(options.before, defaultGraph);
const afterGraph = options.afterGraph ?? path.join(options.after, defaultGraph);
const hasBeforeGraph = existsSync(beforeGraph);
const hasAfterGraph = existsSync(afterGraph);

let markdown;
if (options.graph && hasBeforeGraph && hasAfterGraph) {
  const before = tool.loadOutputGraph(beforeGraph);
  const after = tool.loadOutputGraph(afterGraph);
  const comparison = tool.compareOutputGraphs(before, after, {
    extensions: options.extensions,
    minScore: options.minScore,
  });
  markdown = tool.renderOutputGraphDiffMarkdown(comparison, {
    top: options.top,
  });
  console.error(`Compared output graphs: ${beforeGraph} -> ${afterGraph}`);
} else {
  if (options.requireGraph) {
    console.error(
      `Graph manifests are required but unavailable: ${beforeGraph}, ${afterGraph}`,
    );
    process.exit(1);
  }
  if (options.graph && hasBeforeGraph !== hasAfterGraph) {
    console.error(
      'Only one graph manifest was found; falling back to normalized filenames.',
    );
  }

  const ignoredGraph = new RegExp(
    `^${defaultGraph.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
  );
  const before = tool.createOutputFileManifest(options.before, {
    extensions: options.extensions,
    hashContent: options.hashContent,
    ignore: [ignoredGraph],
  });
  const after = tool.createOutputFileManifest(options.after, {
    extensions: options.extensions,
    hashContent: options.hashContent,
    ignore: [ignoredGraph],
  });
  const comparison = tool.compareOutputFileManifests(before, after);
  markdown = tool.renderOutputFileDiffMarkdown(comparison, {
    top: options.top,
  });
}

if (options.out) {
  writeFileSync(options.out, markdown);
  console.log(`Report saved to: ${options.out}`);
} else {
  console.log(markdown);
}
