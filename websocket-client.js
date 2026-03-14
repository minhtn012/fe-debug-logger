// WebSocket client for MCP server communication
// Enables Claude Code to control recording via MCP server → WS → extension
// eslint-disable-next-line no-unused-vars
function createWebSocketClient(onCommand) {
  const WS_URL = 'ws://localhost:3456';
  const MAX_RETRIES = 3;
  const RETRY_INTERVAL = 5000;
  const ALARM_NAME = 'ws-reconnect';

  let ws = null;
  let retryCount = 0;

  function connect() {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    try {
      ws = new WebSocket(WS_URL);
    } catch (err) {
      console.warn('__fe_debug_logger__', 'WS connect failed:', err.message);
      return;
    }

    ws.onopen = () => {
      retryCount = 0;
      // Persist WS state so reconnect works after SW restart
      chrome.storage.session.set({ wsWasConnected: true });
      // Clear alarm — WS ping/pong keeps SW alive
      chrome.alarms.clear(ALARM_NAME);
      console.log('__fe_debug_logger__', 'WS connected to MCP server');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'PING') {
          send({ type: 'PONG' });
          return;
        }
        onCommand(msg);
      } catch (err) {
        console.error('__fe_debug_logger__', 'WS message parse error:', err);
      }
    };

    ws.onclose = () => {
      ws = null;
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        // Set alarm for reconnect backup
        chrome.alarms.create(ALARM_NAME, { delayInMinutes: RETRY_INTERVAL / 60000 });
      }
    };

    ws.onerror = (err) => {
      // Suppress connection refused — expected when MCP server not running
      // onclose will fire after onerror for cleanup
    };
  }

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  function disconnect() {
    chrome.storage.session.set({ wsWasConnected: false });
    retryCount = MAX_RETRIES; // prevent reconnect
    chrome.alarms.clear(ALARM_NAME);
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  function isConnected() {
    return ws && ws.readyState === WebSocket.OPEN;
  }

  // Alarm-based reconnect backup
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME && !isConnected() && retryCount < MAX_RETRIES) {
      connect();
    }
  });

  // Auto-reconnect on SW restart if previously connected
  chrome.storage.session.get(['wsWasConnected'], (data) => {
    if (data.wsWasConnected) connect();
  });

  return { connect, send, disconnect, isConnected };
}
