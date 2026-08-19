import assert from 'node:assert/strict';

const BASE = (process.env.WORKER_BASE_URL || 'https://radar.max-yu.workers.dev').replace(/\/$/, '');
const TIMEOUT_MS = 10_000;

async function get(path, allowed = [200]) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(`${BASE}${path}`, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Rain-Track-snapshot-verification/1.0' },
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - started;
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    assert.ok(allowed.includes(response.status), `${path} returned ${response.status}: ${text.slice(0, 300)}`);
    return { response, data, elapsedMs };
  } finally {
    clearTimeout(timer);
  }
}

const point = await get('/api/rain/point?lat=22.3023&lon=114.1746&radiusKm=2');
assert.equal(point.data?.ok, true, 'legacy point forecast must remain healthy');
assert.ok(point.elapsedMs < 5_000, `legacy point forecast too slow: ${point.elapsedMs}ms`);
console.log(`PASS fast point ${point.elapsedMs}ms`);

let probe = await get('/probe/swirls-snapshot', [200, 503]);
assert.equal(probe.data?.version, '2.7.0', 'snapshot Worker entry is not deployed');
assert.equal(probe.data?.bindingReady, true, 'SWIRLS_SNAPSHOTS KV binding is not active');
assert.ok(probe.elapsedMs < 5_000, `snapshot probe blocked on upstream work: ${probe.elapsedMs}ms`);
console.log(`Snapshot initial status=${probe.response.status} state=${probe.data?.refresh?.state || 'none'}`);

const series = await get('/api/rain/swirls/point-series?lat=22.3023&lon=114.1746', [200, 503]);
assert.equal(series.data?.version, '2.7.0', 'point-series Worker entry version mismatch');
assert.ok(series.elapsedMs < 5_000, `point-series request blocked on live frames: ${series.elapsedMs}ms`);
if (series.response.status === 503) {
  assert.equal(series.data?.fallbackEndpoint, '/api/rain/point', 'snapshot miss must advertise fast fallback');
  console.log(`PASS non-blocking snapshot fallback ${series.elapsedMs}ms`);
} else {
  assert.equal(series.data?.ok, true, 'ready point series must be ok');
  assert.equal(series.data?.sampleCount, 16, 'ready point series must have 16 samples');
  assert.equal(series.data?.snapshot?.fresh, true, 'served snapshot must be fresh');
  console.log(`PASS ready snapshot series age=${series.data.snapshot.ageMinutes}m ${series.elapsedMs}ms`);
}

if (probe.response.status !== 200) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 15_000));
    probe = await get('/probe/swirls-snapshot', [200, 503]);
    console.log(`Snapshot poll ${attempt}: status=${probe.response.status} state=${probe.data?.refresh?.state || 'none'} error=${probe.data?.refresh?.error || ''}`);
    if (probe.response.status === 200) break;
  }
}

if (probe.response.status === 200) {
  assert.equal(probe.data?.snapshot?.frameCount, 16, 'ready snapshot must have 16 frames');
  assert.equal(probe.data?.snapshot?.fresh, true, 'ready snapshot must be fresh');
  console.log(`PASS production snapshot ready age=${probe.data.snapshot.ageMinutes}m`);
} else {
  console.log('Snapshot is not ready yet, but production fallback/binding path is healthy; Cron may retry later.');
}
