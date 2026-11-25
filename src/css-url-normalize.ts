/**
 * Canonicalize `url()` quoting so semantically identical declarations compare
 * equal after Prettier formatting. Prettier preserves the original quoting of
 * `url()` tokens, so `url(data:...)` and `url("data:...")` stay different even
 * though they are the same value.
 *
 * Only simple, unescaped payloads are rewritten; anything containing quotes,
 * backslashes, whitespace, parentheses or angle brackets is left untouched to
 * avoid changing semantics.
 */
const SIMPLE_URL_CONTENT = /^[A-Za-z0-9!#$%&*+,\-./:;=?@_~]+$/;

interface ParsedUrlFunction {
  content: string;
  end: number;
}

export interface NormalizedCssUrlQuotes {
  content: string;
  normalized: number;
}

export function normalizeCssUrlQuotes(value: string): string {
  return normalizeCssUrlQuotesWithCount(value).content;
}

export function normalizeCssUrlQuotesWithCount(
  value: string,
): NormalizedCssUrlQuotes {
  let output = '';
  let index = 0;
  let quote: string | null = null;
  let normalized = 0;

  while (index < value.length) {
    const char = value[index] ?? '';

    if (quote) {
      output += char;
      if (char === '\\' && index + 1 < value.length) {
        output += value[index + 1] ?? '';
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      output += char;
      index += 1;
      continue;
    }

    if (
      (char === 'u' || char === 'U') &&
      value.slice(index, index + 4).toLowerCase() === 'url(' &&
      !isIdentifierChar(value[index - 1])
    ) {
      const parsed = parseUrlFunction(value, index);
      if (parsed) {
        const original = value.slice(index, parsed.end);
        const canonical = canonicalUrl(parsed.content, original);
        if (canonical !== original) normalized += 1;
        output += canonical;
        index = parsed.end;
        continue;
      }
    }

    output += char;
    index += 1;
  }

  return { content: output, normalized };
}

function isIdentifierChar(char: string | undefined): boolean {
  return Boolean(char && /[A-Za-z0-9_-]/.test(char));
}

function parseUrlFunction(
  value: string,
  start: number,
): ParsedUrlFunction | null {
  let index = start + 4;
  while (index < value.length && /\s/.test(value[index] ?? '')) index += 1;

  const first = value[index];
  if (first === '"' || first === "'") {
    const quote = first;
    const contentStart = index + 1;
    index = contentStart;
    while (index < value.length) {
      const char = value[index];
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === quote) {
        const content = value.slice(contentStart, index);
        index += 1;
        while (index < value.length && /\s/.test(value[index] ?? '')) {
          index += 1;
        }
        if (value[index] !== ')') return null;
        return { content, end: index + 1 };
      }
      index += 1;
    }
    return null;
  }

  const contentStart = index;
  while (index < value.length && value[index] !== ')') index += 1;
  if (index >= value.length) return null;
  return {
    content: value.slice(contentStart, index).trim(),
    end: index + 1,
  };
}

function canonicalUrl(content: string, original: string): string {
  if (!SIMPLE_URL_CONTENT.test(content)) return original;
  return `url("${content}")`;
}
