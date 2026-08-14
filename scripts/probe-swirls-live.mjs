import {
  createNetworkFetchText,
  createSwirlsRuntime
} from '../swirls-worker-runtime.js';

const runtime = createSwirlsRuntime({
  fetchText: createNetworkFetchText({
    userAgent: 'Rain-Track-GitHub-Live-Probe/1.0'
  })
});

const probe = await runtime.probe({
  frameIndex: 0,
  includeLastFrame: true,
  bypassCache: true
});

if (!probe.ok) throw new Error('SWIRLS live probe returned not-ok');
if (probe.frameCount !== 16) throw new Error(`Expected 16 SWIRLS frames, got ${probe.frameCount}`);
if (probe.cadenceMinutes !== 6) throw new Error(`Expected 6-minute cadence, got ${probe.cadenceMinutes}`);
if (probe.sampledFrames.length !== 2) throw new Error('Expected first and last sampled SWIRLS frames');
if (!probe.sampledFrames.every(frame => frame.ready)) throw new Error('A sampled SWIRLS frame is not ready');
if (!probe.sampledFrames.every(frame => frame.grid?.rows === 121 && frame.grid?.cols === 121 && frame.grid?.cellCount === 14641)) {
  throw new Error('A sampled SWIRLS frame does not match the 121x121 grid contract');
}
if (probe.sampledFrames[0].frameIndex !== 0 || probe.sampledFrames[1].frameIndex !== 15) {
  throw new Error('Unexpected sampled SWIRLS frame indices');
}

console.log(JSON.stringify(probe, null, 2));
console.log('SWIRLS live upstream probe PASS');
