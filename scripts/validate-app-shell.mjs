import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const swPath = path.join(root, 'service-worker.js');
const indexPath = path.join(root, 'index.html');

function fail(message) {
  console.error(`App Shell validation failed: ${message}`);
  process.exitCode = 1;
}

function normalizeLocalRef(ref, baseDir = '') {
  if (!ref || ref === './' || /^(?:https?:|data:|blob:|#|\/\/)/i.test(ref)) return null;
  const clean = ref.split(/[?#]/, 1)[0];
  if (!clean.startsWith('.')) return clean.replace(/^\//, '');
  return path.posix.normalize(path.posix.join(baseDir, clean));
}

if (!existsSync(swPath)) fail('service-worker.js is missing');
if (!existsSync(indexPath)) fail('index.html is missing');

const swSource = readFileSync(swPath, 'utf8');
const shellMatch = swSource.match(/const\s+APP_SHELL\s*=\s*\[([\s\S]*?)\];/);
if (!shellMatch) {
  fail('APP_SHELL array was not found in service-worker.js');
  process.exit(1);
}

const shellRefs = [];
for (const match of shellMatch[1].matchAll(/(['"])(.*?)\1/g)) shellRefs.push(match[2]);

const duplicates = shellRefs.filter((ref, index) => shellRefs.indexOf(ref) !== index);
if (duplicates.length) fail(`duplicate APP_SHELL entries: ${[...new Set(duplicates)].join(', ')}`);

const shellFiles = new Set();
for (const ref of shellRefs) {
  const file = normalizeLocalRef(ref);
  if (!file) continue;
  shellFiles.add(file);
  if (!existsSync(path.join(root, file))) fail(`APP_SHELL file does not exist: ${ref}`);
}

const indexSource = readFileSync(indexPath, 'utf8');
const indexRefs = [];
for (const match of indexSource.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)=["']([^"']+)["'][^>]*>/gi)) {
  const file = normalizeLocalRef(match[1]);
  if (file) indexRefs.push(file);
}

for (const file of indexRefs) {
  if (!existsSync(path.join(root, file))) fail(`index.html references missing local file: ${file}`);
  if (!shellFiles.has(file)) fail(`index.html local asset is not in APP_SHELL: ${file}`);
}

for (const file of shellFiles) {
  if (!file.endsWith('.js') || !existsSync(path.join(root, file))) continue;
  const source = readFileSync(path.join(root, file), 'utf8');
  const refs = new Set();

  for (const match of source.matchAll(/(?:import\s+(?:[^'";]*?\s+from\s+)?|export\s+[^'";]*?\s+from\s+)["'](\.[^"']+)["']/g)) refs.add(match[1]);
  for (const match of source.matchAll(/import\(\s*["'](\.[^"']+)["']\s*\)/g)) refs.add(match[1]);

  for (const ref of refs) {
    const imported = normalizeLocalRef(ref, path.posix.dirname(file));
    if (!imported) continue;
    if (!existsSync(path.join(root, imported))) fail(`${file} imports missing module: ${ref}`);
    if (!shellFiles.has(imported)) fail(`${file} imports module not present in APP_SHELL: ${imported}`);
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`App Shell OK: ${shellFiles.size} local files, ${indexRefs.length} index references checked.`);
