import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  getAssetExtension,
  getAssetKind,
  normalizeAssetName,
  type AssetKind,
  type NormalizeAssetNameOptions,
} from './normalize';

export const DEFAULT_OUTPUT_GRAPH_FILENAME =
  '.rspack-css-migration-tool/output-graph.json';

export interface RspackOutputGraphPluginOptions extends NormalizeAssetNameOptions {
  /** Asset name used for the generated graph manifest. */
  filename?: string;
  /** Include module and module-graph details. Enabled by default. */
  includeModules?: boolean;
  /** Associate chunk auxiliary files (for example source maps) with chunks. */
  includeAuxiliaryFiles?: boolean;
  /** Root used to turn absolute module resources into portable relative paths. */
  context?: string;
}

export interface OutputGraph {
  version: 1;
  generatedAt: string;
  compilation: {
    name: string | null;
    hash: string | null;
    context: string | null;
  };
  assets: OutputGraphAsset[];
  chunks: OutputGraphChunk[];
}

export interface OutputGraphAsset {
  name: string;
  normalizedName: string;
  extension: string;
  kind: AssetKind;
  bytes: number;
  chunkKeys: string[];
  entrypoints: string[];
  moduleIdentifiers: string[];
  moduleResources: string[];
  moduleKeys: string[];
  styleModuleKeys: string[];
  issuerModuleKeys: string[];
}

export interface OutputGraphModuleReference {
  identifier: string;
  resource: string | null;
  key: string;
}

export interface OutputGraphModule extends OutputGraphModuleReference {
  id: string | number | null;
  type: string | null;
  style: boolean;
  issuer: OutputGraphModuleReference | null;
}

export interface OutputGraphChunk {
  key: string;
  id: string | number | null;
  ids: Array<string | number>;
  name: string | null;
  files: string[];
  auxiliaryFiles: string[];
  entrypoints: string[];
  initial: boolean;
  modules: OutputGraphModule[];
  moduleIdentifiers: string[];
  moduleResources: string[];
  moduleKeys: string[];
  styleModuleKeys: string[];
  issuerModuleKeys: string[];
}

type TapCallback = (...args: unknown[]) => unknown;

type TapableHook = {
  tap: (
    options: string | { name: string; stage?: number },
    callback: TapCallback,
  ) => void;
};

type RspackCompilerLike = {
  context?: string;
  webpack?: {
    Compilation?: { PROCESS_ASSETS_STAGE_REPORT?: number };
    sources?: { RawSource?: new (value: string) => unknown };
  };
  hooks: {
    thisCompilation: TapableHook;
  };
};

type RspackCompilationLike = {
  name?: string;
  hash?: string;
  compiler?: { context?: string };
  chunks?: Iterable<unknown>;
  entrypoints?:
    | Map<string, unknown>
    | ReadonlyMap<string, unknown>
    | Record<string, unknown>;
  chunkGraph?: {
    getChunkModulesIterable?: (chunk: unknown) => Iterable<unknown>;
    getModuleId?: (module: unknown) => string | number | null;
  };
  moduleGraph?: {
    getIssuer?: (module: unknown) => unknown;
  };
  hooks?: {
    processAssets?: TapableHook;
  };
  getAsset?: (name: string) => { source?: SourceLike } | undefined;
  getAssets?: () => Array<{ name: string; source?: SourceLike }>;
  emitAsset?: (name: string, source: unknown) => void;
  assets?: Record<string, LegacySourceLike>;
};

type SourceLike = {
  size?: () => number;
};

type LegacySourceLike = {
  source: () => string;
  size: () => number;
};

interface ResolvedPluginOptions extends Required<NormalizeAssetNameOptions> {
  filename: string;
  includeModules: boolean;
  includeAuxiliaryFiles: boolean;
  context?: string;
}

