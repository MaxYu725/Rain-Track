import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const home = readFileSync(new URL('../js/rain-home.js', import.meta.url), 'utf8');
const requestBody = home.match(/async function requestSeries\(\{ force = false \} = \{\}\) \{([\s\S]*?)\n\}\n\nfunction validPoint/)?.[1] || '';

assert.ok(requestBody, 'requestSeries body missing');
assert.ok(requestBody.includes('if (!force && activeLoadKey === key) return;'), 'only passive duplicate loads may be coalesced');
assert.ok(!requestBody.includes('\n  if (activeLoadKey === key) return;'), 'explicit refresh/location must never be blocked by a same-key pending request');
assert.ok(requestBody.includes("activeController.abort(new DOMException('Superseded by a newer Rain Home request', 'AbortError'))"), 'a newer explicit request must supersede the pending controller');
assert.ok(requestBody.includes('const controller = new AbortController();'), 'each Rain Home request must own its controller');
assert.ok(requestBody.includes('signal:controller.signal'), 'the request must use its local controller signal');
assert.ok(requestBody.includes('controller.signal.aborted'), 'superseded requests must settle without overwriting newer state');
assert.ok(requestBody.includes("if (activeController === controller) activeController = null;"), 'completed current request must release its active controller');
assert.ok(requestBody.includes("window") === false, 'requestSeries must not create hidden event loops');

console.log('Rain Home stuck-loading supersession gate PASS');
