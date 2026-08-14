export const SWIRLS_FORECAST_CONTRACT = Object.freeze({
  version:'1.0',
  frameCount:16,
  cadenceMinutes:6,
  accumulationMinutes:30,
  firstLeadMinutes:30,
  lastLeadMinutes:120,
  rows:121,
  cols:121,
  cellCount:14641,
  unit:'mm / 30 min',
  orientation:'row-major-north-to-south-west-to-east'
});

function validIso(value, label) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) throw new Error(`${label} 時間無效`);
  return new Date(time).toISOString();
}

function finiteBounds(bounds) {
  return ['north','south','east','west'].every(key => Number.isFinite(Number(bounds?.[key])));
}

function sameNumber(a, b, epsilon = 1e-6) {
  return Math.abs(Number(a) - Number(b)) <= epsilon;
}

export function normalizeSwirlsFramePayload(data) {
  if (!data || data.ok !== true) throw new Error('SWIRLS frame 回應無效');

  const frameIndex = Number(data.frameIndex);
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= SWIRLS_FORECAST_CONTRACT.frameCount) {
    throw new Error('SWIRLS frame index 無效');
  }

  const runTime = validIso(data.runTime, 'SWIRLS run');
  const validTime = validIso(data.validTime, 'SWIRLS valid');
  const leadMinutes = Number(data.leadMinutes);
  const expectedLead = SWIRLS_FORECAST_CONTRACT.firstLeadMinutes + frameIndex * SWIRLS_FORECAST_CONTRACT.cadenceMinutes;
  if (leadMinutes !== expectedLead) throw new Error(`SWIRLS lead time 不符：${leadMinutes}/${expectedLead}`);
  if (Math.round((Date.parse(validTime) - Date.parse(runTime)) / 60000) !== expectedLead) {
    throw new Error('SWIRLS valid time 與 run time 不一致');
  }

  if (data.unit !== SWIRLS_FORECAST_CONTRACT.unit) throw new Error(`SWIRLS 雨量單位不符：${data.unit || 'missing'}`);
  const grid = data.grid || {};
  if (Number(grid.rows) !== SWIRLS_FORECAST_CONTRACT.rows
    || Number(grid.cols) !== SWIRLS_FORECAST_CONTRACT.cols
    || Number(grid.cellCount) !== SWIRLS_FORECAST_CONTRACT.cellCount) {
    throw new Error('SWIRLS 121×121 grid contract 不符');
  }
  if (grid.orientation !== SWIRLS_FORECAST_CONTRACT.orientation) throw new Error('SWIRLS grid orientation 不符');
  if (!finiteBounds(grid.bounds)) throw new Error('SWIRLS grid bounds 無效');

  const values = Array.isArray(data.values) ? data.values.map(Number) : [];
  if (values.length !== SWIRLS_FORECAST_CONTRACT.cellCount) throw new Error('SWIRLS values 數量不符');
  if (values.some(value => !Number.isFinite(value) || value < 0)) throw new Error('SWIRLS values 含無效雨量');
  if (data.validation?.ready !== true || data.validation?.runTimeMatchesIndex !== true) {
    throw new Error('SWIRLS frame 尚未通過完整資料驗證');
  }

  const windowEnd = validIso(data.windowEnd || validTime, 'SWIRLS window end');
  const windowStart = validIso(data.windowStart || new Date(Date.parse(validTime) - SWIRLS_FORECAST_CONTRACT.accumulationMinutes * 60000).toISOString(), 'SWIRLS window start');
  if (Math.round((Date.parse(windowEnd) - Date.parse(windowStart)) / 60000) !== SWIRLS_FORECAST_CONTRACT.accumulationMinutes) {
    throw new Error('SWIRLS 累積雨量時窗不是 30 分鐘');
  }

  return {
    index:frameIndex,
    frameIndex,
    runTime,
    time:validTime,
    validTime,
    leadMinutes,
    windowStart,
    windowEnd,
    unit:data.unit,
    grid:{
      rows:Number(grid.rows),
      cols:Number(grid.cols),
      cellCount:Number(grid.cellCount),
      orientation:grid.orientation,
      latitudes:Array.isArray(grid.latitudes) ? [...grid.latitudes] : [],
      longitudes:Array.isArray(grid.longitudes) ? [...grid.longitudes] : [],
      stepLat:Number(grid.stepLat),
      stepLon:Number(grid.stepLon),
      bounds:{
        north:Number(grid.bounds.north),
        south:Number(grid.bounds.south),
        east:Number(grid.bounds.east),
        west:Number(grid.bounds.west)
      }
    },
    values,
    diagnostics:{
      ready:true,
      runTimeMatchesIndex:true,
      sourceBytes:Number.isFinite(Number(data.source?.bytes)) ? Number(data.source.bytes) : null
    },
    loaded:true
  };
}