const PLUGIN_NAME = 'RspackCssMigrationOutputGraphPlugin';
const STYLE_RESOURCE = /\.(?:css|less|sass|scss|styl|stylus)(?:$|[?#])/i;

export class RspackOutputGraphPlugin {
  readonly options: ResolvedPluginOptions;

  constructor(options: RspackOutputGraphPluginOptions = {}) {
    this.options = resolveOptions(options);
  }

  apply(compiler: RspackCompilerLike): void {
    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (...args: unknown[]) => {
      const compilation = args[0] as RspackCompilationLike;
      const stage =
        compiler.webpack?.Compilation?.PROCESS_ASSETS_STAGE_REPORT ?? 5_000;

      compilation.hooks?.processAssets?.tap(
        { name: PLUGIN_NAME, stage },
        () => {
          const graph = createOutputGraph(compilation, {
            ...this.options,
            context:
              this.options.context ??
              compiler.context ??
              compilation.compiler?.context,
          });
          emitJsonAsset(
            compiler,
            compilation,
            this.options.filename,
            `${JSON.stringify(graph, null, 2)}\n`,
          );
        },
      );
    });
  }
}

export function createOutputGraph(
  compilation: RspackCompilationLike,
  options: RspackOutputGraphPluginOptions = {},
): OutputGraph {
  const resolvedOptions = resolveOptions({
    ...options,
    context: options.context ?? compilation.compiler?.context,
  });
  const entrypointsByChunk = collectEntrypointsByChunk(compilation.entrypoints);
  const chunks = [...toIterable(compilation.chunks)]
    .map((chunk) =>
      createChunkRecord(
        compilation,
        chunk,
        entrypointsByChunk.get(chunk) ?? [],
        resolvedOptions,
      ),
    )
    .sort(compareChunks);
  const chunkByFile = new Map<string, OutputGraphChunk[]>();

  for (const chunk of chunks) {
    const relatedFiles = resolvedOptions.includeAuxiliaryFiles
      ? [...chunk.files, ...chunk.auxiliaryFiles]
      : chunk.files;
    for (const file of relatedFiles) {
      const list = chunkByFile.get(file);
      if (list) {
        list.push(chunk);
      } else {
        chunkByFile.set(file, [chunk]);
      }
    }
  }

  const assetNames = new Set(chunkByFile.keys());
  for (const asset of compilation.getAssets?.() ?? []) {
    assetNames.add(asset.name);
  }
  for (const assetName of Object.keys(compilation.assets ?? {})) {
    assetNames.add(assetName);
  }
  assetNames.delete(resolvedOptions.filename);

  const assets = [...assetNames].sort().map((assetName) => {
    const relatedChunks = chunkByFile.get(assetName) ?? [];
    const modules = relatedChunks.flatMap((chunk) => chunk.modules);

    return {
      name: assetName,
      normalizedName: normalizeAssetName(assetName, resolvedOptions),
      extension: getAssetExtension(assetName),
      kind: getAssetKind(assetName),
      bytes: getAssetSize(compilation, assetName),
      chunkKeys: uniqueSorted(relatedChunks.map((chunk) => chunk.key)),
      entrypoints: uniqueSorted(
        relatedChunks.flatMap((chunk) => chunk.entrypoints),
      ),
      moduleIdentifiers: resolvedOptions.includeModules
        ? uniqueSorted(modules.map((module) => module.identifier))
        : [],
      moduleResources: resolvedOptions.includeModules
        ? uniqueSorted(
            modules.flatMap((module) =>
              module.resource ? [module.resource] : [],
            ),
          )
        : [],
      moduleKeys: resolvedOptions.includeModules
        ? uniqueSorted(modules.map((module) => module.key))
        : [],
      styleModuleKeys: resolvedOptions.includeModules
        ? uniqueSorted(
            modules
              .filter((module) => module.style)
              .map((module) => module.key),
          )
        : [],
      issuerModuleKeys: resolvedOptions.includeModules
        ? uniqueSorted(
            modules.flatMap((module) =>
              module.issuer ? [module.issuer.key] : [],
            ),
          )
        : [],
    };
  });

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    compilation: {
      name: compilation.name ?? null,
      hash: compilation.hash ?? null,
      context: resolvedOptions.context
        ? normalizeSlashes(path.resolve(resolvedOptions.context))
        : null,
    },
    assets,
    chunks,
  };
}

