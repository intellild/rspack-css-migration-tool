import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from '@rstest/core';
import {
  compareOutputContents,
  normalizeCssSelectorsByDeclarations,
  normalizeCssUrlQuotes,
  normalizeCssUrlQuotesWithCount,
  renderOutputContentDiff,
} from '../src/index';

describe('output content comparison', () => {
  test('matches generated selectors by declaration content', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'output-content-'));
    const beforeRoot = path.join(root, 'before');
    const afterRoot = path.join(root, 'after');
    mkdirSync(beforeRoot);
    mkdirSync(afterRoot);

    try {
      writeFileSync(
        path.join(beforeRoot, 'legacy.css'),
        '.legacy-generated-name{color:red}body{margin:0}',
      );
      writeFileSync(
        path.join(afterRoot, 'builtin.css'),
        '.builtin\\.generated_name { color: red; } body { margin: 0; }',
      );

      const comparison = await compareOutputContents(
        [{ beforeName: 'legacy.css', afterName: 'builtin.css' }],
        { beforeRoot, afterRoot },
      );

      expect(comparison).toMatchObject({
        formatted: 1,
        equivalent: 1,
        changed: 0,
        errors: 0,
      });
      expect(comparison.files[0]).toMatchObject({
        cssDeclarationBlocksMatched: 2,
        cssSelectorsNormalized: 1,
      });
      expect(renderOutputContentDiff(comparison)).toContain(
        'No content differences',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('keeps declaration changes after matching different selectors', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'output-content-'));
    const beforeRoot = path.join(root, 'before');
    const afterRoot = path.join(root, 'after');
    mkdirSync(beforeRoot);
    mkdirSync(afterRoot);

    try {
      writeFileSync(
        path.join(beforeRoot, 'main.css'),
        '.legacy-name{color:red;padding:1rem}',
      );
      writeFileSync(
        path.join(afterRoot, 'main.css'),
        '.builtin-name { color: blue; padding: 1rem; }',
      );

      const comparison = await compareOutputContents(
        [{ beforeName: 'main.css', afterName: 'main.css' }],
        { beforeRoot, afterRoot },
      );
      const diff = renderOutputContentDiff(comparison);

      expect(comparison.changed).toBe(1);
      expect(diff).toContain('-  color: red;');
      expect(diff).toContain('+  color: blue;');
      expect(diff).toContain('Prettier formatted');
      expect(diff).not.toContain('legacy-name');
      expect(diff).not.toContain('builtin-name');
      expect(comparison.files[0]?.cssSelectorsNormalized).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('does not treat hash-shaped declaration values as selectors', () => {
    const normalized = normalizeCssSelectorsByDeclarations(
      '.same { content: "title__abc12"; }',
      '.same { content: "title__xyz98"; }',
    );

    expect(normalized.beforeContent).toContain('title__abc12');
    expect(normalized.afterContent).toContain('title__xyz98');
    expect(normalized.normalizedSelectors).toBe(0);
  });

  test('does not match unrelated declaration blocks', () => {
    const normalized = normalizeCssSelectorsByDeclarations(
      '.before { display: grid; }',
      '.after { color: red; }',
    );

    expect(normalized).toMatchObject({
      matchedDeclarationBlocks: 0,
      normalizedSelectors: 0,
    });
    expect(normalized.beforeContent).toContain('.before');
    expect(normalized.afterContent).toContain('.after');
  });

  test('canonicalizes url() quoting', () => {
    const value = 'a{background:url(data:font/woff2;base64,AAAA)}';

    expect(normalizeCssUrlQuotes(value)).toBe(
      'a{background:url("data:font/woff2;base64,AAAA")}',
    );
    expect(normalizeCssUrlQuotesWithCount(value)).toEqual({
      content: 'a{background:url("data:font/woff2;base64,AAAA")}',
      normalized: 1,
    });
    expect(
      normalizeCssUrlQuotes('a{background:url("data:font/woff2;base64,AAAA")}'),
    ).toBe('a{background:url("data:font/woff2;base64,AAAA")}');
  });

  test('leaves url() payloads that need escaping untouched', () => {
    const value =
      'a{background:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'/%3E")}';

    expect(normalizeCssUrlQuotesWithCount(value)).toEqual({
      content: value,
      normalized: 0,
    });
  });

  test('treats url() quote differences as equivalent by default', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'output-content-'));
    const beforeRoot = path.join(root, 'before');
    const afterRoot = path.join(root, 'after');
    mkdirSync(beforeRoot);
    mkdirSync(afterRoot);

    try {
      writeFileSync(
        path.join(beforeRoot, 'font.css'),
        '@font-face{font-family:x;src:url(data:font/woff2;base64,AAAA) format("woff2")}',
      );
      writeFileSync(
        path.join(afterRoot, 'font.css'),
        '@font-face{font-family:x;src:url("data:font/woff2;base64,AAAA") format("woff2")}',
      );

      const comparison = await compareOutputContents(
        [{ beforeName: 'font.css', afterName: 'font.css' }],
        { beforeRoot, afterRoot },
      );

      expect(comparison).toMatchObject({ equivalent: 1, changed: 0 });
      expect(comparison.files[0]?.cssUrlQuotesNormalized).toBe(1);

      const raw = await compareOutputContents(
        [{ beforeName: 'font.css', afterName: 'font.css' }],
        { beforeRoot, afterRoot, normalizeCssUrlQuotes: false },
      );
      expect(raw).toMatchObject({ equivalent: 0, changed: 1 });
      expect(renderOutputContentDiff(raw)).toContain('url(data:font/woff2');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
