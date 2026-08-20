import { performance } from 'node:perf_hooks';
import {
  SWIRLS_RAW_CONTRACT,
  bindSwirlsMdlFrame,
  parseSwirlsIndex,
  parseSwirlsMdl
} from '../swirls-data.js';
import { sampleSwirlsPoint } from '../swirls-point-sample.js';
import { createSwirlsPointSeriesBatchLoader } from '../swirls-point-series-batch.js';
import { createSwirlsPointSeriesRequestHandler } from '../swirls-point-series-request.js';
import { createNetworkFetchText, createSwirlsRuntime, SWIRLS_FETCH_POLICY } from '../swirls-worker-runtime.js';

const LOCATION = { lat:22.3023, lon:114.1746 };
const fetchText = createNetworkFetchText({ userAgent:'Rain-Track-SWIRLS-Benchmark/1.0' });

function cpuMs(start) {
  const usage = process.cpuUsage(start);
  return Number(((usage.user + usage.system) / 1000).toFixed(2));
}

async function measure(label, fn) {
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();
  const value = await fn();
  return {
    label,
    wallMs:Number((performance.now() - wallStart).toFixed(2)),
    cpuMs:cpuMs(cpuStart),
    value
  };
}

const indexFetch = await measure('indexFetch', async () => fetchText(SWIRLS_RAW_CONTRACT.indexUrl, {
  kind:'index', timeoutMs:SWIRLS_FETCH_POLICY.timeoutMs
}));
const indexParse = await measure('indexParse', async () => parseSwirlsIndex(indexFetch.value.body));
const index = indexParse.value;

const oneMdlFetch = await measure('oneMdlFetch', async () => fetchText(index.frames[0].mdlUrl, {
  kind:'mdl', frameIndex:0, runTime:index.inferredRunTime, timeoutMs:SWIRLS_FETCH_POLICY.timeoutMs
}));

const sixteenFetch = await measure('sixteenMdlConcurrentFetch', async () => Promise.all(index.frames.map(frame => fetchText(frame.mdlUrl, {
  kind:'mdl', frameIndex:frame.frameIndex, runTime:index.inferredRunTime, timeoutMs:SWIRLS_FETCH_POLICY.timeoutMs
}))));
const mdlBodies = sixteenFetch.value.map(result => result.body);

const oneParse = await measure('oneMdlParse', async () => parseSwirlsMdl(oneMdlFetch.value.body));
const sixteenParse = await measure('sixteenMdlParse', async () => mdlBodies.map(body => parseSwirlsMdl(body)));

const boundFrames = mdlBodies.map((body, frameIndex) => bindSwirlsMdlFrame(index, frameIndex, body));
const interpolation = await measure('sixteenPointInterpolations', async () => boundFrames.map(frame => sampleSwirlsPoint(frame, LOCATION.lat, LOCATION.lon)));

const runtime = createSwirlsRuntime({ fetchText });
const batchLoader = createSwirlsPointSeriesBatchLoader({
  loadIndex: options => runtime.loadIndex(options),
  fetchText,
  policy:SWIRLS_FETCH_POLICY
});
const handler = createSwirlsPointSeriesRequestHandler({ loadFrames:batchLoader });
const completeRequest = await measure('completePointSeriesRequest', async () => handler(new URL(
  `https://benchmark.invalid/api/rain/swirls/point-series?lat=${LOCATION.lat}&lon=${LOCATION.lon}`
)));

const output = {
  benchmarkVersion:'zero-base-v1',
  measuredAt:new Date().toISOString(),
  environment:{ runtime:process.version, platform:process.platform, architecture:process.arch },
  source:{ runTime:index.inferredRunTime, frameCount:index.frames.length, cellCountPerFrame:SWIRLS_RAW_CONTRACT.cellCount },
  metrics:{
    indexFetch:{ wallMs:indexFetch.wallMs, cpuMs:indexFetch.cpuMs, bytes:indexFetch.value.bytes },
    indexParse:{ wallMs:indexParse.wallMs, cpuMs:indexParse.cpuMs },
    oneMdlFetch:{ wallMs:oneMdlFetch.wallMs, cpuMs:oneMdlFetch.cpuMs, bytes:oneMdlFetch.value.bytes },
    sixteenMdlConcurrentFetch:{ wallMs:sixteenFetch.wallMs, cpuMs:sixteenFetch.cpuMs, totalBytes:sixteenFetch.value.reduce((sum, item) => sum + (item.bytes || 0), 0) },
    oneMdlParse:{ wallMs:oneParse.wallMs, cpuMs:oneParse.cpuMs },
    sixteenMdlParse:{ wallMs:sixteenParse.wallMs, cpuMs:sixteenParse.cpuMs },
    sixteenPointInterpolations:{ wallMs:interpolation.wallMs, cpuMs:interpolation.cpuMs },
    completePointSeriesRequest:{ wallMs:completeRequest.wallMs, cpuMs:completeRequest.cpuMs, complete:completeRequest.value.complete, pointCount:completeRequest.value.points.length, missingFrames:completeRequest.value.missingFrames }
  },
  note:'CPU time is Node process CPU on the GitHub runner, not Cloudflare Worker platform CPU. Use it to compare parser cost versus network wall time; collect platform CPU only during preview/production deployment.'
};

if (output.source.frameCount !== 16) throw new Error(`Expected 16 SWIRLS frames, got ${output.source.frameCount}`);
if (!output.metrics.completePointSeriesRequest.complete || output.metrics.completePointSeriesRequest.pointCount !== 16) {
  throw new Error('Complete point-series benchmark request did not return all 16 frames');
}

console.log(JSON.stringify(output, null, 2));