function resolveOptions(
  options: RspackOutputGraphPluginOptions,
): ResolvedPluginOptions {
  return {
    filename: options.filename ?? DEFAULT_OUTPUT_GRAPH_FILENAME,
    includeModules: options.includeModules ?? true,
    includeAuxiliaryFiles: options.includeAuxiliaryFiles ?? true,
    collapseNumericChunks: options.collapseNumericChunks ?? true,
    stripHash: options.stripHash ?? true,
    context: options.context,
  };
}

function createChunkRecord(
  compilation: RspackCompilationLike,
  chunk: unknown,
  entrypoints: string[],
  options: ResolvedPluginOptions,
): OutputGraphChunk {
  const chunkRecord = chunk as {
    id?: string | number | null;
    ids?: Iterable<string | number>;
    name?: string | null;
    files?: Iterable<string>;
    auxiliaryFiles?: Iterable<string>;
    canBeInitial?: () => boolean;
    isOnlyInitial?: () => boolean;
  };
  const modules = options.includeModules
    ? collectChunkModules(compilation, chunk, options.context)
    : [];
  const sortedEntrypoints = uniqueSorted(entrypoints);

  return {
    key: createChunkKey(chunkRecord, sortedEntrypoints, modules),
    id: chunkRecord.id ?? null,
    ids: [...toIterable(chunkRecord.ids)].sort(compareStringOrNumber),
    name: chunkRecord.name ?? null,
    files: uniqueSorted([...toIterable(chunkRecord.files)].map(String)),
    auxiliaryFiles: uniqueSorted(
      [...toIterable(chunkRecord.auxiliaryFiles)].map(String),
    ),
    entrypoints: sortedEntrypoints,
    initial:
      chunkRecord.canBeInitial?.() ?? chunkRecord.isOnlyInitial?.() ?? false,
    modules,
    moduleIdentifiers: uniqueSorted(modules.map((module) => module.identifier)),
    moduleResources: uniqueSorted(
      modules.flatMap((module) => (module.resource ? [module.resource] : [])),
    ),
    moduleKeys: uniqueSorted(modules.map((module) => module.key)),
    styleModuleKeys: uniqueSorted(
      modules.filter((module) => module.style).map((module) => module.key),
    ),
    issuerModuleKeys: uniqueSorted(
      modules.flatMap((module) => (module.issuer ? [module.issuer.key] : [])),
    ),
  };
}

function createChunkKey(
  chunk: { id?: string | number | null; name?: string | null },
  entrypoints: string[],
  modules: OutputGraphModule[],
): string {
  if (chunk.name) return `name:${chunk.name}`;
  if (entrypoints.length) return `entry:${entrypoints.join('+')}`;

  const styleModuleKeys = uniqueSorted(
    modules.filter((module) => module.style).map((module) => module.key),
  );
  if (styleModuleKeys.length) {
    return `style:${hashValues(styleModuleKeys)}`;
  }

  const moduleKeys = uniqueSorted(modules.map((module) => module.key));
  if (moduleKeys.length) return `modules:${hashValues(moduleKeys)}`;
  if (chunk.id !== undefined && chunk.id !== null) {
    return `id:${String(chunk.id)}`;
  }
  return 'chunk:unknown';
}

function collectChunkModules(
  compilation: RspackCompilationLike,
  chunk: unknown,
  context?: string,
): OutputGraphModule[] {
  const iterable = compilation.chunkGraph?.getChunkModulesIterable?.(chunk);
  if (!iterable) return [];

  const modules: OutputGraphModule[] = [];
  const visited = new Set<unknown>();
  for (const module of iterable) {
    collectModuleAndNested(compilation, module, context, modules, visited, 0);
  }

  return modules.sort((left, right) => {
    const byKey = left.key.localeCompare(right.key);
    return byKey || left.identifier.localeCompare(right.identifier);
  });
}

