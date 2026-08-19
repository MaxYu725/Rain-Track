export const RAIN_HOME_FIRST_LEAD_MINUTES = 30;
export const RAIN_HOME_CADENCE_MINUTES = 6;
export const RAIN_HOME_HORIZON_MINUTES = 120;
export const RAIN_HOME_RAIN_THRESHOLD_MM = 0.2;

export function expectedRainHomeLeadMinutes(frameIndex) {
  const index = Number(frameIndex);
  if (!Number.isInteger(index) || index < 0) return null;
  return RAIN_HOME_FIRST_LEAD_MINUTES + index * RAIN_HOME_CADENCE_MINUTES;
}

export function rainHomeLeadRatio(leadMinutes, horizonMinutes = RAIN_HOME_HORIZON_MINUTES) {
  const lead = Number(leadMinutes);
  const horizon = Number(horizonMinutes);
  if (!Number.isFinite(lead) || !Number.isFinite(horizon) || horizon <= 0) return null;
  return Math.max(0, Math.min(1, lead / horizon));
}

export function findFirstWetSignalTransition(points, thresholdMm = RAIN_HOME_RAIN_THRESHOLD_MM) {
  const samples = Array.isArray(points) ? points : [];
  const index = samples.findIndex(point => Number(point?.amountMm) >= Number(thresholdMm));
  if (index < 0) return null;

  const first = samples[index];
  const previous = index > 0 ? samples[index - 1] : null;
  return {
    index,
    first,
    previous,
    transitionStartValidTime: previous?.validTime || null,
    transitionEndValidTime: first?.validTime || null
  };
}
