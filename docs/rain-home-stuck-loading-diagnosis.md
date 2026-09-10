# Rain Home stuck-loading diagnosis

The reported Kowloon Bay production point returned a complete 16-point SWIRLS series from the deployed Worker in about 183 ms on the measured warm path. The persistent loading screen is therefore treated as a frontend request-state defect rather than a slow-data problem.

Before this fix, `requestSeries({ force:true })` could not replace a pending request when its four-decimal point key matched `activeLoadKey`, because the unconditional duplicate guard returned before the old controller could be aborted. That meant both explicit refresh and a same-location geolocation update could appear to do nothing while the view remained `loading`.

The corrected state transition only coalesces passive duplicate loads. Explicit refresh/location triggers supersede the pending controller, own a fresh controller locally, and clear the active request only when the finishing request is still the current token. This is a request-lifecycle fix; it does not rely on extending or shortening a timeout.
