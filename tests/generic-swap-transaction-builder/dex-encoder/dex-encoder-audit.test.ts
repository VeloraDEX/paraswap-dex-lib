import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { SpecialDex } from '../../../src/executor/types';
import {
  AUDITED_FUNCTION_NEED_WRAP_NATIVE_DEXES,
  KNOWN_SPECIAL_DEX_FLAGS,
} from '../../../src/generic-swap-transaction-builder/dex-encoder';

type NeedWrapNativeMatch = {
  dexKey: string;
  filePath: string;
  line: number;
};

const DEX_SOURCE_ROOT = path.resolve(__dirname, '../../../src/dex');

describe('DEX encoder audit contracts', () => {
  it('keeps function-shaped needWrapNative DEXes in the audited list', () => {
    const matches = scanFunctionNeedWrapNativeDexes();
    const audited = [...AUDITED_FUNCTION_NEED_WRAP_NATIVE_DEXES].sort();

    expect(formatNeedWrapNativeMatches(matches)).toEqual(audited);
  });

  it('keeps known special DEX flags in lockstep with the enum', () => {
    const enumValues = Object.values(SpecialDex)
      .filter((value): value is SpecialDex => typeof value === 'number')
      .sort((a, b) => a - b);
    const knownValues = [...KNOWN_SPECIAL_DEX_FLAGS].sort((a, b) => a - b);

    expect(knownValues).toEqual(enumValues);
  });
});

function scanFunctionNeedWrapNativeDexes(): NeedWrapNativeMatch[] {
  return listTypeScriptSourceFiles(DEX_SOURCE_ROOT)
    .flatMap(filePath => scanFileForFunctionNeedWrapNative(filePath))
    .sort((a, b) => a.dexKey.localeCompare(b.dexKey));
}

function scanFileForFunctionNeedWrapNative(
  filePath: string,
): NeedWrapNativeMatch[] {
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const matches: NeedWrapNativeMatch[] = [];
  const classStack: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isClassDeclaration(node)) {
      if (node.name) classStack.push(node.name.text);
      ts.forEachChild(node, visit);
      if (node.name) classStack.pop();
      return;
    }

    if (isFunctionNeedWrapNativeMember(node)) {
      matches.push(buildMatch(sourceFile, filePath, node, classStack));
      return;
    }

    if (isFunctionNeedWrapNativeAssignment(node)) {
      matches.push(buildMatch(sourceFile, filePath, node, classStack));
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return matches;
}

function isFunctionNeedWrapNativeMember(node: ts.Node): boolean {
  if (ts.isMethodDeclaration(node)) {
    return getPropertyName(node.name) === 'needWrapNative';
  }

  return (
    ts.isPropertyDeclaration(node) &&
    getPropertyName(node.name) === 'needWrapNative' &&
    node.initializer !== undefined &&
    isFunctionLikeValue(node.initializer)
  );
}

function isFunctionNeedWrapNativeAssignment(node: ts.Node): boolean {
  return (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    getAssignedPropertyName(node.left) === 'needWrapNative' &&
    isFunctionLikeValue(node.right)
  );
}

function isFunctionLikeValue(node: ts.Node): boolean {
  // This parser-only audit catches direct function expressions. If a DEX starts
  // assigning needWrapNative through an imported/shared identifier, extend this
  // test with a type-checker or registry-backed runtime audit.
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

function getAssignedPropertyName(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text;
  }

  if (ts.isElementAccessExpression(node)) {
    const argument = node.argumentExpression;
    return ts.isStringLiteral(argument) ? argument.text : undefined;
  }

  return undefined;
}

function getPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }

  return undefined;
}

function buildMatch(
  sourceFile: ts.SourceFile,
  filePath: string,
  node: ts.Node,
  classStack: string[],
): NeedWrapNativeMatch {
  const position = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  const dexKey = classStack[classStack.length - 1];

  if (!dexKey) {
    throw new Error(
      `${path.relative(process.cwd(), filePath)}:${
        position.line + 1
      }: function-shaped needWrapNative is not inside a class`,
    );
  }

  return {
    dexKey,
    filePath,
    line: position.line + 1,
  };
}

function formatNeedWrapNativeMatches(matches: NeedWrapNativeMatch[]): string[] {
  const duplicateDexKeys = findDuplicateDexKeys(matches);
  if (duplicateDexKeys.length > 0) {
    throw new Error(
      `duplicate function-shaped needWrapNative matches: ${duplicateDexKeys.join(
        ', ',
      )}`,
    );
  }

  return matches.map(match => match.dexKey).sort();
}

function findDuplicateDexKeys(matches: NeedWrapNativeMatch[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  matches.forEach(match => {
    if (seen.has(match.dexKey)) duplicates.add(match.dexKey);
    seen.add(match.dexKey);
  });

  return [...duplicates].sort();
}

function listTypeScriptSourceFiles(root: string): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap(entry => {
      const entryPath = path.join(root, entry.name);

      if (entry.isDirectory()) {
        return listTypeScriptSourceFiles(entryPath);
      }

      if (
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts')
      ) {
        return [entryPath];
      }

      return [];
    })
    .sort();
}
