import assert from 'node:assert/strict';

const base = (process.env.WORKER_BASE_URL || 'https://radar.max-yu.workers.dev').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = 25_000;
const targets = [
  { name:'HKO', lat:22.3023, lon:114.1746 },
  { name:'Kowloon Bay reported device point', lat:22.3258, lon:114.2186 },
  { name:'Fanling reported device point', lat:22.4987, lon:114.1458 }
];

for (const target of targets) {
  const url = `${base}/api/rain/swirls/point-series?lat=${target.lat}&lon=${target.lon}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('production point-series timeout'), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();

  let response;
  try {
    response = await fetch(url, {
      headers:{
        Accept:'application/json',
        Origin:'https://maxyu725.github.io'
      },
      cache:'no-store',
      signal:controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  assert.equal(response.status, 200, `${target.name} point-series HTTP ${response.status}`);
  assert.equal(response.headers.get('access-control-allow-origin'), '*', `${target.name} point-series must remain browser-readable`);
  const data = await response.json();
  const elapsedMs = Date.now() - startedAt;
  console.log(`${target.name} SWIRLS point-series production response: ${data.points?.length || 0}/16 points in ${elapsedMs} ms; missing=${JSON.stringify(data.missingFrames || [])}; run=${data.runTime || 'unknown'}`);
  assert.equal(data.ok, true);
  assert.equal(data.cadenceMinutes, 6);
  assert.equal(data.accumulationMinutes, 30);
  assert.equal(data.unit, 'mm / 30 min');
  assert.ok(Array.isArray(data.points) && data.points.length > 0, `${target.name} point-series needs at least one usable point`);

  const seen = new Set();
  for (const point of data.points) {
    assert.ok(Number.isInteger(point.frameIndex) && point.frameIndex >= 0 && point.frameIndex < 16, `${target.name} frame index must be 0..15`);
    assert.equal(seen.has(point.frameIndex), false, `${target.name} frame indexes must be unique`);
    seen.add(point.frameIndex);
    assert.equal(point.leadMinutes, 30 + point.frameIndex * 6, `${target.name} lead time must match frame index`);
    assert.ok(Number.isFinite(point.amountMm) && point.amountMm >= 0, `${target.name} rainfall must be usable`);
    assert.ok(Number.isFinite(Date.parse(point.validTime || '')), `${target.name} valid time must parse`);
  }

  const expectedMissing = Array.from({ length:16 }, (_, frameIndex) => frameIndex).filter(frameIndex => !seen.has(frameIndex));
  assert.deepEqual(data.missingFrames, expectedMissing, `${target.name} missingFrames must describe the partial series`);
  assert.equal(data.complete, expectedMissing.length === 0, `${target.name} complete flag must match returned points`);
  console.log(`${target.name} SWIRLS point-series production probe PASS: ${data.points.length} usable points${data.complete ? ' (complete)' : ' (partial accepted)'}`);
}
