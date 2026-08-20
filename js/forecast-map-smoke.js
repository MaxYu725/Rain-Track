// Rain Home is the critical product surface and must not depend on the full
// Forecast Map / Radar module graph being loadable. Keep only the small Home
// modules static; map enhancements are isolated best-effort dynamic imports.
import './rain-home.js';
import './rain-home-shell.js';

const OPTIONAL_MAP_MODULES = [
  './rain-home-chart-scale-polish.js',
  './rain-home-chart-intensity.js',
  './rain-home-chart-fixed-y.js',
  './rain-home-observed-radar.js',
  './rain-home-reliability.js',
  './radar-entry.js',
  './radar-settings-mirror.js',
  './radar-analysis-runtime.js',
  './rain-map-quickviews.js',
  './rain-map-area-summary.js'
];

Promise.allSettled(OPTIONAL_MAP_MODULES.map(path => import(path))).then(results => {
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn(`Optional map module deferred (${OPTIONAL_MAP_MODULES[index]}):`, result.reason?.message || result.reason);
    }
  });
});