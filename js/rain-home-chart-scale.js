const MIN_SCALE_MAX = 0.3;
const MIN_SCALE_STEP = 0.1;
const TARGET_MIN_INTERVALS = 4;
const TARGET_MAX_INTERVALS = 6;
const HEADROOM_RATIO = 1.06;
const NICE_FACTORS = [1, 2, 2.5, 5, 10];

function roundClean(value) {
  return Number(Number(value).toPrecision(12));
}

function candidateSteps(target) {
  const rawStep = Math.max(MIN_SCALE_STEP, Number(target) / 5);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const steps = [];
  for (let exponentOffset = -1; exponentOffset <= 2; exponentOffset += 1) {
    const scale = magnitude * (10 ** exponentOffset);
    for (const factor of NICE_FACTORS) {
      const step = roundClean(factor * scale);
      if (step >= MIN_SCALE_STEP && !steps.includes(step)) steps.push(step);
    }
  }
  return steps.sort((a, b) => a - b);
}

export function rainfallScaleSpec(value) {
  const peak = Number(value);
  if (!Number.isFinite(peak) || peak <= 0.2) {
    return { max:MIN_SCALE_MAX, step:MIN_SCALE_STEP, ticks:[0, 0.1, 0.2, 0.3] };
  }

  const target = Math.max(MIN_SCALE_MAX, peak * HEADROOM_RATIO);
  const candidates = candidateSteps(target);
  let fallback = null;

  for (const step of candidates) {
    const intervals = Math.max(1, Math.ceil((target - 1e-12) / step));
    const max = roundClean(intervals * step);
    if (intervals <= TARGET_MAX_INTERVALS && !fallback) fallback = { max, step, intervals };
    if (intervals >= TARGET_MIN_INTERVALS && intervals <= TARGET_MAX_INTERVALS) {
      return { max, step, ticks:rainfallTickValues(max, step) };
    }
  }

  const chosen = fallback || { max:Math.ceil(target), step:1, intervals:Math.ceil(target) };
  return { max:chosen.max, step:chosen.step, ticks:rainfallTickValues(chosen.max, chosen.step) };
}

export function rainfallTickValues(max, step) {
  const yMax = Number(max);
  const yStep = Number(step);
  if (!Number.isFinite(yMax) || !Number.isFinite(yStep) || yMax <= 0 || yStep <= 0) return [0];
  const count = Math.max(1, Math.round(yMax / yStep));
  return Array.from({ length:count + 1 }, (_, index) => roundClean(index * yStep));
}
