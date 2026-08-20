import { performance } from 'node:perf_hooks';

const base = (process.env.WORKER_BASE_URL || 'https://radar.max-yu.workers.dev').replace(/\/$/, '');
const targets = [
  ['health', '/health'],
  ['probe', '/probe/swirls'],
  ['frame0', '/api/rain/swirls/frame?frame=0'],
  ['frame15', '/api/rain/swirls/frame?frame=15'],
  ['point', '/api/rain/swirls/point?frame=0&lat=22.3&lon=114.17'],
  ['series', '/api/rain/swirls/point-series?lat=22.3&lon=114.17']
];

const results = [];
for (const [name, path] of targets) {
  const started = performance.now();
  try {
    const response = await fetch(base + path, { signal: AbortSignal.timeout(120_000) });
    const text = await response.text();
    const wallMs = Number((performance.now() - started).toFixed(1));
    let data = null;
    try { data = JSON.parse(text); } catch {}
    results.push({
      name,
      path,
      status: response.status,
      wallMs,
      bytes: Buffer.byteLength(text),
      ok: response.ok,
      version: data?.version ?? null,
      frameIndex: data?.frameIndex ?? null,
      runTime: data?.runTime ?? data?.issueTime ?? null,
      validTime: data?.validTime ?? null,
      complete: data?.complete ?? null,
      pointCount: Array.isArray(data?.points) ? data.points.length : null,
      missingFrames: Array.isArray(data?.missingFrames) ? data.missingFrames : null,
      error: data?.error ?? null
    });
  } catch (error) {
    results.push({
      name,
      path,
      status: null,
      wallMs: Number((performance.now() - started).toFixed(1)),
      bytes: 0,
      ok: false,
      error: error?.message || String(error)
    });
  }
}

const series = results.find(item => item.name === 'series');
const allOk = results.every(item => item.status === 200 && item.ok)
  && Number(series?.pointCount) > 0;

console.log(JSON.stringify({
  mainSha: 'e021df44a3f4b8bd28d5c670138ceca0436675ff',
  measuredAt: new Date().toISOString(),
  allOk,
  results
}, null, 2));
