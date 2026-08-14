# Rain-Track → Weather Metro integration contract

Status: **Integration Phase 0 source contract**  
Rain-Track verified baseline: `b762b27ac428b5369b53ba2b6c5ee7b7d65dfc9d`  
Weather Metro verified baseline: `32fc4dd08344b1eb3c59e84c4423bc7ee476d557`  
Production Worker: `v2.5.0`

## 1. Integration decision

`MaxYu725/Weather_Metro_App` remains the native Android host. Rain-Track becomes a native tool module inside the existing `tools` Pivot together with Storm-Track.

Do **not** embed the standalone Rain-Track PWA in a WebView. The standalone PWA remains:

- the reference implementation;
- the browser/PWA fallback;
- a Worker smoke-test client;
- a regression reference for native Weather Metro behavior.

The Android host should consume the production Worker contract directly and render native Compose/domain models.

```text
Weather_Metro_App
  data/
    rain/       Rain service / JSON transport / cache
    storm/      Storm service / JSON transport / cache
  domain/
    rain/       point forecast / forecast frames / radar models
    storm/      independent cyclone models
  ui/
    tools/
      ToolsHome
      Rain tool
      Storm tool
```

Rain and Storm stay independent at the backend boundary during initial integration.

## 2. Verified production backend

```text
Base URL: https://radar.max-yu.workers.dev
Worker: v2.5.0
Radar contract: v1.0
SWIRLS: 16 frames / 6-minute valid-time cadence
```

The Android client must keep this origin in one service/config location. Do not scatter the hostname through Compose code.

The Worker exposes public GET APIs and the Android app requires no Cloudflare credential.

## 3. Required API surface

### 3.1 Capabilities

```http
GET /api/capabilities
```

Use this as the feature gate for runtime controls. Weather Metro should not assume that every radar range supports every height, or that a future Worker version keeps every optional capability enabled.

Expected Rain capabilities include point forecast, full nowcast grid, radar frames, and SWIRLS frame support.

### 3.2 Point rainfall forecast

```http
GET /api/rain/point?lat=22.3023&lon=114.1746&radiusKm=2
```

Supported nearby-radius UI values in the reference implementation:

```text
1 / 2 / 3 / 5 km
```

Important semantic fields:

- issue/generated time;
- selected location;
- nearby radius;
- summary;
- freshness/spatial quality;
- forecast periods;
- amount / nearby maximum / nearby mean;
- nearest-grid distance and spatial spread.

Rainfall unit is `mm / 30 min`.

Weather Metro should reuse its existing fused-location pipeline and pass the resulting coordinates to this endpoint. Do not add a second location subsystem inside the Rain tool.

### 3.3 Preferred two-hour Forecast Map transport — SWIRLS

```http
GET /api/rain/swirls/frame?frame=0
...
GET /api/rain/swirls/frame?frame=15
```

This is now the preferred fine-timeline integration contract.

Verified contract:

- 16 frames;
- frame indices `0..15`;
- valid-time cadence: 6 minutes;
- forecast horizon: approximately `+30` through `+120` minutes;
- every frame represents a **30-minute accumulated rainfall window**;
- unit: `mm / 30 min`;
- grid: `121 × 121`;
- values: `14,641` row-major cells;
- orientation: north → south, west → east;
- one model run / publication must be used consistently across a displayed timeline.

The UI wording must make the distinction explicit:

```text
6-minute step = forecast valid-time step
30-minute accumulation = value represented by each frame
```

Do not label the values as "6-minute rainfall".

#### Loading policy

The standalone reference implementation lazy-loads SWIRLS frames rather than downloading all 16 frames immediately. Weather Metro should preserve the same product behavior:

1. load frame 0 to establish the run/timeline;
2. load selected/next frames on demand;
3. cache successfully decoded frames for the active run;
4. discard or isolate frames when the run changes;
5. an older response must never overwrite a newer selected run/frame.

The Worker already handles index/MDL publication rollover by bypassing cache and retrying once. The native client should use a bounded request timeout large enough for that server-side recovery path; avoid an aggressive 10–15 second timeout for SWIRLS frame calls.

### 3.4 Full gridded nowcast fallback

```http
GET /api/rain/nowcast
```

Keep this endpoint as the fallback/reference path. It contains the complete HKO gridded rainfall nowcast and can reconstruct the traditional four valid periods:

```text
+30 / +60 / +90 / +120 minutes
```

Weather Metro should not remove this path when SWIRLS is integrated. If SWIRLS is temporarily unavailable, a 4-period fallback is preferable to making the whole Rain tool unavailable.

### 3.5 Radar frames

```http
GET /api/radar/frames?range=64&height=2&mode=live
GET /api/radar/frames?range=64&height=3&mode=live
GET /api/radar/frames?range=256&height=3&mode=live
GET /api/radar/frames?range=64&height=3&mode=test
```

Verified products:

```text
64 km  → 2 km / 3 km height
256 km → 3 km height only
```

Important response semantics:

- contract version;
- range/height/mode;
- issue time and cadence;
- frame count;
- render mode;
- frame scan time;
- geographic bounds;
- Worker-relative image URL.

Resolve `imageUrl` relative to the Rain Worker base URL.

### 3.6 Radar image proxy

```http
GET /api/radar/image?id=...
```

Weather Metro should use the Worker proxy. Do not rebuild HKO KML parsing or trust arbitrary image hosts inside the Android app.

## 4. Forecast grid contracts

### 4.1 `/api/rain/nowcast` observed-axis rule

A wet-weather regression found that the HKO CSV latitude/longitude values are rounded to three decimals, so adjacent differences can alternate between `0.019` and `0.020`.