export function buildSwirlsForecast(firstFrame) {
  if (!firstFrame || firstFrame.frameIndex !== 0) throw new Error('SWIRLS frontend 初始化需要 frame 0');
  const runMs = Date.parse(firstFrame.runTime);
  const frames = Array.from({ length:SWIRLS_FORECAST_CONTRACT.frameCount }, (_, frameIndex) => {
    const leadMinutes = SWIRLS_FORECAST_CONTRACT.firstLeadMinutes + frameIndex * SWIRLS_FORECAST_CONTRACT.cadenceMinutes;
    const validMs = runMs + leadMinutes * 60000;
    const validTime = new Date(validMs).toISOString();
    const loaded = frameIndex === 0;
    return {
      index:frameIndex,
      frameIndex,
      time:validTime,
      validTime,
      leadMinutes,
      windowStart:new Date(validMs - SWIRLS_FORECAST_CONTRACT.accumulationMinutes * 60000).toISOString(),
      windowEnd:validTime,
      values:loaded ? firstFrame.values : null,
      diagnostics:loaded ? firstFrame.diagnostics : null,
      loaded
    };
  });

  if (frames[0].time !== firstFrame.validTime) throw new Error('SWIRLS frame 0 timeline 與 run time 不一致');

  return {
    contractVersion:`swirls-frontend-${SWIRLS_FORECAST_CONTRACT.version}`,
    source:'swirls',
    issueTime:firstFrame.runTime,
    unit:SWIRLS_FORECAST_CONTRACT.unit,
    cadenceMinutes:SWIRLS_FORECAST_CONTRACT.cadenceMinutes,
    accumulationMinutes:SWIRLS_FORECAST_CONTRACT.accumulationMinutes,
    horizonMinutes:SWIRLS_FORECAST_CONTRACT.lastLeadMinutes,
    grid:firstFrame.grid,
    frames,
    fallbackReason:null,
    validation:{
      completeTimeline:true,
      readyForOverlay:true
    }
  };
}

export function assertSwirlsFrameCompatible(forecast, frame) {
  if (!forecast || forecast.source !== 'swirls') throw new Error('SWIRLS forecast runtime 尚未初始化');
  if (frame.runTime !== forecast.issueTime) throw new Error('SWIRLS frame run time 已切換，請重新載入預報');
  const expected = forecast.frames?.[frame.frameIndex];
  if (!expected || expected.time !== frame.validTime || expected.leadMinutes !== frame.leadMinutes) {
    throw new Error('SWIRLS frame timeline 與目前預報不一致');
  }

  const grid = forecast.grid || {};
  if (Number(grid.rows) !== Number(frame.grid?.rows)
    || Number(grid.cols) !== Number(frame.grid?.cols)
    || grid.orientation !== frame.grid?.orientation
    || !['north','south','east','west'].every(key => sameNumber(grid.bounds?.[key], frame.grid?.bounds?.[key]))) {
    throw new Error('SWIRLS frame grid 與目前預報不一致');
  }
  return true;
}
