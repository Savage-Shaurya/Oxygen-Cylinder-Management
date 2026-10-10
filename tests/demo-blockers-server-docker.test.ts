// LS-01: the Docker build context and image must never carry secrets or local junk.
// Docker is not needed: this applies .dockerignore with Docker's own matching rules
// (Go filepath.Match per path segment, "**" for any depth, "!" exceptions, last match wins,
// and a match on a parent directory excludes everything under it) to sentinel files in a
// disposable folder, then to the real checkout by file name only (contents are never read).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

type Rule = { negate: boolean; regex: RegExp };
function parseIgnore(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const negate = line.startsWith('!');
    if (negate) line = line.slice(1).trim();
    line = line.replace(/^\.?\/+/, '').replace(/\/+$/, '');
    let source = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '*' && line[i + 1] === '*') {
        // "**/" matches zero or more directories; a trailing "**" matches anything.
        if (line[i + 2] === '/') {
          source += '(?:.*/)?';
          i += 2;
        } else {
          source += '.*';
          i += 1;
        }
      } else if (c === '*') source += '[^/]*';
      else if (c === '?') source += '[^/]';
      else if (c === '[') {
        const close = line.indexOf(']', i);
        source += line.slice(i, close + 1).replace('[!', '[^');
        i = close;
      } else source += c.replace(/[.+^${}()|\\]/g, '\\$&');
    }
    rules.push({ negate, regex: new RegExp(`^${source}$`) });
  }
  return rules;
}
function excluded(rules: Rule[], path: string): boolean {
  const parts = path.split('/');
  let result = false;
  for (const rule of rules) {
    let match = false;
    for (let n = 1; n <= parts.length && !match; n++)
      match = rule.regex.test(parts.slice(0, n).join('/'));
    if (match) result = !rule.negate;
  }
  return result;
}
/** Every file Docker would send as build context. */
function contextFiles(root: string, rules: Rule[], dir = ''): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      // Huge folders that are excluded whole (node_modules, .git) need not be walked.
      if (excluded(rules, path) && !rules.some((r) => r.negate && r.regex.source.includes(path)))
        continue;
      files.push(...contextFiles(root, rules, path));
    } else if (!excluded(rules, path)) files.push(path);
  }
  return files;
}

const dockerignore = readFileSync('.dockerignore', 'utf8');
const dockerfile = readFileSync('Dockerfile', 'utf8');

const SECRET_OR_JUNK = [
  'keys.txt',
  'secret.key',
  'server/nested/deploy.key',
  'shared/keys.txt',
  'id_rsa.pem',
  '.env',
  '.env.local',
  '.env.production',
  'server/.env',
  '_resources/reference/notes.md',
  'data/ctms.sqlite',
  'data/ctms.sqlite-wal',
  'server/stray.sqlite',
  'dist/index.html',
  'node_modules/pkg/index.js',
  '.git/config',
  'tests/.app-test-123/bundle.mjs',
  'tests/api.test.ts',
  'test-results/out.json',
  'npm-debug.log',
  'Plan.md',
  'Findings.md',
  'docs/design.md',
  'scripts/voice-clips.ts',
  'api/index.mjs',
  '.claude/settings.json',
  'CLAUDE.local.md',
];
const NEEDED = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'index.html',
  'src/main.tsx',
  'shared/types.ts',
  'server/index.ts',
  'public/favicon.svg',
  'public/voice/manifest.json',
];

test('the matcher follows Docker rules for root-only, any-depth and exception patterns', () => {
  const rules = parseIgnore('*.key\n**/*.pem\ndata\n!data/keep.txt\n');
  assert.equal(excluded(rules, 'a.key'), true);
  assert.equal(excluded(rules, 'deep/a.key'), false, 'Docker "*.key" is root-only');
  assert.equal(excluded(rules, 'deep/x/a.pem'), true);
  assert.equal(excluded(rules, 'data/db.sqlite'), true);
  assert.equal(excluded(rules, 'data/keep.txt'), false);
});

test('sentinel secrets and local junk never enter the Docker build context', () => {
  const root = mkdtempSync(join(tmpdir(), 'cylvero-docker-context-'));
  try {
    for (const file of [...SECRET_OR_JUNK, ...NEEDED]) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), 'harmless sentinel, not a secret');
    }
    writeFileSync(join(root, '.dockerignore'), dockerignore);
    writeFileSync(join(root, 'Dockerfile'), dockerfile);
    const sent = new Set(contextFiles(root, parseIgnore(dockerignore)));
    for (const file of SECRET_OR_JUNK) assert.equal(sent.has(file), false, `${file} is excluded`);
    for (const file of NEEDED) assert.equal(sent.has(file), true, `${file} is available`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the real checkout context holds only build inputs (checked by name only)', () => {
  const sent = contextFiles(process.cwd(), parseIgnore(dockerignore));
  const allowed =
    /^(package\.json|package-lock\.json|tsconfig\.json|vite\.config\.ts|index\.html|Dockerfile|\.dockerignore|(src|shared|server|public)\/.+)$/;
  assert.deepEqual(
    sent.filter((file) => !allowed.test(file)),
    [],
  );
  assert.equal(
    sent.some((file) => /(^|\/)(keys\.txt|[^/]*\.key|\.env[^/]*|[^/]*\.sqlite[^/]*)$/.test(file)),
    false,
  );
  assert.ok(sent.includes('server/index.ts'));
});

test('the Dockerfile copies only an allowlist and never the whole context', () => {
  const copies = dockerfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^COPY\s/i.test(line));
  assert.ok(copies.length > 0);
  for (const line of copies) {
    const args = line
      .replace(/^COPY\s+/i, '')
      .split(/\s+/)
      .filter((arg) => !arg.startsWith('--'));
    const sources = args.slice(0, -1);
    assert.equal(sources.includes('.'), false, `whole-context copy: ${line}`);
    assert.equal(sources.includes('/app'), false, `whole build-tree copy: ${line}`);
    assert.equal(
      sources.some((s) => /keys|\.key$|\.env|_resources|^data|tests|scripts/.test(s)),
      false,
      line,
    );
  }
  // The final image runs as the unprivileged node user, and only the data folder is writable.
  const final = dockerfile.slice(dockerfile.lastIndexOf('FROM '));
  assert.match(final, /^USER node$/m);
  assert.doesNotMatch(final, /--chown=node:node \/app\/(server|shared|dist|node_modules)/);
});
