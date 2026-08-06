/**
 * Kernel admission gate (re-homed from the retired monolith boundary gate).
 *
 * Provenance: aidcp-cloud@2d34e06 `test/acceptance/module-boundary.test.ts` (AC-BOUND-03 and
 * the "kernel 准入判据保真自检" block) plus the pieces of
 * `test/acceptance/helpers/boundary-scan.ts` it depended on. Both files retired with the
 * monolith import graph on 2026-08-06 (change `invert-split-fact-source`); until this file,
 * the admission checks had NO live executor. `KERNEL_ADMISSION_CHECKS`, `stripTsComments`,
 * `UPDATE_TABLE_PATTERN_SOURCE` and the import-specifier extraction patterns are ported
 * verbatim. What changed is only the roster: in the standalone repo EVERY file under `src/`
 * is a kernel member, so the roster JSON is gone and the gate walks `src/` directly.
 *
 * Trap semantics preserved on purpose — do not "fix" them:
 *   - `setTimeout(` / `setInterval(` / `new Pool(` are NOT line-anchored;
 *   - a type annotation does not save `const x: ReadonlySet<string> = new Set([...])`;
 *   - the checker strips comments but NOT string literals: an error message containing
 *     `LlmClient` or a quoted `https://` URL is a hit, by design;
 *   - `export * from` counts as an import edge.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

function repoPath(...parts: string[]): string {
  return path.join(REPO_ROOT, ...parts);
}

/** Recursively list `src/**\/*.ts` as repo-relative posix paths (ported walking logic). */
function listSourceFiles(root = 'src'): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(repoPath(dir)).sort()) {
      const rel = `${dir}/${name}`;
      if (statSync(repoPath(rel)).isDirectory()) walk(rel);
      else if (name.endsWith('.ts')) out.push(rel);
    }
  };
  walk(root);
  return out.sort();
}

/**
 * 剥 TypeScript 注释。行注释的 `//` 前紧邻 `:` 时不剥（避免把 `https://…` 之后的整行吃掉）。
 * (Ported verbatim from boundary-scan.ts. It strips comments but NOT string literals.)
 */
function stripTsComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

/**
 * `UPDATE <表> [[AS] <别名>] SET` 的语法源串（ported verbatim）。
 * 别名段 MUST 是可选的：`UPDATE delegated_tasks t SET …` 这类带别名形态曾被早期版本漏过。
 */
const UPDATE_TABLE_PATTERN_SOURCE = String.raw`(?<!\bDO\s{1,4})(?<!\bFOR\s{1,4})\bUPDATE\s+(?:ONLY\s+)?(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:AS\s+)?[a-zA-Z_][a-zA-Z0-9_]*)?\s+SET\b`;

/**
 * kernel 准入判据（ported verbatim from module-boundary.test.ts @ 2d34e06）。
 * **写在这里、不进 JSON**，改它必须走代码评审。
 *
 * 「模块级可变单例」一条 MUST 同时覆盖 `export let` / `export var`：导出型可变单例正是最容易被
 * 其它层写坏的那一种，早期版本只锚行首裸 `let` / `var`，`export let …` 直接漏过。
 * 模块级 `const x = new Map()` / `new Set()` 同属可变容器单例，一并锚定（`[^=\n]*` 不跨越 `=` 与换行，
 * 因此 `Map<string, string>` 这类类型标注不会误伤，函数体内的局部量因不在行首也不命中）。
 */
