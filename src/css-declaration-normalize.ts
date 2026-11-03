import { createHash } from 'node:crypto';
import postcss, { type AtRule, type Node, type Root, type Rule } from 'postcss';
import selectorParser from 'postcss-selector-parser';

export interface NormalizeCssSelectorsOptions {
  maxFingerprintDistance?: number;
}

export interface NormalizedCssContentPair {
  beforeContent: string;
  afterContent: string;
  matchedDeclarationBlocks: number;
  normalizedSelectors: number;
}

interface SelectorInfo {
  classNames: string[];
  shape: string;
}

interface MutableClassNode {
  value: string;
  setPropertyWithoutEscape(name: string, value: unknown): void;
}

interface DeclarationBlock {
  rule: Rule;
  index: number;
  context: string;
  declarations: string[];
  properties: Set<string>;
  fingerprint: bigint;
  fingerprintHex: string;
  selector: SelectorInfo;
}

interface DeclarationBlockPair {
  before: DeclarationBlock;
  after: DeclarationBlock;
  distance: number;
  exact: boolean;
}

interface FingerprintTreeNode {
  fingerprint: bigint;
  blocks: DeclarationBlock[];
  children: Map<number, FingerprintTreeNode>;
}

const FINGERPRINT_BITS = 64;
const DEFAULT_MAX_FINGERPRINT_DISTANCE = 0.25;

export function normalizeCssSelectorsByDeclarations(
  beforeContent: string,
  afterContent: string,
  options: NormalizeCssSelectorsOptions = {},
): NormalizedCssContentPair {
  const maxFingerprintDistance =
    options.maxFingerprintDistance ?? DEFAULT_MAX_FINGERPRINT_DISTANCE;
  if (maxFingerprintDistance < 0 || maxFingerprintDistance > 1) {
    throw new Error(
      `maxFingerprintDistance must be between 0 and 1, received ${maxFingerprintDistance}`,
    );
  }

  const beforeRoot = postcss.parse(beforeContent);
  const afterRoot = postcss.parse(afterContent);
  const beforeBlocks = collectDeclarationBlocks(beforeRoot);
  const afterBlocks = collectDeclarationBlocks(afterRoot);
  const pairs = matchDeclarationBlocks(
    beforeBlocks,
    afterBlocks,
    maxFingerprintDistance,
  );

  let normalizedSelectors = 0;
  for (const pair of pairs) {
    normalizedSelectors += normalizeSelectorPair(pair);
  }

  return {
    beforeContent: normalizedSelectors ? beforeRoot.toString() : beforeContent,
    afterContent: normalizedSelectors ? afterRoot.toString() : afterContent,
    matchedDeclarationBlocks: pairs.length,
    normalizedSelectors,
  };
}

function collectDeclarationBlocks(root: Root): DeclarationBlock[] {
  const blocks: DeclarationBlock[] = [];
  root.walkRules((rule) => {
    const declarationNodes = rule.nodes.filter((node) => node.type === 'decl');
    const declarations = declarationNodes.map((declaration) => {
      const property = declaration.prop.trim().toLowerCase();
      const value = normalizeDeclarationValue(declaration.value);
      return `${property}:${value}${declaration.important ? '!important' : ''}`;
    });
    if (!declarations.length) return;

    const selector = parseSelector(rule.selector);
    if (!selector) return;

    const fingerprint = createSimHash(declarations);
    blocks.push({
      rule,
      index: blocks.length,
      context: getRuleContext(rule),
      declarations,
      properties: new Set(
        declarationNodes.map((declaration) =>
          declaration.prop.trim().toLowerCase(),
        ),
      ),
      fingerprint,
      fingerprintHex: fingerprint.toString(16).padStart(16, '0'),
      selector,
    });
  });
  return blocks;
}

function parseSelector(selector: string): SelectorInfo | null {
  try {
    const ast = selectorParser().astSync(selector);
    const classNames: string[] = [];
    ast.walkClasses((classNode) => {
      classNames.push(classNode.value);
      classNode.setPropertyWithoutEscape(
        'value',
        `rspack-css-class-${classNames.length}`,
      );
    });
    return { classNames, shape: ast.toString() };
  } catch {
    return null;
  }
}

