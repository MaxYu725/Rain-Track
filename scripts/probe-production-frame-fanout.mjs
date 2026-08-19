const BASE = (process.env.WORKER_BASE_URL || 'https://radar.max-yu.workers.dev').replace(/\/$/, '');
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 30_000);

async function fetchFrame(index) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(`${BASE}/api/rain/swirls/frame?frame=${index}`, {
      headers: { 'User-Agent': 'Rain-Track-frame-fanout-diagnostic/1.0' },
      signal: controller.signal,
    });
    const text = await response.text();
    const data = JSON.parse(text);
    return {
      index,
      status: response.status,
      elapsedMs: Date.now() - started,
      runTime: data.runTime,
      validTime: data.validTime,
      values: Array.isArray(data.values) ? data.values.length : 0,
      error: data.error || null,
    };
  } catch (error) {
    return {
      index,
      status: 0,
      elapsedMs: Date.now() - started,
      runTime: null,
      validTime: null,
      values: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

const started = Date.now();
const results = await Promise.all(Array.from({ length: 16 }, (_, index) => fetchFrame(index)));
const elapsedMs = Date.now() - started;
for (const result of results) console.log(JSON.stringify(result));
const runs = new Set(results.map(result => result.runTime).filter(Boolean));
const failed = results.filter(result => result.status !== 200 || result.values !== 14641);
console.log(JSON.stringify({ fanoutElapsedMs: elapsedMs, runCount: runs.size, failures: failed.length }));
if (failed.length || runs.size !== 1) process.exitCode = 1;
