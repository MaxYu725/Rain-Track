const BASE = (process.env.WORKER_BASE_URL || 'https://radar.max-yu.workers.dev').replace(/\/$/, '');
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 30_000);

async function request(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(`${BASE}${path}`, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Rain-Track-point-series-diagnostic/1.1' },
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    const elapsedMs = Date.now() - started;
    console.log(JSON.stringify({
      path,
      status: response.status,
      ok: response.ok,
      elapsedMs,
      cfRay: response.headers.get('cf-ray'),
      cacheControl: response.headers.get('cache-control'),
      version: data?.version ?? null,
      error: data?.error ?? null,
      runTime: data?.runTime ?? null,
      sampleCount: data?.sampleCount ?? null,
      bodyPrefix: data ? undefined : text.slice(0, 300),
    }));
    return { response, data, text };
  } finally {
    clearTimeout(timer);
  }
}

const requiredChecks = [
  '/health',
  '/probe/swirls',
  '/api/rain/swirls/frame?frame=0',
  '/api/rain/swirls/frame?frame=15',
  '/api/rain/swirls/point-series?lat=22.30230&lon=114.17460',
  '/api/rain/swirls/point-series?lat=22.30241&lon=114.17471',
  '/api/rain/swirls/point-series?lat=22.30252&lon=114.17482',
];

let failed = false;
for (const path of requiredChecks) {
  try {
    const { response, data } = await request(path);
    if (!response.ok || data?.ok === false) failed = true;
  } catch (error) {
    failed = true;
    console.log(JSON.stringify({ path, transportError: error instanceof Error ? error.message : String(error) }));
  }
}

if (failed) process.exitCode = 1;
