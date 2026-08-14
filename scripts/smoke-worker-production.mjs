import assert from 'node:assert/strict';

const BASE = (process.env.WORKER_BASE_URL || 'https://radar.max-yu.workers.dev').replace(/\/$/, '');
const EXPECTED_VERSION = process.env.EXPECTED_WORKER_VERSION || '2.5.0';
const REQUEST_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 30_000);

async function request(path, { expectJson = true } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}${path}`, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Rain-Track-production-smoke/1.0' },
      signal: controller.signal
    });
    assert.ok(response.ok, `${path} returned HTTP ${response.status}`);
    if (!expectJson) return response;
    const data = await response.json();
    return { response, data };
  } finally {
    clearTimeout(timer);
  }
}

function assertWorkerVersion(data, label) {
  assert.equal(data.version, EXPECTED_VERSION, `${label} Worker version mismatch`);
}

async function smokeHealth() {
  const { data } = await request('/health');
  assert.equal(data.ok, true, '/health must be ok');
  assertWorkerVersion(data, '/health');
  assert.equal(data.capabilities?.swirlsFrames, true, '/health must advertise SWIRLS frames');
  assert.equal(data.capabilities?.radarFrames, true, '/health must advertise radar frames');
  console.log(`PASS health v${data.version}`);
}

async function smokeCapabilities() {
  const { data } = await request('/api/capabilities');
  assert.equal(data.ok, true, '/api/capabilities must be ok');
  assertWorkerVersion(data, '/api/capabilities');
  assert.equal(data.capabilities?.swirlsFrames, true, 'SWIRLS capability missing');
  assert.equal(data.swirlsContract?.frameCount, 16, 'SWIRLS frame count contract mismatch');
  assert.equal(data.swirlsContract?.cadenceMinutes, 6, 'SWIRLS cadence contract mismatch');
  assert.equal(data.swirlsContract?.accumulationMinutes, 30, 'SWIRLS accumulation contract mismatch');
  console.log('PASS capabilities');
}

async function smokeSwirlsProbe() {
  const { data } = await request('/probe/swirls');
  assert.equal(data.ok, true, '/probe/swirls must be ok');
  assertWorkerVersion(data, '/probe/swirls');
  assert.equal(data.frameCount, 16, 'SWIRLS probe frame count mismatch');
  assert.equal(data.cadenceMinutes, 6, 'SWIRLS probe cadence mismatch');
  assert.equal(data.accumulationMinutes, 30, 'SWIRLS probe accumulation mismatch');
  assert.equal(data.sampledFrames?.length, 2, 'SWIRLS probe must sample first and last frames');
  assert.deepEqual(data.sampledFrames.map(frame => frame.frameIndex), [0, 15], 'SWIRLS probe frame indexes mismatch');
  assert.ok(data.sampledFrames.every(frame => frame.ready === true), 'SWIRLS sampled frames must be ready');
  console.log(`PASS SWIRLS probe ${data.firstValidTime} -> ${data.lastValidTime}`);
}

async function smokeSwirlsFrame(frameIndex) {
  const { data } = await request(`/api/rain/swirls/frame?frame=${frameIndex}`);
  assert.equal(data.ok, true, `SWIRLS frame ${frameIndex} must be ok`);
  assertWorkerVersion(data, `SWIRLS frame ${frameIndex}`);
  assert.equal(data.frameIndex, frameIndex, `SWIRLS frame ${frameIndex} index mismatch`);
  assert.equal(data.grid?.rows, 121, `SWIRLS frame ${frameIndex} row count mismatch`);
  assert.equal(data.grid?.cols, 121, `SWIRLS frame ${frameIndex} column count mismatch`);
  assert.equal(data.grid?.cellCount, 14641, `SWIRLS frame ${frameIndex} cell count mismatch`);
  assert.equal(data.values?.length, 14641, `SWIRLS frame ${frameIndex} values length mismatch`);
  assert.equal(data.validation?.ready, true, `SWIRLS frame ${frameIndex} is not ready`);
  assert.equal(data.validation?.runTimeMatchesIndex, true, `SWIRLS frame ${frameIndex} runtime/index mismatch`);
  console.log(`PASS SWIRLS frame ${frameIndex} valid=${data.validTime}`);
}

async function smokePoint() {
  const { data } = await request('/api/rain/point?lat=22.3023&lon=114.1746&radiusKm=2');
  assert.equal(data.ok, true, 'point forecast must be ok');
  assertWorkerVersion(data, 'point forecast');
  assert.ok(Array.isArray(data.periods) && data.periods.length > 0, 'point forecast periods missing');
  assert.equal(data.unit, 'mm / 30 min', 'point forecast unit mismatch');
  console.log(`PASS point forecast periods=${data.periods.length}`);
}

async function smokeNowcast() {
  const { data } = await request('/api/rain/nowcast');
  assert.equal(data.ok, true, 'nowcast must be ok');
  assertWorkerVersion(data, 'nowcast');
  assert.ok(Array.isArray(data.frames) && data.frames.length > 0, 'nowcast frames missing');
  assert.ok(Number(data.grid?.rows) > 0 && Number(data.grid?.cols) > 0, 'nowcast grid missing');
  console.log(`PASS nowcast frames=${data.frames.length} grid=${data.grid.rows}x${data.grid.cols}`);
}

async function smokeRadar(range, height) {
  const path = `/api/radar/frames?range=${range}&height=${height}&mode=live`;
  const { data } = await request(path);
  assert.equal(data.ok, true, `radar ${range}/${height} must be ok`);
  assertWorkerVersion(data, `radar ${range}/${height}`);
  assert.equal(data.rangeKm, range, `radar ${range}/${height} range mismatch`);
  assert.equal(data.heightKm, height, `radar ${range}/${height} height mismatch`);
  assert.ok(Array.isArray(data.frames) && data.frames.length > 0, `radar ${range}/${height} frames missing`);

  const latest = data.frames.at(-1);
  assert.ok(latest?.imageUrl, `radar ${range}/${height} latest image URL missing`);
  const image = await request(latest.imageUrl, { expectJson: false });
  const contentType = image.headers.get('content-type') || '';
  assert.match(contentType, /^image\//, `radar ${range}/${height} proxy did not return an image`);
  const bytes = (await image.arrayBuffer()).byteLength;
  assert.ok(bytes > 100, `radar ${range}/${height} image is unexpectedly small`);
  console.log(`PASS radar ${range}km/${height}km frames=${data.frames.length} latest=${latest.time} imageBytes=${bytes}`);
}

await smokeHealth();
await smokeCapabilities();
await smokeSwirlsProbe();
await smokeSwirlsFrame(0);
await smokeSwirlsFrame(15);
await smokePoint();
await smokeNowcast();
await smokeRadar(64, 2);
await smokeRadar(64, 3);
await smokeRadar(256, 3);

console.log('Production Worker smoke PASS');