const KERNEL_ADMISSION_CHECKS: { name: string; re: RegExp }[] = [
  {
    name: 'SQL 字面量',
    re: new RegExp(`\\b(INSERT\\s+INTO|DELETE\\s+FROM|CREATE\\s+TABLE|SELECT\\s)|${UPDATE_TABLE_PATTERN_SOURCE}`, 'i'),
  },
  { name: 'HTTP 路由注册', re: /createServer\s*\(|\bres\.writeHead\s*\(|\breq\.url\b|\brouter\./ },
  { name: 'LLM 或供应商 HTTP 调用', re: /\bfetch\s*\(|\bLlmClient\b|\bChatLlmClient\b|['"`]https?:\/\// },
  {
    name: '进程内活状态（模块级可变单例 / 定时器 / 连接池）',
    re: /^(?:export\s+)?(?:let|var)\s|^(?:export\s+)?const\s[^=\n]*=\s*new\s+(?:Map|Set)\b|\bsetInterval\s*\(|\bsetTimeout\s*\(|new\s+Pool\s*\(/m,
  },
];

/* ------------------------------------------------------------------ import 抽取（ported verbatim） */

const SPECIFIER_PATTERNS: RegExp[] = [
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // 动态 import() 与内联 import('...').Type
  /\bfrom\s*['"]([^'"]+)['"]/g, // import ... from / export ... from
  /\bimport\s+['"]([^'"]+)['"]/g, // 纯副作用 import
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // 兜底：CommonJS 形态
];

function extractSpecifiers(source: string): string[] {
  const stripped = stripTsComments(source);
  const found = new Set<string>();
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(stripped)) !== null) found.add(m[1]);
  }
  return [...found].sort();
}

/**
 * 把相对说明符解析到实际源文件（仓根相对路径）。非相对说明符返回 `'external'`，
 * 解析不到返回 `null` —— 调用方 MUST 据此失败（ported verbatim; honesty red line）。
 */
function resolveSpecifier(fromFile: string, specifier: string): string | null | 'external' {
  if (!specifier.startsWith('.')) return 'external';
  const base = path.posix.join(path.posix.dirname(fromFile), specifier);
  const candidates = [
    base.replace(/\.js$/, '.ts'),
    `${base}.ts`,
    `${base}/index.ts`,
    `${base.replace(/\.js$/, '')}/index.ts`,
  ];
  for (const candidate of candidates) {
    if (candidate.endsWith('.ts') && existsSync(repoPath(candidate))) return candidate;
  }
  return null;
}

/** Escape a specifier for embedding in a RegExp. */
function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Count how many of the specifier's occurrences in (comment-stripped) source are
 * erased-at-compile type-only forms (`import type … from 'x'` / `export type … from 'x'`).
 * Dynamic `import()`, bare side-effect `import 'x'` and `require('x')` can never be
 * type-only, so they are counted as value occurrences by construction.
 */
function countOccurrences(stripped: string, specifier: string): { total: number; typeOnly: number } {
  const esc = escapeRe(specifier);
  let total = 0;
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(stripped)) !== null) if (m[1] === specifier) total += 1;
  }
  const typeOnlyRe = new RegExp(String.raw`\b(?:import|export)\s+type\s[^'"]*?\bfrom\s*['"]${esc}['"]`, 'g');
  const typeOnly = stripped.match(typeOnlyRe)?.length ?? 0;
  return { total, typeOnly };
}

const files = listSourceFiles();

describe('kernel admission gate (re-homed AC-BOUND-03)', () => {
  it('every src/ file passes the four ported admission checks', () => {
    // 逐条准入：无 SQL / 无 HTTP 路由 / 无 LLM 与供应商调用 / 无进程内活状态。
    // Ported evaluation: strip comments, then test each regex; collect ALL violations.
    const violations: string[] = [];
    for (const file of files) {
      const source = stripTsComments(readFileSync(repoPath(file), 'utf8'));
      for (const check of KERNEL_ADMISSION_CHECKS) {
        if (check.re.test(source)) violations.push(`${file}: 违反 kernel 准入条件「${check.name}」`);
      }
    }
    assert.deepEqual(violations, [], violations.join('\n'));
  });

  it('fifth rule: kernel MUST NOT import any business-layer module', () => {
    // Monolith form: no kernel -> api/content/automation/composition import edge (no
    // exemption channel). Standalone translation: every import specifier MUST be a `node:`
    // builtin or a relative path resolving INSIDE this repo's src/ — no path escapes, no
    // runtime package deps. Carve-out matching the original semantics: in the monolith
    // graph non-relative specifiers were 'external' and never violations, and the admitted
    // kernel files carried `import type pg from 'pg'` (pg is this package's declared
    // peerDependency; type-only imports are erased at compile, so no runtime edge exists).
    // That exact shape — type-only import of a declared peerDependency — stays legal;
    // any value import of any package is a violation.
    const pkg = JSON.parse(readFileSync(repoPath('package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    assert.deepEqual(
      pkg.dependencies ?? {},
      {},
      'aidcp-kernel MUST NOT declare runtime dependencies; the contract layer is pure',
    );
    const peerDeps = new Set(Object.keys(pkg.peerDependencies ?? {}));

    const violations: string[] = [];
    for (const file of files) {
      const raw = readFileSync(repoPath(file), 'utf8');
      const stripped = stripTsComments(raw);
      for (const specifier of extractSpecifiers(raw)) {
        if (specifier.startsWith('node:')) continue;
        const resolved = resolveSpecifier(file, specifier);
        if (resolved === 'external') {
          const packageName = specifier.startsWith('@')
            ? specifier.split('/').slice(0, 2).join('/')
            : specifier.split('/')[0];
          if (!peerDeps.has(packageName)) {
            violations.push(`${file}: imports package '${specifier}' which is not a declared peerDependency`);
            continue;
          }
          const { total, typeOnly } = countOccurrences(stripped, specifier);
          if (total !== typeOnly) {
            violations.push(
              `${file}: value-imports package '${specifier}' (only \`import type\` of a declared peerDependency is allowed)`,
            );
          }
          continue;
        }
        if (resolved === null) {
          // 诚实闸：解析不到实文件的相对说明符 MUST 失败，MUST NOT 当作这条边不存在。
          violations.push(`${file}: relative import '${specifier}' does not resolve to a source file`);
          continue;
        }
        if (!resolved.startsWith('src/')) {
          violations.push(`${file}: import '${specifier}' resolves to '${resolved}', outside this repo's src/`);
        }
      }
    }
    assert.deepEqual(violations, [], violations.join('\n'));
  });
});

/**
 * 判据保真自检（ported verbatim from module-boundary.test.ts @ 2d34e06）。
 * 存在理由：门禁自身漏检时会静默报「无违规」，属红线「MUST NOT 静默假成功」；
 * 这里对已经踩过的漏检形态各留一条机械断言，防止判据被改回去。
 */
describe('kernel 准入判据保真自检（非 AC 编号）', () => {
  const mutableSingleton = KERNEL_ADMISSION_CHECKS.find((c) => c.name.startsWith('进程内活状态'))!;
  const sqlLiteral = KERNEL_ADMISSION_CHECKS.find((c) => c.name === 'SQL 字面量')!;

  it('模块级可变单例：export 形态与裸形态都 MUST 命中', () => {
    for (const source of [
      'export let cachedPool: Pool | null = null;\n',
      'export var counter = 0;\n',
      'let cachedPool = null;\n',
      'var counter = 0;\n',
      'export const registry = new Map<string, string>();\n',
      'const seen = new Set<string>();\n',
    ]) {
      assert.ok(mutableSingleton.re.test(source), `模块级可变单例 MUST 被判违规，实际漏过：${source.trim()}`);
    }
  });

  it('模块级可变单例：不可变导出与函数内局部量 MUST NOT 误判', () => {
    for (const source of [
      'export const DEFAULT_PG_CONFIG = { host: "127.0.0.1" } as const;\n',
      'export function build(): void {\n  const seen = new Map<string, string>();\n  void seen;\n}\n',
    ]) {
      assert.equal(mutableSingleton.re.test(source), false, `不构成模块级可变单例，MUST NOT 判违规：${source.trim()}`);
    }
  });

  it('SQL 字面量：带别名的 UPDATE MUST 命中', () => {
    assert.ok(sqlLiteral.re.test('const q = `UPDATE risk_state r SET status=$1`;'));
    assert.ok(sqlLiteral.re.test('const q = `UPDATE risk_state AS r SET status=$1`;'));
  });

  it('timers/pools MUST 命中（非行锚定，ported trap semantics）', () => {
    for (const source of [
      'export function schedule(): void {\n  const t = setTimeout(() => {}, 100);\n  void t;\n}\n',
      'export function tick(): void {\n  setInterval(() => {}, 100);\n}\n',
      'export function build(): void {\n  const pool = new Pool({});\n  void pool;\n}\n',
    ]) {
      assert.ok(mutableSingleton.re.test(source), `定时器 / 连接池 MUST 被判违规，实际漏过：${source.trim()}`);
    }
  });

  it('fifth rule fixtures: escapes and value package imports MUST 命中，type-only peer dep MUST NOT', () => {
    // A relative escape out of src/ resolves to a real file OUTSIDE src/ — the violation path
    // the original called「最该报警的越界形态」(it must not be treated as external/absent).
    assert.equal(resolveSpecifier('src/kernel/x.ts', '../../test/admission.test.js'), 'test/admission.test.ts');
    // An unresolvable relative specifier returns null — the honesty-failure path, never 'external'.
    assert.equal(resolveSpecifier('src/kernel/x.ts', './zz-no-such-module.js'), null);
    // Type-only counting: value import of pg would be flagged, `import type` is not.
    const typeOnly = countOccurrences(stripTsComments("import type pg from 'pg';\n"), 'pg');
    assert.deepEqual(typeOnly, { total: 1, typeOnly: 1 });
    const valueImport = countOccurrences(stripTsComments("import pg from 'pg';\n"), 'pg');
    assert.deepEqual(valueImport, { total: 1, typeOnly: 0 });
    const dynamic = countOccurrences(stripTsComments("const pg = await import('pg');\n"), 'pg');
    assert.deepEqual(dynamic, { total: 1, typeOnly: 0 });
  });
});
