import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { build } from 'esbuild';
import { ROOT_DIR } from './paths.js';

export type SafetyViolation = { line: number; message: string };

const BANNED_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /\bfetch\s*\(/, message: 'network calls are not allowed' },
  { pattern: /XMLHttpRequest|new\s+WebSocket/, message: 'network clients are not allowed' },
  { pattern: /\beval\s*\(|new\s+Function\s*\(/, message: 'dynamic code execution is not allowed' },
  { pattern: /document\.write|\.innerHTML\s*=/, message: 'unsafe HTML writes are not allowed' },
  { pattern: /\bimport\s*\(/, message: 'dynamic imports are not allowed' },
  { pattern: /\brequire\s*\(/, message: 'CommonJS and Node.js modules are not allowed in browser models' },
  { pattern: /\bprocess\.(?:env|argv|cwd|exit|platform|versions)\b/, message: 'Node.js process APIs are not allowed in browser models' },
  { pattern: /\bBuffer\.(?:alloc|allocUnsafe|from|isBuffer)\b|\b__dirname\b|\b__filename\b/, message: 'Node.js globals are not allowed in browser models' },
  { pattern: /https?:\/\//, message: 'external URL literals are not allowed' },
  { pattern: /\.\.\/\.\.\//, message: 'imports may not traverse outside the generated workspace' },
];

const IMPORT_PATTERN = /(?:import|export)\s+(?:[^'\"]*?\s+from\s+)?['\"]([^'\"]+)['\"]/g;
const LOCAL_ASSET_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function stripComments(source: string): string {
  let result = '';
  let index = 0;
  let quote: '"' | "'" | '`' | undefined;
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (quote) {
      result += character;
      if (character === '\\') {
        result += next ?? '';
        index += 2;
        continue;
      }
      if (character === quote) quote = undefined;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      result += character;
      index += 1;
      continue;
    }
    if (character === '/' && next === '/') {
      result += '  ';
      index += 2;
      while (index < source.length && source[index] !== '\n') {
        result += ' ';
        index += 1;
      }
      continue;
    }
    if (character === '/' && next === '*') {
      result += '  ';
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        result += source[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      if (index < source.length) {
        result += '  ';
        index += 2;
      }
      continue;
    }
    result += character;
    index += 1;
  }
  return result;
}

export function scanGeneratedSource(source: string): SafetyViolation[] {
  const violations: SafetyViolation[] = [];
  const lines = stripComments(source).split('\n');
  lines.forEach((line, index) => {
    for (const rule of BANNED_PATTERNS) {
      if (rule.pattern.test(line)) violations.push({ line: index + 1, message: rule.message });
    }
  });

  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? '';
    if (specifier.startsWith('node:')) {
      const line = source.slice(0, match.index).split('\n').length;
      violations.push({ line, message: 'Node.js modules are not allowed in browser models' });
    } else if (specifier !== 'three' && !specifier.startsWith('./') && !specifier.startsWith('../assets/')) {
      const line = source.slice(0, match.index).split('\n').length;
      violations.push({ line, message: `import ${JSON.stringify(specifier)} is not allowed` });
    } else if (specifier === 'three' && !/import\s+\*\s+as\s+THREE\s+from/.test(match[0])) {
      const line = source.slice(0, match.index).split('\n').length;
      violations.push({ line, message: 'the Three.js runtime must use: import * as THREE from \'three\'' });
    }
  }
  return violations;
}

export async function validateAndBundleModel(entryPath: string, outputPath: string): Promise<void> {
  const source = await readFile(entryPath, 'utf8');
  const violations = scanGeneratedSource(source);
  if (!/export\s+(?:default\s+)?function\s+create|export\s+const\s+create/.test(source)) {
    violations.push({ line: 1, message: 'model must export a factory whose name begins with create' });
  }
  if (violations.length) {
    throw new Error(`Generated model failed the safety scan:\n${violations.map((item) => `line ${item.line}: ${item.message}`).join('\n')}`);
  }

  const workspace = dirname(dirname(entryPath));
  const resolvedEntry = resolve(entryPath);
  if (!resolvedEntry.startsWith(`${workspace}${sep}`)) throw new Error('Generated model entry escaped its run workspace.');
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? '';
    if (!specifier.startsWith('../assets/')) continue;
    const assetPath = resolve(dirname(entryPath), specifier);
    const assetsRoot = resolve(workspace, 'assets');
    if (!assetPath.startsWith(`${assetsRoot}${sep}`) || !LOCAL_ASSET_EXTENSIONS.has(extname(assetPath).toLowerCase())) {
      throw new Error(`Generated model referenced a disallowed local asset: ${specifier}`);
    }
    const asset = await stat(assetPath).catch(() => undefined);
    if (!asset?.isFile()) throw new Error(`Generated model referenced a missing local asset: ${specifier}`);
    if (asset.size > 5 * 1024 * 1024) throw new Error(`Generated model asset exceeds 5 MB: ${specifier}`);
  }
  const runtimeSource = source.replace(
    /import\s+\*\s+as\s+THREE\s+from\s+['\"]three['\"];?/,
    'const THREE = globalThis.__IMG3D_THREE__;',
  );
  if (runtimeSource === source) throw new Error('Generated model did not declare the supported Three.js namespace import.');

  await build({
    stdin: {
      contents: runtimeSource,
      resolveDir: dirname(entryPath),
      sourcefile: entryPath,
      loader: 'ts',
    },
    outfile: outputPath,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: ['es2022'],
    sourcemap: false,
    logLevel: 'silent',
    legalComments: 'none',
    loader: {
      '.png': 'dataurl',
      '.jpg': 'dataurl',
      '.jpeg': 'dataurl',
      '.webp': 'dataurl',
    },
    nodePaths: [resolve(ROOT_DIR, 'node_modules')],
  });
}
