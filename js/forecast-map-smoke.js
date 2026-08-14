const SMOKE_PARAM = 'forecastMapSmoke';

export function forecastMapSmokeEnabled() {
  return new URLSearchParams(location.search).get(SMOKE_PARAM) === '1';
}
