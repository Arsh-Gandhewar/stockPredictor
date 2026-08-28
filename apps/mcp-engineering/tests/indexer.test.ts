/**
 * Indexer test suite: TsAstParser, PrismaParser, JsonYamlParser, IndexStore
 */

import { TsAstParser } from '../src/indexer/ts-ast-parser.js';
import { PrismaParser } from '../src/indexer/prisma-parser.js';
import { JsonYamlParser } from '../src/indexer/json-yaml-parser.js';
import { IndexStore } from '../src/indexer/index-store.js';
import type { FileRecord, SymbolRecord } from '../src/types/index.js';

describe('TsAstParser', () => {
  const parser = new TsAstParser();

  test('extracts classes, methods, and functions from TypeScript', () => {
    const code = `
      export class TestEngine {
        private counter: number = 0;

        constructor() {
          this.counter = 1;
        }

        public computeMetrics(a: number, b: number): number {
          return a + b;
        }
      }

      export function helperFunction(x: string): boolean {
        return x.length > 0;
      }
    `;

    const symbols = parser.parseFile('test.ts', code);
    expect(symbols.length).toBeGreaterThan(0);

    const classSym = symbols.find((s) => s.name === 'TestEngine');
    expect(classSym).toBeDefined();
    expect(classSym?.kind).toBe('class');
    expect(classSym?.exported).toBe(true);

    const methodSym = symbols.find((s) => s.name === 'computeMetrics');
    expect(methodSym).toBeDefined();
    expect(methodSym?.kind).toBe('method');
    expect(methodSym?.parentSymbol).toBe('TestEngine');

    const fnSym = symbols.find((s) => s.name === 'helperFunction');
    expect(fnSym).toBeDefined();
    expect(fnSym?.kind).toBe('function');
  });

  test('extracts interfaces, types, and enums', () => {
    const code = `
      export interface UserProfile {
        id: string;
        name: string;
      }

      export type Status = 'ACTIVE' | 'INACTIVE';

      export enum MarketState {
        OPEN = 'OPEN',
        CLOSED = 'CLOSED',
      }
    `;

    const symbols = parser.parseFile('types.ts', code);
    const iface = symbols.find((s) => s.name === 'UserProfile');
    expect(iface?.kind).toBe('interface');

    const typeAlias = symbols.find((s) => s.name === 'Status');
    expect(typeAlias?.kind).toBe('type');

    const enumSym = symbols.find((s) => s.name === 'MarketState');
    expect(enumSym?.kind).toBe('enum');
  });
});

describe('PrismaParser', () => {
  const parser = new PrismaParser();

  test('extracts models, fields, and enums from prisma schema', () => {
    const schema = `
      model User {
        id        String   @id @default(uuid())
        email     String   @unique
        role      Role     @default(USER)
        createdAt DateTime @default(now())
      }

      enum Role {
        USER
        ADMIN
      }
    `;

    const symbols = parser.parseFile('schema.prisma', schema);
    const model = symbols.find((s) => s.name === 'User' && s.kind === 'class');
    expect(model).toBeDefined();

    const field = symbols.find((s) => s.name === 'email');
    expect(field).toBeDefined();
    expect(field?.parentSymbol).toBe('User');

    const roleEnum = symbols.find((s) => s.name === 'Role' && s.kind === 'enum');
    expect(roleEnum).toBeDefined();
  });
});

describe('JsonYamlParser', () => {
  const parser = new JsonYamlParser();

  test('extracts top-level keys from json', () => {
    const jsonStr = JSON.stringify({
      name: 'quantx',
      version: '1.0.0',
      private: true,
    });

    const symbols = parser.parseFile('package.json', jsonStr);
    expect(symbols.length).toBe(3);
    expect(symbols.map((s) => s.name)).toEqual(expect.arrayContaining(['name', 'version', 'private']));
  });

  test('extracts top-level keys from yaml', () => {
    const yamlStr = `
version: "3"
services:
  app:
    image: node
networks:
  main:
`;

    const symbols = parser.parseFile('docker-compose.yml', yamlStr);
    expect(symbols.map((s) => s.name)).toEqual(expect.arrayContaining(['version', 'services', 'networks']));
  });
});

describe('IndexStore', () => {
  test('stores and retrieves FileRecords and SymbolRecords', () => {
    const store = new IndexStore();

    const sym: SymbolRecord = {
      symbolId: 'test.ts:MyClass:class',
      name: 'MyClass',
      kind: 'class',
      file: 'test.ts',
      startLine: 1,
      endLine: 10,
      language: 'typescript',
      exported: true,
    };

    const file: FileRecord = {
      filePath: 'test.ts',
      language: 'typescript',
      sizeBytes: 100,
      contentHash: 'abc123hash',
      lastIndexedCommit: 'headsha',
      exports: ['MyClass'],
      imports: [],
      symbols: [sym],
      isGenerated: false,
      isSecret: false,
    };

    store.setFile(file);

    expect(store.getFile('test.ts')).toBeDefined();
    expect(store.getAllFiles().length).toBe(1);
    expect(store.findSymbolsByName('MyClass').length).toBe(1);
    expect(store.findSymbolsByNamePartial('Class').length).toBe(1);
    expect(store.getStats().symbols).toBe(1);
  });
});
