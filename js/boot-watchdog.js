(() => {
  const BOOT_TIMEOUT_MS = 5000;
  let recoveryStarted = false;
  let lastBootError = '';

  function clearBootQuery() {
    try {
      const url = new URL(location.href);
      if (!url.searchParams.has('_boot')) return;
      url.searchParams.delete('_boot');
      history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {}
  }

  function recordBootError(value) {
    if (lastBootError) return;
    lastBootError = String(value || '').trim().slice(0, 220);
  }

  window.addEventListener('error', event => {
    const target = event?.target;
    if (target && target !== window) {
      const source = target.src || target.href || target.tagName || 'resource';
      recordBootError(`資源載入失敗：${source}`);
      return;
    }
    recordBootError(event?.message || event?.error?.message);
  }, true);
  window.addEventListener('unhandledrejection', event => recordBootError(event?.reason?.message || event?.reason));

  function rainHomeReady() {
    const current = document.querySelector('.rain-home-root[data-rain-home-owned="series"]');
    return Boolean(document.body?.classList.contains('rain-home-v2') && current);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  }

  function recoverCurrentShell(button) {
    if (recoveryStarted) return;
    recoveryStarted = true;
    if (button) {
      button.disabled = true;
      button.textContent = '正在重新載入…';
    }
    const url = new URL(location.href);
    url.searchParams.set('_boot', Date.now().toString(36));
    location.replace(url.toString());
  }

  function showBootRecovery() {
    if (rainHomeReady()) return;
    const content = document.getElementById('forecast-content');
    if (!content || content.querySelector('[data-rain-boot-recovery]')) return;
    const detail = lastBootError
      ? `<div class="error-message">啟動錯誤：${escapeHtml(lastBootError)}</div>`
      : '<div class="error-message">前端模組未完成載入。可重新載入應用程式。</div>';
    content.innerHTML = `<div class="empty-state" data-rain-boot-recovery role="alert"><div class="error-symbol" aria-hidden="true">!</div><strong>Rain Home 未完成啟動</strong>${detail}<button class="wide-btn retry-button" type="button" data-rain-boot-reload>重新載入</button></div>`;
    content.querySelector('[data-rain-boot-reload]')?.addEventListener('click', event => recoverCurrentShell(event.currentTarget));
  }

  function startBootWatchdog() {
    clearBootQuery();
    setTimeout(showBootRecovery, BOOT_TIMEOUT_MS);
  }

  document.documentElement.dataset.rainBootWatchdog = 'active';
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startBootWatchdog, { once:true });
  else startBootWatchdog();
})();
