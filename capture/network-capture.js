// Network capture module — intercepts fetch and XMLHttpRequest
// eslint-disable-next-line no-unused-vars
function createNetworkCapture(postLog) {
  let origFetch, origXhrOpen, origXhrSend;
  const SLOW_THRESHOLD = 3000;
  let logAll = false;

  function truncateBody(body) {
    if (!body) return '';
    let str;
    if (typeof body === 'string') {
      str = body;
    } else {
      try { str = JSON.stringify(body); } catch (_) { return ''; }
    }
    if (!str) return '';
    return str.length > 500 ? str.substring(0, 500) + '...[truncated]' : str;
  }

  function isExtensionUrl(url) {
    return typeof url === 'string' && url.startsWith('chrome-extension://');
  }

  function start(config) {
    logAll = config.logAllNetwork || false;

    // --- Fetch interceptor ---
    origFetch = window.fetch;
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : (input?.url || '');
      if (isExtensionUrl(url)) return origFetch.apply(this, arguments);

      const method = (init?.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase();
      const reqBody = truncateBody(init?.body);
      const startTime = performance.now();

      try {
        const response = await origFetch.apply(this, arguments);
        const duration = Math.round(performance.now() - startTime);
        const shouldLog = logAll || response.status >= 400 || duration > SLOW_THRESHOLD;

        if (shouldLog) {
          let resBody = '';
          try {
            const clone = response.clone();
            // Read only first 1KB to prevent OOM on large responses
            const reader = clone.body?.getReader();
            if (reader) {
              const { value } = await reader.read();
              reader.cancel();
              resBody = truncateBody(value ? new TextDecoder().decode(value.slice(0, 1024)) : '');
            } else {
              resBody = truncateBody(await clone.text());
            }
          } catch (_) {}

          postLog('network', {
            timestamp: new Date().toISOString(),
            type: 'fetch',
            method,
            url,
            status: response.status,
            statusText: response.statusText,
            duration,
            requestBody: reqBody,
            responseBody: resBody,
          });
        }
        return response;
      } catch (error) {
        postLog('network', {
          timestamp: new Date().toISOString(),
          type: 'fetch',
          method,
          url,
          status: 0,
          statusText: 'Network Error',
          duration: Math.round(performance.now() - startTime),
          requestBody: reqBody,
          responseBody: '',
          error: error.message,
        });
        throw error;
      }
    };

    // --- XHR interceptor ---
    origXhrOpen = XMLHttpRequest.prototype.open;
    origXhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._feDebug = { method: method.toUpperCase(), url: String(url), startTime: 0, requestBody: '' };
      return origXhrOpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (body) {
      if (this._feDebug && !isExtensionUrl(this._feDebug.url)) {
        this._feDebug.startTime = performance.now();
        this._feDebug.requestBody = truncateBody(body);

        this.addEventListener('loadend', () => {
          const duration = Math.round(performance.now() - this._feDebug.startTime);
          const shouldLog = logAll || this.status >= 400 || duration > SLOW_THRESHOLD;

          if (shouldLog) {
            postLog('network', {
              timestamp: new Date().toISOString(),
              type: 'xhr',
              method: this._feDebug.method,
              url: this._feDebug.url,
              status: this.status,
              statusText: this.statusText,
              duration,
              requestBody: this._feDebug.requestBody,
              responseBody: truncateBody(this.responseText),
            });
          }
        });
      }
      return origXhrSend.apply(this, arguments);
    };
  }

  function stop() {
    if (origFetch) window.fetch = origFetch;
    if (origXhrOpen) XMLHttpRequest.prototype.open = origXhrOpen;
    if (origXhrSend) XMLHttpRequest.prototype.send = origXhrSend;
  }

  return { start, stop };
}
