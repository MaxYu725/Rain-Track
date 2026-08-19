import assert from 'node:assert/strict';

const base = (process.env.WORKER_BASE_URL || 'https://radar.max-yu.workers.dev').replace(/\/$/, '');
const url = `${base}/api/rain/swirls/point-series?lat=22.3023&lon=114.1746`;
const response = await fetch(url, { headers:{ Accept:'application/json' }, cache:'no-store' });
assert.equal(response.status, 200, `point-series HTTP ${response.status}`);
const data = await response.json();
assert.equal(data.ok, true);
assert.equal(data.cadenceMinutes, 6);
assert.equal(data.accumulationMinutes, 30);
assert.equal(data.unit, 'mm / 30 min');
assert.equal(data.points?.length, 16);
assert.equal(data.points[0]?.leadMinutes, 30);
assert.equal(data.points.at(-1)?.leadMinutes, 120);
assert.ok(data.points.every((point, index) => point.frameIndex === index && Number.isFinite(point.amountMm) && point.amountMm >= 0));
console.log(`SWIRLS point-series production probe PASS: ${data.points.length} points, ${data.points[0].validTime} -> ${data.points.at(-1).validTime}`);
