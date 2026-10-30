export type AssetKind =
  'css' | 'js' | 'map' | 'image' | 'font' | 'wasm' | 'html' | 'json' | 'other';

export interface NormalizeAssetNameOptions {
  collapseNumericChunks?: boolean;
  stripHash?: boolean;
}

const DEFAULT_NORMALIZE_OPTIONS: Required<NormalizeAssetNameOptions> = {
  collapseNumericChunks: true,
  stripHash: true,
};

const HASH_PATTERN = '[0-9a-f]{6,32}';
const HASHED_CODE_ASSET = new RegExp(
  `\\.${HASH_PATTERN}\\.(js|css|mjs)(\\.map)?$`,
  'i',
);
const HASHED_GENERIC_ASSET = new RegExp(
  `([._-])${HASH_PATTERN}\\.(png|jpe?g|svg|webp|gif|avif|ico|woff2?|ttf|otf|eot|wasm)$`,
  'i',
);
const NUMERIC_CHUNK = /\/\d+(?=\.(?:js|css|mjs)(?:\.map)?$)/gi;

export function normalizeAssetName(
  assetName: string,
  options: NormalizeAssetNameOptions = {},
): string {
  const resolvedOptions = { ...DEFAULT_NORMALIZE_OPTIONS, ...options };
  let normalized = assetName.replace(/\\/g, '/').replace(/[?#].*$/, '');

  if (resolvedOptions.stripHash) {
    normalized = normalized
      .replace(HASHED_CODE_ASSET, '.$1$2')
      .replace(HASHED_GENERIC_ASSET, '.$2');
  }

  if (resolvedOptions.collapseNumericChunks) {
    normalized = normalized.replace(NUMERIC_CHUNK, '/[N]');
  }

  return normalized;
}

export function getAssetExtension(assetName: string): string {
  const cleanName = assetName.replace(/[?#].*$/, '');
  if (cleanName.endsWith('.css.map')) return '.css.map';
  if (cleanName.endsWith('.js.map')) return '.js.map';
  const match = cleanName.match(/(\.[a-z0-9]+)$/i);
  return match?.[1]?.toLowerCase() ?? '';
}

export function getAssetKind(assetName: string): AssetKind {
  const extension = getAssetExtension(assetName);
  if (extension === '.css') return 'css';
  if (extension === '.js' || extension === '.mjs') return 'js';
  if (extension.endsWith('.map')) return 'map';
  if (
    [
      '.png',
      '.jpg',
      '.jpeg',
      '.svg',
      '.webp',
      '.gif',
      '.avif',
      '.ico',
    ].includes(extension)
  ) {
    return 'image';
  }
  if (['.woff', '.woff2', '.ttf', '.otf', '.eot'].includes(extension)) {
    return 'font';
  }
  if (extension === '.wasm') return 'wasm';
  if (extension === '.html' || extension === '.htm') return 'html';
  if (extension === '.json') return 'json';
  return 'other';
}

export function bytesToHuman(bytes: number): string {
  if (Math.abs(bytes) >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }
  if (Math.abs(bytes) >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

export function signedBytes(bytes: number): string {
  return `${bytes >= 0 ? '+' : ''}${bytesToHuman(bytes)}`;
}
