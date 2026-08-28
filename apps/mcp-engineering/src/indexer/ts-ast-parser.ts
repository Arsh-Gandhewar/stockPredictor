/**
 * TsAstParser — extracts symbols from TypeScript/JavaScript files using the
 * TypeScript compiler API (ts.createSourceFile). NO regex is used for symbol
 * extraction; everything goes through the AST.
 *
 * Extracted symbols:
 *  - class declarations (and their methods/properties)
 *  - function declarations
 *  - interface declarations
 *  - type alias declarations
 *  - enum declarations
 *  - exported const/let/var declarations
 *  - import statements (as 'module' symbols)
 *  - export statements
 *
 * Framework awareness:
 *  - NestJS: @Module, @Controller, @Injectable, @Get, @Post, @Put, @Delete
 *  - React: functional components (functions returning JSX element)
 */

import * as ts from 'typescript';
import * as path from 'node:path';
import type { SymbolRecord, SymbolKind, Language } from '../types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSymbolId(filePath: string, name: string, kind: SymbolKind): string {
  return `${filePath}:${name}:${kind}`;
}

function getLineNumber(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

function getEndLine(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
}

function isExported(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return (
    modifiers?.some(
      (m) =>
        m.kind === ts.SyntaxKind.ExportKeyword ||
        m.kind === ts.SyntaxKind.DefaultKeyword,
    ) ?? false
  );
}

function getDecoratorNames(node: ts.Node): string[] {
  if (!ts.canHaveDecorators(node)) return [];
  const decorators = ts.getDecorators(node);
  if (!decorators) return [];
  return decorators
    .map((d) => {
      const expr = d.expression;
      if (ts.isCallExpression(expr)) {
        return ts.isIdentifier(expr.expression) ? expr.expression.text : '';
      }
      if (ts.isIdentifier(expr)) return expr.text;
      return '';
    })
    .filter(Boolean);
}

/**
 * Extract JSDoc comment text immediately preceding a node.
 */
function extractJsDoc(node: ts.Node, sourceText: string): string | undefined {
  const jsDocComments = (node as ts.Node & { jsDoc?: ts.JSDoc[] }).jsDoc;
  if (jsDocComments && jsDocComments.length > 0) {
    const last = jsDocComments[jsDocComments.length - 1];
    if (last) {
      return typeof last.comment === 'string'
        ? last.comment
        : last.comment
          ? last.comment.map((c) => ('text' in c ? c.text : '')).join('')
          : undefined;
    }
  }
  // Fallback: look for a /** */ comment above the node
  const nodeStart = node.getFullStart();
  const textBefore = sourceText.slice(Math.max(0, nodeStart - 512), nodeStart);
  const match = textBefore.match(/\/\*\*([\s\S]*?)\*\/\s*$/);
  return match ? match[1]?.trim() : undefined;
}

/**
 * Produce the signature (first meaningful line of text) for a node.
 */
function extractSignature(node: ts.Node, sourceFile: ts.SourceFile): string {
  const fullText = node.getText(sourceFile);
  // Return up to the first { or up to 200 chars
  const brace = fullText.indexOf('{');
  const slice = brace > -1 ? fullText.slice(0, brace) : fullText.slice(0, 200);
  return slice.replace(/\s+/g, ' ').trim();
}

/** Detect NestJS HTTP method decorator → route kind. */
const NESTJS_HTTP_DECORATORS = new Set(['Get', 'Post', 'Put', 'Delete', 'Patch', 'Options', 'Head', 'All']);
const NESTJS_CLASS_DECORATORS = new Set(['Module', 'Controller', 'Injectable', 'Guard', 'Interceptor', 'Pipe', 'Middleware']);

// ---------------------------------------------------------------------------
// TsAstParser
// ---------------------------------------------------------------------------

export class TsAstParser {
  /**
   * Parse a TypeScript or JavaScript file and return all extracted symbols.
   */
  parseFile(filePath: string, content: string): SymbolRecord[] {
    const scriptKind = filePath.endsWith('.tsx') || filePath.endsWith('.jsx')
      ? ts.ScriptKind.TSX
      : filePath.endsWith('.js') || filePath.endsWith('.jsx') || filePath.endsWith('.mjs')
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;

    const sourceFile = ts.createSourceFile(
      path.basename(filePath),
      content,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      scriptKind,
    );

    const symbols: SymbolRecord[] = [];
    const fileLanguage: Language =
      filePath.endsWith('.js') || filePath.endsWith('.jsx') || filePath.endsWith('.mjs')
        ? 'javascript'
        : 'typescript';

    this.visitNode(sourceFile, sourceFile, filePath, fileLanguage, content, symbols, undefined);
    return symbols;
  }

  // --------------------------------------------------------------------------
  // AST visitor
  // --------------------------------------------------------------------------

  private visitNode(
    node: ts.Node,
    sourceFile: ts.SourceFile,
    filePath: string,
    language: Language,
    sourceText: string,
    symbols: SymbolRecord[],
    parentSymbol: string | undefined,
  ): void {
    switch (node.kind) {
      case ts.SyntaxKind.ClassDeclaration:
        this.handleClass(
          node as ts.ClassDeclaration,
          sourceFile,
          filePath,
          language,
          sourceText,
          symbols,
          parentSymbol,
        );
        break;

      case ts.SyntaxKind.FunctionDeclaration:
        this.handleFunction(
          node as ts.FunctionDeclaration,
          sourceFile,
          filePath,
          language,
          sourceText,
          symbols,
          parentSymbol,
        );
        break;

      case ts.SyntaxKind.InterfaceDeclaration:
        this.handleInterface(
          node as ts.InterfaceDeclaration,
          sourceFile,
          filePath,
          language,
          sourceText,
          symbols,
        );
        break;

      case ts.SyntaxKind.TypeAliasDeclaration:
        this.handleTypeAlias(
          node as ts.TypeAliasDeclaration,
          sourceFile,
          filePath,
          language,
          sourceText,
          symbols,
        );
        break;

      case ts.SyntaxKind.EnumDeclaration:
        this.handleEnum(
          node as ts.EnumDeclaration,
          sourceFile,
          filePath,
          language,
          sourceText,
          symbols,
        );
        break;

      case ts.SyntaxKind.VariableStatement:
        this.handleVariableStatement(
          node as ts.VariableStatement,
          sourceFile,
          filePath,
          language,
          sourceText,
          symbols,
          parentSymbol,
        );
        break;

      case ts.SyntaxKind.ImportDeclaration:
        this.handleImport(
          node as ts.ImportDeclaration,
          sourceFile,
          filePath,
          language,
          symbols,
        );
        break;

      case ts.SyntaxKind.ExportDeclaration:
        this.handleExport(
          node as ts.ExportDeclaration,
          sourceFile,
          filePath,
          language,
          symbols,
        );
        break;

      default:
        ts.forEachChild(node, (child) =>
          this.visitNode(
            child,
            sourceFile,
            filePath,
            language,
            sourceText,
            symbols,
            parentSymbol,
          ),
        );
    }
  }

  // --------------------------------------------------------------------------
  // Class handler
  // --------------------------------------------------------------------------

  private handleClass(
    node: ts.ClassDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string,
    language: Language,
    sourceText: string,
    symbols: SymbolRecord[],
    parentSymbol: string | undefined,
  ): void {
    const name = node.name?.text ?? '<anonymous>';
    const exported = isExported(node);
    const startLine = getLineNumber(sourceFile, node.getStart(sourceFile));
    const endLine = getEndLine(sourceFile, node);
    const decoratorNames = getDecoratorNames(node);
    const docstring = extractJsDoc(node, sourceText);
    const signature = extractSignature(node, sourceFile);

    // Determine kind — NestJS may override 'class'
    let kind: SymbolKind = 'class';
    if (decoratorNames.some((d) => NESTJS_CLASS_DECORATORS.has(d))) {
      // Keep as 'class', decorator names stored implicitly in signature
    }

    const symbolId = makeSymbolId(filePath, name, kind);

    symbols.push({
      symbolId,
      name,
      kind,
      file: filePath,
      startLine,
      endLine,
      language,
      exported,
      parentSymbol,
      signature,
      docstring,
    });

    // Visit class members
    for (const member of node.members) {
      this.handleClassMember(
        member,
        sourceFile,
        filePath,
        language,
        sourceText,
        symbols,
        name,
      );
    }
  }

  private handleClassMember(
    member: ts.ClassElement,
    sourceFile: ts.SourceFile,
    filePath: string,
    language: Language,
    sourceText: string,
    symbols: SymbolRecord[],
    parentName: string,
  ): void {
    const startLine = getLineNumber(sourceFile, member.getStart(sourceFile));
    const endLine = getEndLine(sourceFile, member);

    if (
      ts.isMethodDeclaration(member) ||
      ts.isConstructorDeclaration(member)
    ) {
      const name = ts.isConstructorDeclaration(member)
        ? 'constructor'
        : member.name && ts.isIdentifier(member.name)
          ? member.name.text
          : '<computed>';

      const decoratorNames = getDecoratorNames(member);
      const isRoute = decoratorNames.some((d) => NESTJS_HTTP_DECORATORS.has(d));
      const kind: SymbolKind = isRoute ? 'route' : 'method';
      const exported = isExported(member);
      const docstring = extractJsDoc(member, sourceText);
      const signature = extractSignature(member, sourceFile);

      symbols.push({
        symbolId: makeSymbolId(filePath, `${parentName}.${name}`, kind),
        name,
        kind,
        file: filePath,
        startLine,
        endLine,
        language,
        exported,
        parentSymbol: parentName,
        signature,
        docstring,
      });
    } else if (ts.isPropertyDeclaration(member)) {
      const name =
        member.name && ts.isIdentifier(member.name)
          ? member.name.text
          : '<computed>';

      symbols.push({
        symbolId: makeSymbolId(filePath, `${parentName}.${name}`, 'property'),
        name,
        kind: 'property',
        file: filePath,
        startLine,
        endLine,
        language,
        exported: false,
        parentSymbol: parentName,
        signature: extractSignature(member, sourceFile),
        docstring: extractJsDoc(member, sourceText),
      });
    }
  }

  // --------------------------------------------------------------------------
  // Function handler
  // --------------------------------------------------------------------------

  private handleFunction(
    node: ts.FunctionDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string,
    language: Language,
    sourceText: string,
    symbols: SymbolRecord[],
    parentSymbol: string | undefined,
  ): void {
    const name = node.name?.text ?? '<anonymous>';
    const exported = isExported(node);
    const startLine = getLineNumber(sourceFile, node.getStart(sourceFile));
    const endLine = getEndLine(sourceFile, node);
    const signature = extractSignature(node, sourceFile);
    const docstring = extractJsDoc(node, sourceText);

    // React component detection: exported function starting with capital letter
    // and whose body contains JSX
    const returnsJsx = this.functionBodyContainsJsx(node);
    const isReactComponent =
      exported &&
      /^[A-Z]/.test(name) &&
      (returnsJsx || filePath.endsWith('.tsx') || filePath.endsWith('.jsx'));

    const kind: SymbolKind = isReactComponent ? 'component' : 'function';

    symbols.push({
      symbolId: makeSymbolId(filePath, name, kind),
      name,
      kind,
      file: filePath,
      startLine,
      endLine,
      language,
      exported,
      parentSymbol,
      signature,
      docstring,
    });
  }

  private functionBodyContainsJsx(node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression): boolean {
    if (!node.body) return false;
    let found = false;
    const check = (n: ts.Node): void => {
      if (found) return;
      if (
        n.kind === ts.SyntaxKind.JsxElement ||
        n.kind === ts.SyntaxKind.JsxSelfClosingElement ||
        n.kind === ts.SyntaxKind.JsxFragment
      ) {
        found = true;
        return;
      }
      ts.forEachChild(n, check);
    };
    check(node.body);
    return found;
  }

  // --------------------------------------------------------------------------
  // Interface handler
  // --------------------------------------------------------------------------

  private handleInterface(
    node: ts.InterfaceDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string,
    language: Language,
    sourceText: string,
    symbols: SymbolRecord[],
  ): void {
    const name = node.name.text;
    symbols.push({
      symbolId: makeSymbolId(filePath, name, 'interface'),
      name,
      kind: 'interface',
      file: filePath,
      startLine: getLineNumber(sourceFile, node.getStart(sourceFile)),
      endLine: getEndLine(sourceFile, node),
      language,
      exported: isExported(node),
      signature: extractSignature(node, sourceFile),
      docstring: extractJsDoc(node, sourceText),
    });
  }

  // --------------------------------------------------------------------------
  // Type alias handler
  // --------------------------------------------------------------------------

  private handleTypeAlias(
    node: ts.TypeAliasDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string,
    language: Language,
    sourceText: string,
    symbols: SymbolRecord[],
  ): void {
    const name = node.name.text;
    symbols.push({
      symbolId: makeSymbolId(filePath, name, 'type'),
      name,
      kind: 'type',
      file: filePath,
      startLine: getLineNumber(sourceFile, node.getStart(sourceFile)),
      endLine: getEndLine(sourceFile, node),
      language,
      exported: isExported(node),
      signature: extractSignature(node, sourceFile),
      docstring: extractJsDoc(node, sourceText),
    });
  }

  // --------------------------------------------------------------------------
  // Enum handler
  // --------------------------------------------------------------------------

  private handleEnum(
    node: ts.EnumDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string,
    language: Language,
    sourceText: string,
    symbols: SymbolRecord[],
  ): void {
    const name = node.name.text;
    symbols.push({
      symbolId: makeSymbolId(filePath, name, 'enum'),
      name,
      kind: 'enum',
      file: filePath,
      startLine: getLineNumber(sourceFile, node.getStart(sourceFile)),
      endLine: getEndLine(sourceFile, node),
      language,
      exported: isExported(node),
      signature: extractSignature(node, sourceFile),
      docstring: extractJsDoc(node, sourceText),
    });
  }

  // --------------------------------------------------------------------------
  // Variable statement handler
  // --------------------------------------------------------------------------

  private handleVariableStatement(
    node: ts.VariableStatement,
    sourceFile: ts.SourceFile,
    filePath: string,
    language: Language,
    sourceText: string,
    symbols: SymbolRecord[],
    parentSymbol: string | undefined,
  ): void {
    const exported = isExported(node);
    const isConst =
      (node.declarationList.flags & ts.NodeFlags.Const) !== 0;

    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      const name = decl.name.text;
      const startLine = getLineNumber(sourceFile, node.getStart(sourceFile));
      const endLine = getEndLine(sourceFile, node);

      // Check if the initializer is an arrow function or function expression
      let kind: SymbolKind = isConst ? 'constant' : 'variable';
      let actualKind: SymbolKind = kind;

      if (decl.initializer) {
        const init = decl.initializer;
        if (
          ts.isArrowFunction(init) ||
          ts.isFunctionExpression(init)
        ) {
          // Could be a React component
          const returnsJsx = this.functionBodyContainsJsx(
            init as ts.ArrowFunction | ts.FunctionExpression,
          );
          const isReactComponent =
            exported &&
            /^[A-Z]/.test(name) &&
            (returnsJsx ||
              filePath.endsWith('.tsx') ||
              filePath.endsWith('.jsx'));
          actualKind = isReactComponent ? 'component' : 'function';
        }
      }

      symbols.push({
        symbolId: makeSymbolId(filePath, name, actualKind),
        name,
        kind: actualKind,
        file: filePath,
        startLine,
        endLine,
        language,
        exported,
        parentSymbol,
        signature: extractSignature(node, sourceFile),
        docstring: extractJsDoc(node, sourceText),
      });
    }
  }

  // --------------------------------------------------------------------------
  // Import handler
  // --------------------------------------------------------------------------

  private handleImport(
    node: ts.ImportDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string,
    language: Language,
    symbols: SymbolRecord[],
  ): void {
    const moduleSpecifier = ts.isStringLiteral(node.moduleSpecifier)
      ? node.moduleSpecifier.text
      : '';

    // Named imports: import { A, B } from 'mod'
    const importClause = node.importClause;
    const namedBindings = importClause?.namedBindings;
    let importedNames: string[] = [];

    if (importClause?.name) {
      importedNames.push(importClause.name.text); // default import
    }

    if (namedBindings) {
      if (ts.isNamedImports(namedBindings)) {
        importedNames = importedNames.concat(
          namedBindings.elements.map((e) => e.name.text),
        );
      } else if (ts.isNamespaceImport(namedBindings)) {
        importedNames.push(`* as ${namedBindings.name.text}`);
      }
    }

    const name = importedNames.length > 0
      ? importedNames.join(', ')
      : moduleSpecifier;

    symbols.push({
      symbolId: makeSymbolId(filePath, `import:${moduleSpecifier}`, 'module'),
      name,
      kind: 'module',
      file: filePath,
      startLine: getLineNumber(sourceFile, node.getStart(sourceFile)),
      endLine: getEndLine(sourceFile, node),
      language,
      exported: false,
      signature: `import from '${moduleSpecifier}'`,
    });
  }

  // --------------------------------------------------------------------------
  // Export declaration handler (re-exports)
  // --------------------------------------------------------------------------

  private handleExport(
    node: ts.ExportDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string,
    language: Language,
    symbols: SymbolRecord[],
  ): void {
    const moduleSpecifier =
      node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : undefined;

    const namedExports = node.exportClause;
    if (!namedExports || !ts.isNamedExports(namedExports)) return;

    for (const element of namedExports.elements) {
      const name = element.name.text;
      symbols.push({
        symbolId: makeSymbolId(filePath, `export:${name}`, 'module'),
        name,
        kind: 'module',
        file: filePath,
        startLine: getLineNumber(sourceFile, node.getStart(sourceFile)),
        endLine: getEndLine(sourceFile, node),
        language,
        exported: true,
        signature: moduleSpecifier
          ? `export { ${name} } from '${moduleSpecifier}'`
          : `export { ${name} }`,
      });
    }
  }
}