function collectModuleAndNested(
  compilation: RspackCompilationLike,
  module: unknown,
  context: string | undefined,
  result: OutputGraphModule[],
  visited: Set<unknown>,
  depth: number,
): void {
  if (visited.has(module) || depth >= 64) return;
  visited.add(module);

  const reference = createModuleReference(module, context);
  const moduleLike = module as {
    type?: string;
    modules?: Iterable<unknown>;
  };
  const type = moduleLike.type ?? null;
  result.push({
    ...reference,
    id: compilation.chunkGraph?.getModuleId?.(module) ?? null,
    type,
    style:
      Boolean(type?.startsWith('css')) ||
      STYLE_RESOURCE.test(reference.resource ?? reference.identifier),
    issuer: findLogicalIssuer(compilation, module, reference, context),
  });

  for (const nestedModule of toIterable(moduleLike.modules)) {
    collectModuleAndNested(
      compilation,
      nestedModule,
      context,
      result,
      visited,
      depth + 1,
    );
  }
}

function findLogicalIssuer(
  compilation: RspackCompilationLike,
  module: unknown,
  moduleReference: OutputGraphModuleReference,
  context?: string,
): OutputGraphModuleReference | null {
  const moduleGraph = compilation.moduleGraph;
  if (!moduleGraph?.getIssuer) return null;

  const visited = new Set<unknown>([module]);
  const visitedSignatures = new Set<string>([
    `${moduleReference.key}\0${moduleReference.identifier}`,
  ]);
  let issuer = moduleGraph.getIssuer(module);
  let depth = 0;
  while (issuer && !visited.has(issuer) && depth < 64) {
    depth += 1;
    visited.add(issuer);
    const issuerReference = createModuleReference(issuer, context);
    if (issuerReference.key !== moduleReference.key) return issuerReference;
    const signature = `${issuerReference.key}\0${issuerReference.identifier}`;
    if (visitedSignatures.has(signature)) return null;
    visitedSignatures.add(signature);
    issuer = moduleGraph.getIssuer(issuer);
  }
  return null;
}

function createModuleReference(
  module: unknown,
  context?: string,
): OutputGraphModuleReference {
  const moduleLike = module as {
    identifier?: () => string;
    readableIdentifier?: (requestShortener?: unknown) => string;
    resource?: string;
    userRequest?: string;
    rawRequest?: string;
    nameForCondition?: () => string | null;
  };
  const rawIdentifier =
    moduleLike.identifier?.() ??
    moduleLike.readableIdentifier?.() ??
    moduleLike.resource ??
    moduleLike.userRequest ??
    moduleLike.rawRequest ??
    '';
  const rawResource =
    moduleLike.resource ??
    moduleLike.nameForCondition?.() ??
    moduleLike.userRequest ??
    moduleLike.rawRequest ??
    extractResourceFromIdentifier(rawIdentifier);
  const identifier = normalizeModuleIdentifier(rawIdentifier, context);
  const resource = rawResource
    ? normalizeModuleResource(rawResource, context)
    : null;

  return {
    identifier,
    resource,
    key: resource ? `resource:${resource}` : `identifier:${identifier}`,
  };
}

function extractResourceFromIdentifier(identifier: string): string {
  const withoutLoaders = identifier.slice(identifier.lastIndexOf('!') + 1);
  const typeSeparator = withoutLoaders.indexOf('|');
  if (typeSeparator >= 0) {
    const candidate = withoutLoaders.slice(typeSeparator + 1);
    if (candidate.includes('/') || candidate.includes('\\')) return candidate;
  }
  return withoutLoaders;
}

