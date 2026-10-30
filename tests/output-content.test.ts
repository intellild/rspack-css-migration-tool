import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from '@rstest/core';
import {
  compareOutputContents,
  normalizeCssModuleHashes,
  renderOutputContentDiff,
} from '../src/index';

describe('output content comparison', () => {
  test('formats CSS and normalizes implementation-specific CSS Module hashes', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'output-content-'));
    const beforeRoot = path.join(root, 'before');
    const afterRoot = path.join(root, 'after');
    mkdirSync(beforeRoot);
    mkdirSync(afterRoot);

    try {
      writeFileSync(
        path.join(beforeRoot, 'legacy.css'),
        '.cm_card-module_root__abc12{color:red}',
      );
      writeFileSync(
        path.join(afterRoot, 'builtin.css'),
        '.cm_card\\.module_root__xyz98 { color: red; }',
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
      expect(comparison.files[0]?.cssModuleHashesNormalized).toBe(2);
      expect(renderOutputContentDiff(comparison)).toContain(
        'No content differences',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('creates a unified diff from Prettier-formatted content', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'output-content-'));
    const beforeRoot = path.join(root, 'before');
    const afterRoot = path.join(root, 'after');
    mkdirSync(beforeRoot);
    mkdirSync(afterRoot);

    try {
      writeFileSync(path.join(beforeRoot, 'main.css'), 'body{color:red}');
      writeFileSync(path.join(afterRoot, 'main.css'), 'body { color: blue; }');

      const comparison = await compareOutputContents(
        [{ beforeName: 'main.css', afterName: 'main.css' }],
        { beforeRoot, afterRoot },
      );
      const diff = renderOutputContentDiff(comparison);

      expect(comparison.changed).toBe(1);
      expect(diff).toContain('-  color: red;');
      expect(diff).toContain('+  color: blue;');
      expect(diff).toContain('Prettier formatted');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('normalizes hashes without hiding the original local name', () => {
    const normalized = normalizeCssModuleHashes(
      'cm_card-module_title__abc12 cm_card\\.module_title__xyz98',
    );

    expect(normalized.content).toBe(
      'cm_card_module_title__[css-module-hash] cm_card_module_title__[css-module-hash]',
    );
    expect(normalized.replacements).toBe(2);
  });
});
