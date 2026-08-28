/**
 * PythonAstParser — extracts symbols from Python files by invoking
 * the Python interpreter's `ast` module as a subprocess.
 *
 * Falls back gracefully to [] if Python is unavailable.
 */

import { spawn } from 'node:child_process';
import type { SymbolRecord, Language } from '../types/index.js';

const PYTHON_SCRIPT = `
import ast, json, sys

src = sys.stdin.read()
try:
    tree = ast.parse(src)
except SyntaxError as e:
    print(json.dumps([]))
    sys.exit(0)

symbols = []

def get_decorator_names(node):
    names = []
    for d in getattr(node, 'decorator_list', []):
        if isinstance(d, ast.Name):
            names.append(d.id)
        elif isinstance(d, ast.Attribute):
            names.append(d.attr)
        elif isinstance(d, ast.Call):
            if isinstance(d.func, ast.Name):
                names.append(d.func.id)
            elif isinstance(d.func, ast.Attribute):
                names.append(d.func.attr)
    return names

def get_docstring(node):
    try:
        return ast.get_docstring(node) or ''
    except Exception:
        return ''

def get_args(node):
    if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        return ''
    args = [a.arg for a in node.args.args]
    return '(' + ', '.join(args) + ')'

for node in ast.walk(tree):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        parent = ''
        symbols.append({
            'name': node.name,
            'kind': 'function',
            'startLine': node.lineno,
            'endLine': getattr(node, 'end_lineno', node.lineno),
            'exported': not node.name.startswith('_'),
            'signature': ('async ' if isinstance(node, ast.AsyncFunctionDef) else '') + 'def ' + node.name + get_args(node),
            'docstring': get_docstring(node),
            'decorators': get_decorator_names(node),
            'parentSymbol': '',
        })
    elif isinstance(node, ast.ClassDef):
        symbols.append({
            'name': node.name,
            'kind': 'class',
            'startLine': node.lineno,
            'endLine': getattr(node, 'end_lineno', node.lineno),
            'exported': not node.name.startswith('_'),
            'signature': 'class ' + node.name,
            'docstring': get_docstring(node),
            'decorators': get_decorator_names(node),
            'parentSymbol': '',
        })

# Deduplicate by name+kind+startLine
seen = set()
unique = []
for s in symbols:
    key = (s['name'], s['kind'], s['startLine'])
    if key not in seen:
        seen.add(key)
        unique.append(s)

print(json.dumps(unique))
`;

interface RawPythonSymbol {
  name: string;
  kind: 'function' | 'class';
  startLine: number;
  endLine: number;
  exported: boolean;
  signature: string;
  docstring: string;
  decorators: string[];
  parentSymbol: string;
}

export class PythonAstParser {
  private pythonAvailable: boolean | null = null;

  async parseFile(filePath: string, content: string): Promise<SymbolRecord[]> {
    if (this.pythonAvailable === false) return [];

    try {
      const stdout = await this.runPython(content);
      this.pythonAvailable = true;
      const raw: RawPythonSymbol[] = JSON.parse(stdout.trim() || '[]') as RawPythonSymbol[];
      return raw.map((s) => this.toSymbolRecord(s, filePath));
    } catch {
      if (this.pythonAvailable === null) {
        this.pythonAvailable = false;
        process.stderr.write('[PythonAstParser] Python not available — skipping Python AST extraction\n');
      }
      return [];
    }
  }

  private runPython(input: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('python', ['-c', PYTHON_SCRIPT], { stdio: 'pipe' });
      let stdout = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill();
        reject(new Error('Python AST parser timed out'));
      }, 5000);

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) return;
        if (code === 0 || stdout.trim()) {
          resolve(stdout);
        } else {
          reject(new Error(`Python exited with code ${code}`));
        }
      });
      proc.on('error', reject);

      proc.stdin.write(input, 'utf8');
      proc.stdin.end();
    });
  }

  private toSymbolRecord(s: RawPythonSymbol, filePath: string): SymbolRecord {
    const language: Language = 'python';
    return {
      symbolId: `${filePath}:${s.name}:${s.kind}`,
      name: s.name,
      kind: s.kind,
      file: filePath,
      startLine: s.startLine,
      endLine: s.endLine,
      language,
      exported: s.exported,
      parentSymbol: s.parentSymbol || undefined,
      signature: s.signature,
      docstring: s.docstring || undefined,
    };
  }
}
