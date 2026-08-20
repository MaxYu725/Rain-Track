const VALID_SCOPES = new Set(['regional','hong-kong','shenzhen','south-sea','location']);

let activeScope = 'regional';

function normalizeScope(value) {
  const scope = String(value || '').trim();
  return VALID_SCOPES.has(scope) ? scope : 'regional';
}

export function getForecastAnalysisScope() {
  return activeScope;
}

export function setForecastAnalysisScope(value, { notify = true, forceNotify = false } = {}) {
  const next = normalizeScope(value);
  const changed = next !== activeScope;
  activeScope = next;
  if (notify && (changed || forceNotify)
    && typeof window !== 'undefined'
    && typeof window.dispatchEvent === 'function'
    && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('rain:forecast-analysis-scope-change', {
      detail:{ scope:activeScope }
    }));
  }
  return activeScope;
}

export function resetForecastAnalysisScope(options) {
  return setForecastAnalysisScope('regional', options);
}