Therefore Weather Metro must **not** reconstruct the grid using one minimum/nominal step:

```text
minLat + row * stepLat
minLon + col * stepLon
```

For the nowcast fallback path:

1. collect actual unique latitude values;
2. collect actual unique longitude values;
3. latitude axis: north → south;
4. longitude axis: west → east;
5. map points onto those observed axes;
6. require a complete unique `rows × cols` grid for every frame;
7. fail closed on duplicates, missing cells or missing required periods.

`stepLat` / `stepLon` are metadata only, not reconstruction truth.

### 4.2 SWIRLS fixed-grid rule

For `/api/rain/swirls/frame` use the validated Worker grid contract directly:

```text
rows = 121
cols = 121
cellCount = 14641
orientation = north→south / west→east
```

A frame that does not satisfy its declared dimensions/cell count should fail closed instead of being partially rendered.

## 5. Product semantics that must survive native migration

### Radar and Forecast are different products

- Radar = observation / past scan time.
- SWIRLS/nowcast = future forecast valid time / accumulation window.

Do not compare the two clocks as if they were expected to match.

Weather Metro should preserve the reference app's mutually exclusive map mode:

```text
Off / Radar / 2-hour Forecast
```

Do not overlay Radar and Forecast by default in a way that implies one continuous time series.

### Forecast timeline

Current standalone behavior:

- 16 selectable SWIRLS frames when available;
- 6-minute valid-time steps;
- play/pause autoplay;
- independent forecast playback speed;
- independent forecast opacity;
- fallback to four nowcast periods when SWIRLS is unavailable;
- timeline stops when the forecast surface is no longer active.

For native Compose, playback should advance only after the target frame is available. Hidden/off-screen tools must stop playback and disposable requests.

### Radar settings remain separate

Radar-only controls:

- range;
- height;
- opacity;
- live/test mode;
- radar animation speed.

Forecast-only controls:

- forecast opacity;
- forecast playback speed;
- autoplay preference.

Do not place Radar settings under the Forecast mode or vice versa.

## 6. Cache and cancellation ownership

Do not reuse Rain-Track browser `localStorage` or Service Worker cache inside Android.

Weather Metro should use a Rain-specific native cache namespace and preserve these semantics:

- last successful data may render immediately;
- failed refresh must not erase good cached data;
- stale/fallback state remains visible;
- SWIRLS frames are keyed by run + frame index;
- radar metadata/images can use their own short-lived cache policy;
- clearing Weather Metro cache should eventually clear native Rain caches too.

Use structured coroutine cancellation:

- leaving Rain cancels disposable UI-owned requests;
- selecting a different frame invalidates older selection work;
- an older response cannot overwrite a newer request;
- forecast autoplay and radar animation stop when hidden/backgrounded.

## 7. Native rendering boundary

The standalone frontend uses Leaflet + Canvas. Weather Metro should not port the DOM implementation.

Reference pipeline:

```text
Worker JSON
  → validated domain grid/frame
  → native bitmap/raster
  → native map/image overlay
```

Presentation rules:

- rainfall values remain official values;
- the colour scale is presentation only;
- dry/very-low cells may be transparent;
- unit remains `mm / 30 min`;
- show the complete accumulation window where useful;
- do not synthesize missing radar echo or missing forecast cells.

The final native map library/renderer may be selected during the rendering phase; it is not part of this source-contract checkpoint.

## 8. Weather Metro navigation target

Keep `PageColourSlot.TOOLS` as the top-level host page.

Recommended internal navigation:

```text
ToolsHome
  ├── Rain
  │    ├── Point forecast
  │    └── Map: Radar / 2-hour Forecast
  └── Storm
       ├── Live
       └── Archive
```

Do not add a permanent top-level Rain page to the main Pivot.

Back behavior should unwind the internal tool state before leaving the Tools host.

## 9. Security boundary

The Android app must not contain:

- Cloudflare API tokens;
- Worker deployment credentials;
- HKO proxy allow-list logic duplicated from the Worker;
- arbitrary proxy URL construction.

Only public runtime endpoints belong in the client.

The Weather Metro architecture currently has no WebView/JavaScript bridge; Rain integration should preserve that boundary.

## 10. Integration implementation order

Recommended sequence:

1. central Tool endpoint/origin registry in Weather Metro;
2. Rain domain models and JSON parsers with fixture tests;
3. capabilities + point forecast service;
4. SWIRLS frame service + run/frame cache;
5. `/api/rain/nowcast` fallback parser and observed-axis regression test;
6. radar metadata + image service;
7. ToolsHome native navigation;
8. native point forecast UI;
9. native Forecast map/timeline/autoplay;
10. native Radar map/timeline;
11. lifecycle/cache/rotation/background regression;
12. integrate Storm module beside Rain without merging either backend.

## 11. Acceptance reference

Standalone Rain-Track has already verified on Android/PWA:

- point forecast;
- three production Live Radar products;
- 16-frame SWIRLS 6-minute forecast timeline;
- forecast autoplay;
- independent Radar/Forecast settings;
- forecast sheet/timeline mobile layout;
- SWIRLS lazy frame loading;
- nowcast fallback;
- observed-axis grid regression;
- Worker v2.5.0 production smoke.

This standalone app is the behavioral reference while Weather Metro is being implemented.

## 12. Freeze rule

Rain-Track is now a stable reference implementation. Re-open standalone runtime work only for:

- HKO upstream/schema changes;
- Worker API contract defects;
- PWA startup/update regressions;
- real-rain calculation/source defects;
- a backend field genuinely required by Weather Metro integration.

New product UX should be implemented in Weather Metro first.