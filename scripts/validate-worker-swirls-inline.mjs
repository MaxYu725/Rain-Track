import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync('worker.js', 'utf8');
const sourceData = readFileSync('swirls-data.js', 'utf8');
const sourceRuntime = readFileSync('swirls-worker-runtime.js', 'utf8');

const START = '/* RAIN_TRACK_SWIRLS_INLINE_BEGIN';
const END = '/* RAIN_TRACK_SWIRLS_INLINE_END */';

function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function inlineDataSource(text) {
  return text
    .replace(/^export /gm, '')
    .replace(/\bcoordKey\b/g, 'swirlsCoordKey')
    .replace(/\bsubtractMinutesIso\b/g, 'swirlsSubtractMinutesIso')
    .trim();
}

function inlineRuntimeSource(text) {
  return text
    .replace(/^import \{[\s\S]*?\} from '\.\/swirls-data\.js';\r?\n\r?\n/, '')
    .replace(/^export /gm, '')
    .trim();
}

assert.equal(occurrences(worker, START), 1, 'worker must contain exactly one SWIRLS inline start marker');
assert.equal(occurrences(worker, END), 1, 'worker must contain exactly one SWIRLS inline end marker');
assert.match(worker, /const VERSION = '2\.5\.0';/);
assert.doesNotMatch(worker, /^\s*import\s/m, 'worker.js must remain directly deployable without imports');

const start = worker.indexOf(START);
const end = worker.indexOf(END, start);
assert.ok(start >= 0 && end > start, 'SWIRLS inline block is malformed');
const inline = worker.slice(start, end);

const expectedData = inlineDataSource(sourceData);
const expectedRuntime = inlineRuntimeSource(sourceRuntime);
assert.ok(inline.includes(expectedData), 'inline SWIRLS parser/contract drifted from swirls-data.js');
assert.ok(inline.includes(expectedRuntime), 'inline SWIRLS runtime drifted from swirls-worker-runtime.js');

assert.ok(worker.includes("if (url.pathname === '/probe/swirls') return await handleSwirlsProbe();"));
assert.ok(worker.includes("if (url.pathname === '/api/rain/swirls/frame') return await handleSwirlsFrame(url);"));
assert.ok(worker.includes("frameEndpoint: '/api/rain/swirls/frame?frame=0..15'"));
assert.ok(worker.includes('const SWIRLS_RUNTIME = createSwirlsRuntime({'));
assert.ok(worker.includes('const cache = caches.default;'));
assert.ok(worker.includes('{ cacheEverything: true, cacheTtl: ttlSeconds }'));
assert.ok(worker.includes('{ cacheEverything: false, cacheTtl: 0 }'));
assert.ok(worker.includes('includeLastFrame: true'));
assert.ok(worker.includes('values: frame.values'));
assert.ok(worker.includes("error: 'SWIRLS frame must be an integer from 0 to 15'"));
assert.ok(worker.includes("}, 200, { 'Cache-Control': 'no-store' });"), 'probe must remain no-store');
assert.ok(worker.includes("'Cache-Control': 'public, max-age=' + SWIRLS_FETCH_POLICY.mdlTtlSeconds"));
assert.ok(!worker.includes('.tmp-worker-payload-'), 'worker must never depend on temporary payload artifacts');
assert.ok(!worker.includes('apply-phase3b2-worker'), 'worker must never depend on temporary rewrite tooling');

console.log('SWIRLS inline Worker parity gate PASS');
