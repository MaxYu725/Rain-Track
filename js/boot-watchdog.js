(() => {
  const BOOT_TIMEOUT_MS = 8000;
  const CACHE_PREFIX = 'point-rain-pwa-';
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

  window.addEventListener('error', event => recordBootError(event?.message || event?.error?.message));
  window.addEventListener('unhandledrejection', event => recordBootError(event?.reason?.message || event?.reason));

  async function refreshServiceWorkerRegistration() {
    if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js', {
        scope:'./',
        updateViaCache:'none'
      });
      await registration.update().catch(() => {});
    } catch {}
  }

  function rainHomeReady() {
    return Boolean(
      document.body?.classList.contains('rain-home-v2') &&
      document.querySelector('.rain-home-root')
    );
  }

  async function recoverCurrentShell(button) {
    if (recoveryStarted) return;
    recoveryStarted = true;
    if (button) {
      button.disabled = true;
      button.textContent = '正在重新載入新版…';
    }

    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration('./').catch(() => null);
        await registration?.unregister?.();
      }
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names
          .filter(name => name.startsWith(CACHE_PREFIX))
          .map(name => caches.delete(name)));
      }
    } catch {}

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
      : '<div class="error-message">可能仍在使用舊版離線快取，或部分前端模組未能載入。</div>';

    content.innerHTML = `
      <div class="empty-state" data-rain-boot-recovery role="alert">
        <div class="error-symbol" aria-hidden="true">!</div>
        <strong>應用程式未完成啟動</strong>
        ${detail}
        <button class="wide-btn retry-button" type="button" data-rain-boot-reload>重新載入新版</button>
      </div>`;
    content.querySelector('[data-rain-boot-reload]')?.addEventListener('click', event => recoverCurrentShell(event.currentTarget));
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  }

  clearBootQuery();
  refreshServiceWorkerRegistration();
  setTimeout(showBootRecovery, BOOT_TIMEOUT_MS);
})();
