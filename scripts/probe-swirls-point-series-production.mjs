import assert from 'node:assert/strict';

const base = (process.env.WORKER_BASE_URL || 'https://radar.max-yu.workers.dev').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = 25_000;
const targets = [
  { name:'HKO', lat:22.3023, lon:114.1746 },
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
  assert.equal(data.points?.length, 16);
  assert.equal(data.points[0]?.leadMinutes, 30);
  assert.equal(data.points.at(-1)?.leadMinutes, 120);
  assert.ok(data.points.every((point, index) => point.frameIndex === index && Number.isFinite(point.amountMm) && point.amountMm >= 0));
  console.log(`${target.name} SWIRLS point-series production probe PASS: ${data.points.length} points, ${data.points[0].validTime} -> ${data.points.at(-1).validTime}`);
}