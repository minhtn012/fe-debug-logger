// Network capture module - intercepts fetch and XMLHttpRequest
// eslint-disable-next-line no-unused-vars
function createNetworkCapture(postLog) {
  let origFetch, origXhrOpen, origXhrSend, origXhrSetHeader;
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

  // Extract headers from fetch Headers/object/array into plain object
  function extractHeaders(headers) {
    if (!headers) return {};
    const result = {};
    if (headers instanceof Headers) {
      headers.forEach((value, key) => { result[key] = value; });
    } else if (Array.isArray(headers)) {
      headers.forEach(([key, value]) => { result[key] = value; });
    } else if (typeof headers === 'object') {
      Object.entries(headers).forEach(([key, value]) => { result[key] = value; });
    }
    return result;
  }

  // Parse XHR getAllResponseHeaders() string into plain object
  function parseXhrResponseHeaders(headerStr) {
    const result = {};
    if (!headerStr) return result;
    headerStr.trim().split(/\r?\n/).forEach(line => {
      const idx = line.indexOf(':');
      if (idx > 0) {
        result[line.substring(0, idx).trim().toLowerCase()] = line.substring(idx + 1).trim();
      }
    });
    return result;
  }

  // Build a reproducible curl command from captured request data
  function buildCurl(method, url, reqHeaders, reqBody) {
    const parts = ['curl'];
    if (method !== 'GET') parts.push(`-X ${method}`);
    if (reqHeaders && typeof reqHeaders === 'object') {
      Object.entries(reqHeaders).forEach(([k, v]) => {
        parts.push(`-H '${k}: ${v}'`);
      });
    }
    if (reqBody) {
      // Escape single quotes in body for shell safety
      const escaped = reqBody.replace(/'/g, "'\\''");
      parts.push(`-d '${escaped}'`);
    }
    parts.push(`'${url}'`);
    return parts.join(' \\\n  ');
  }

  function start(config) {
    logAll = config.network || config.logAllNetwork || false;

    // --- Fetch interceptor ---
    origFetch = window.fetch;
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : (input?.url || '');
      if (isExtensionUrl(url)) return origFetch.apply(this, arguments);

      const method = (init?.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase();
      const reqBody = truncateBody(init?.body);
      // Merge headers from Request object and init
      const reqHeaders = extractHeaders(init?.headers || (typeof input !== 'string' && input?.headers));
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

          const resHeaders = extractHeaders(response.headers);

          postLog('network', {
            timestamp: new Date().toISOString(),
            type: 'fetch',
            method,
            url,
            status: response.status,
            statusText: response.statusText,
            duration,
            requestHeaders: reqHeaders,
            responseHeaders: resHeaders,
            requestBody: reqBody,
            responseBody: resBody,
            curl: buildCurl(method, url, reqHeaders, reqBody),
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
          requestHeaders: reqHeaders,
          responseHeaders: {},
          requestBody: reqBody,
          responseBody: '',
          error: error.message,
          curl: buildCurl(method, url, reqHeaders, reqBody),
        });
        throw error;
      }
    };

    // --- XHR interceptor ---
    origXhrOpen = XMLHttpRequest.prototype.open;
    origXhrSend = XMLHttpRequest.prototype.send;
    origXhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._feDebug = {
        method: method.toUpperCase(), url: String(url),
        startTime: 0, requestBody: '', requestHeaders: {},
      };
      return origXhrOpen.apply(this, [method, url, ...rest]);
    };

    // Capture each setRequestHeader call
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      if (this._feDebug) {
        this._feDebug.requestHeaders[name] = value;
      }
      return origXhrSetHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
      if (this._feDebug && !isExtensionUrl(this._feDebug.url)) {
        this._feDebug.startTime = performance.now();
        this._feDebug.requestBody = truncateBody(body);

        this.addEventListener('loadend', () => {
          const duration = Math.round(performance.now() - this._feDebug.startTime);
          const shouldLog = logAll || this.status >= 400 || duration > SLOW_THRESHOLD;

          if (shouldLog) {
            const resHeaders = parseXhrResponseHeaders(this.getAllResponseHeaders());
            postLog('network', {
              timestamp: new Date().toISOString(),
              type: 'xhr',
              method: this._feDebug.method,
              url: this._feDebug.url,
              status: this.status,
              statusText: this.statusText,
              duration,
              requestHeaders: this._feDebug.requestHeaders,
              responseHeaders: resHeaders,
              requestBody: this._feDebug.requestBody,
              responseBody: truncateBody(this.responseText),
              curl: buildCurl(this._feDebug.method, this._feDebug.url, this._feDebug.requestHeaders, this._feDebug.requestBody),
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
    if (origXhrSetHeader) XMLHttpRequest.prototype.setRequestHeader = origXhrSetHeader;
  }

  return { start, stop };
}