function getRuleContext(rule: Rule): string {
  const context: string[] = [];
  let current: Node | undefined = rule.parent;

  while (current) {
    if (current.type === 'atrule') {
      context.push(formatAtRuleContext(current as AtRule));
    } else if (current.type === 'rule') {
      const parentRule = current as Rule;
      context.push(
        parseSelector(parentRule.selector)?.shape ?? parentRule.selector,
      );
    }
    current = current.parent;
  }

  return context.reverse().join('/');
}

function formatAtRuleContext(atRule: AtRule): string {
  const params = atRule.params.trim();
  return `@${atRule.name.toLowerCase()}${params ? ` ${params}` : ''}`;
}

function normalizeDeclarationValue(value: string): string {
  return value.trim();
}

function createSimHash(declarations: string[]): bigint {
  const weights = new Map<string, number>();

  for (const declaration of declarations) {
    const separator = declaration.indexOf(':');
    const property = declaration.slice(0, separator);
    const value = declaration.slice(separator + 1);
    addFeature(weights, `property:${property}`, 4);
    addFeature(weights, `declaration:${declaration}`, 8);

    const valueTokens = value.match(/[-\w.%#]+|[^\s]/g) ?? [];
    for (const token of valueTokens) {
      addFeature(weights, `value:${property}:${token}`, 1);
    }
    for (let index = 1; index < valueTokens.length; index += 1) {
      addFeature(
        weights,
        `pair:${property}:${valueTokens[index - 1]}:${valueTokens[index]}`,
        1,
      );
    }
  }

  const vector = new Array<number>(FINGERPRINT_BITS).fill(0);
  for (const [feature, weight] of weights) {
    const hash = BigInt(
      `0x${createHash('sha256').update(feature).digest('hex').slice(0, 16)}`,
    );
    for (let bit = 0; bit < FINGERPRINT_BITS; bit += 1) {
      const mask = 1n << BigInt(bit);
      vector[bit] = (vector[bit] ?? 0) + (hash & mask ? weight : -weight);
    }
  }

  return vector.reduce(
    (fingerprint, weight, bit) =>
      weight >= 0 ? fingerprint | (1n << BigInt(bit)) : fingerprint,
    0n,
  );
}

function addFeature(
  features: Map<string, number>,
  feature: string,
  weight: number,
): void {
  features.set(feature, (features.get(feature) ?? 0) + weight);
}

function matchDeclarationBlocks(
  beforeBlocks: DeclarationBlock[],
  afterBlocks: DeclarationBlock[],
  maxFingerprintDistance: number,
): DeclarationBlockPair[] {
  const candidates: DeclarationBlockPair[] = [];
  const afterTrees = new Map<string, FingerprintTreeNode>();
  const maxHammingDistance = Math.floor(
    maxFingerprintDistance * FINGERPRINT_BITS,
  );

  for (const after of afterBlocks) {
    const key = getSelectorStructureKey(after);
    const tree = afterTrees.get(key);
    if (tree) {
      insertFingerprintTreeNode(tree, after);
    } else {
      afterTrees.set(key, createFingerprintTreeNode(after));
    }
  }

  for (const before of beforeBlocks) {
    const tree = afterTrees.get(getSelectorStructureKey(before));
    if (!tree) continue;
    const possibleMatches = findNearbyDeclarationBlocks(
      tree,
      before.fingerprint,
      maxHammingDistance,
    );

    for (const after of possibleMatches) {
      const propertyOverlap = setOverlap(before.properties, after.properties);
      if (propertyOverlap < 0.6) continue;

      const distance =
        hammingDistance(before.fingerprint, after.fingerprint) /
        FINGERPRINT_BITS;
      const exact = arraysEqual(before.declarations, after.declarations);
      if (!exact && distance > maxFingerprintDistance) continue;

      const declarationCountDifference = Math.abs(
        before.declarations.length - after.declarations.length,
      );
      if (
        declarationCountDifference >
        Math.max(
          1,
          Math.ceil(
            Math.max(before.declarations.length, after.declarations.length) *
              0.25,
          ),
        )
      ) {
        continue;
      }

      candidates.push({ before, after, distance, exact });
    }
  }

  candidates.sort(
    (left, right) =>
      Number(right.exact) - Number(left.exact) ||
      left.distance - right.distance ||
      Math.abs(left.before.index - left.after.index) -
        Math.abs(right.before.index - right.after.index) ||
      left.before.index - right.before.index ||
      left.after.index - right.after.index,
  );

  const usedBefore = new Set<DeclarationBlock>();
  const usedAfter = new Set<DeclarationBlock>();
  const matches: DeclarationBlockPair[] = [];
  for (const candidate of candidates) {
    if (usedBefore.has(candidate.before) || usedAfter.has(candidate.after)) {
      continue;
    }
    usedBefore.add(candidate.before);
    usedAfter.add(candidate.after);
    matches.push(candidate);
  }

  return matches.sort((left, right) => left.before.index - right.before.index);
}

function getSelectorStructureKey(block: DeclarationBlock): string {
  return [
    block.context,
    block.selector.shape,
    block.selector.classNames.length,
  ].join('\0');
}

function createFingerprintTreeNode(
  block: DeclarationBlock,
): FingerprintTreeNode {
  return {
    fingerprint: block.fingerprint,
    blocks: [block],
    children: new Map(),
  };
}

function insertFingerprintTreeNode(
  root: FingerprintTreeNode,
  block: DeclarationBlock,
): void {
  let current = root;
  while (true) {
    const distance = hammingDistance(current.fingerprint, block.fingerprint);
    if (distance === 0) {
      current.blocks.push(block);
      return;
    }

    const child = current.children.get(distance);
    if (child) {
      current = child;
    } else {
      current.children.set(distance, createFingerprintTreeNode(block));
      return;
    }
  }
}

function findNearbyDeclarationBlocks(
  root: FingerprintTreeNode,
  fingerprint: bigint,
  maxDistance: number,
): DeclarationBlock[] {
  const matches: DeclarationBlock[] = [];
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    const distance = hammingDistance(current.fingerprint, fingerprint);
    if (distance <= maxDistance) matches.push(...current.blocks);

    const minimumChildDistance = distance - maxDistance;
    const maximumChildDistance = distance + maxDistance;
    for (const [childDistance, child] of current.children) {
      if (
        childDistance >= minimumChildDistance &&
        childDistance <= maximumChildDistance
      ) {
        stack.push(child);
      }
    }
  }

  return matches;
}

function normalizeSelectorPair(pair: DeclarationBlockPair): number {
  const beforeAst = selectorParser().astSync(pair.before.rule.selector);
  const afterAst = selectorParser().astSync(pair.after.rule.selector);
  const beforeClasses: MutableClassNode[] = [];
  const afterClasses: MutableClassNode[] = [];

  beforeAst.walkClasses((classNode) => {
    beforeClasses.push(classNode);
  });
  afterAst.walkClasses((classNode) => {
    afterClasses.push(classNode);
  });
  if (beforeClasses.length !== afterClasses.length) return 0;

  let normalized = 0;
  for (let index = 0; index < beforeClasses.length; index += 1) {
    const beforeClass = beforeClasses[index];
    const afterClass = afterClasses[index];
    if (!beforeClass || !afterClass || beforeClass.value === afterClass.value) {
      continue;
    }

    const fingerprintPair = [
      pair.before.fingerprintHex,
      pair.after.fingerprintHex,
    ]
      .sort()
      .join(':');
    const selectorHash = createHash('sha256')
      .update(`${fingerprintPair}:${index}`)
      .digest('hex')
      .slice(0, 12);
    const normalizedClassName = `rspack-css-${selectorHash}`;
    beforeClass.setPropertyWithoutEscape('value', normalizedClassName);
    afterClass.setPropertyWithoutEscape('value', normalizedClassName);
    normalized += 1;
  }

  if (normalized) {
    pair.before.rule.selector = beforeAst.toString();
    pair.after.rule.selector = afterAst.toString();
  }
  return normalized;
}

function hammingDistance(left: bigint, right: bigint): number {
  let value = left ^ right;
  let distance = 0;
  while (value) {
    value &= value - 1n;
    distance += 1;
  }
  return distance;
}

function setOverlap(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) intersection += 1;
  }
  return intersection / Math.max(left.size, right.size);
}

function arraysEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
