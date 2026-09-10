import assert from 'node:assert/strict';

const base = (process.env.WORKER_BASE_URL || 'https://radar.max-yu.workers.dev').replace(/\/$/, '');
const target = { name:'Kowloon Bay reported device point', lat:22.3260, lon:114.2185 };
const FRAME_COUNT = 16;
const REQUEST_TIMEOUT_MS = 25_000;
const startedAt = Date.now();

function fetchFrame(frameIndex) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('production compact point timeout'), REQUEST_TIMEOUT_MS);
  const url = `${base}/api/rain/swirls/point?frame=${frameIndex}&lat=${target.lat}&lon=${target.lon}`;
  return fetch(url, {
    headers:{ Accept:'application/json', Origin:'https://maxyu725.github.io' },
    cache:'no-store',
    signal:controller.signal
  }).then(async response => {
    assert.equal(response.status, 200, `frame ${frameIndex} HTTP ${response.status}`);
    assert.equal(response.headers.get('access-control-allow-origin'), '*', `frame ${frameIndex} must remain browser-readable`);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(data.frameIndex, frameIndex);
    assert.equal(data.cadenceMinutes, 6);
    assert.equal(data.accumulationMinutes, 30);
    assert.equal(data.unit, 'mm / 30 min');
    assert.ok(Number.isFinite(data.amountMm) && data.amountMm >= 0, `frame ${frameIndex} rainfall must be usable`);
    return { frameIndex, data, elapsedMs:Date.now() - startedAt };
  }).finally(() => clearTimeout(timer));
}

const requests = Array.from({ length:FRAME_COUNT }, (_, frameIndex) => fetchFrame(frameIndex));
const first = await Promise.any(requests);
console.log(`${target.name} progressive first usable frame=${first.frameIndex} in ${first.elapsedMs} ms`);

const settled = await Promise.allSettled(requests);
const successes = settled
  .filter(result => result.status === 'fulfilled')
  .map(result => result.value)
  .sort((a, b) => a.frameIndex - b.frameIndex);
const failures = settled.flatMap((result, frameIndex) => result.status === 'rejected'
  ? [{ frameIndex, error:String(result.reason?.message || result.reason) }]
  : []);

assert.ok(successes.length > 0, 'progressive Rain Home path needs at least one usable frame');
const runTimes = new Set(successes.map(item => item.data.runTime));
assert.equal(runTimes.size, 1, 'successful progressive frames must stay on one SWIRLS run');
console.log(`${target.name} progressive production probe: ${successes.length}/16 frames; first=${first.elapsedMs} ms; total=${Date.now() - startedAt} ms; failures=${JSON.stringify(failures)}`);