function normalizeModuleIdentifier(
  identifier: string,
  context?: string,
): string {
  let normalized = normalizeSlashes(identifier).replaceAll('\0', '');
  if (context) {
    const normalizedContext = normalizeSlashes(path.resolve(context)).replace(
      /\/$/,
      '',
    );
    normalized = normalized.split(`${normalizedContext}/`).join('');
  }
  normalized = normalized.replace(
    /(?:[A-Za-z]:)?\/(?:[^!|]+\/)*node_modules\//g,
    'node_modules/',
  );
  return normalized;
}

function normalizeModuleResource(resource: string, context?: string): string {
  let normalized = normalizeSlashes(resource).replaceAll('\0', '');
  normalized = normalized.slice(normalized.lastIndexOf('!') + 1);
  normalized = normalized.replace(/^file:\/\//, '');
  normalized = normalized.replace(/[?#].*$/, '');

  if (context) {
    const normalizedContext = normalizeSlashes(path.resolve(context)).replace(
      /\/$/,
      '',
    );
    if (normalized === normalizedContext) return '.';
    if (normalized.startsWith(`${normalizedContext}/`)) {
      return normalized.slice(normalizedContext.length + 1);
    }
  }

  const nodeModulesIndex = normalized.lastIndexOf('/node_modules/');
  if (nodeModulesIndex >= 0) {
    return normalized.slice(nodeModulesIndex + 1);
  }
  return normalized.replace(/^\.\//, '');
}

function collectEntrypointsByChunk(
  entrypoints: RspackCompilationLike['entrypoints'],
): Map<unknown, string[]> {
  const result = new Map<unknown, string[]>();
  const entries = getEntries(entrypoints);

  for (const [entrypointName, entrypoint] of entries) {
    const entrypointLike = entrypoint as {
      getChunks?: () => Iterable<unknown>;
      chunks?: Iterable<unknown>;
    };
    const chunks = [
      ...toIterable(entrypointLike.getChunks?.() ?? entrypointLike.chunks),
    ];
    for (const chunk of chunks) {
      const names = result.get(chunk);
      if (names) {
        names.push(entrypointName);
      } else {
        result.set(chunk, [entrypointName]);
      }
    }
  }

  return result;
}

function getEntries(
  entrypoints: RspackCompilationLike['entrypoints'],
): Array<[string, unknown]> {
  if (!entrypoints) return [];
  if ('entries' in entrypoints && typeof entrypoints.entries === 'function') {
    return [...entrypoints.entries()];
  }
  return Object.entries(entrypoints);
}

function getAssetSize(
  compilation: RspackCompilationLike,
  assetName: string,
): number {
  const source = compilation.getAsset?.(assetName)?.source;
  const size = source?.size?.();
  if (typeof size === 'number') return size;
  const legacySize = compilation.assets?.[assetName]?.size?.();
  return typeof legacySize === 'number' ? legacySize : 0;
}

function emitJsonAsset(
  compiler: RspackCompilerLike,
  compilation: RspackCompilationLike,
  filename: string,
  content: string,
): void {
  const RawSource = compiler.webpack?.sources?.RawSource;
  if (compilation.emitAsset && RawSource) {
    compilation.emitAsset(filename, new RawSource(content));
    return;
  }

  compilation.assets ??= {};
  compilation.assets[filename] = {
    source: () => content,
    size: () => Buffer.byteLength(content),
  };
}

function compareChunks(
  left: OutputGraphChunk,
  right: OutputGraphChunk,
): number {
  const byKey = left.key.localeCompare(right.key);
  if (byKey) return byKey;
  return String(left.id ?? '').localeCompare(String(right.id ?? ''));
}

function compareStringOrNumber(
  left: string | number,
  right: string | number,
): number {
  return String(left).localeCompare(String(right));
}

function hashValues(values: string[]): string {
  return createHash('sha256')
    .update(values.join('\0'))
    .digest('hex')
    .slice(0, 12);
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

function toIterable<T>(value: Iterable<T> | undefined | null): Iterable<T> {
  return value ?? [];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}
