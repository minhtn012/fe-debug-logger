// Feedback controller — MAIN world glue between background state (FEEDBACK_STATE),
// the floating button, the element picker in feedback mode and background capture.
// Owns only the capture it started: a Record session on the same tab is untouched.
// eslint-disable-next-line no-unused-vars
function createFeedbackController({ annotation, createFab, startCapture, stopCapture }) {
  const SIGNATURE = 'fe-debug-logger';
  const PICKER_TIMEOUT_MS = 4000;
  const CAPTURE_CONFIG = { console: true, networkIssuesOnly: true, userActions: false, componentState: false };

  let session = null;
  let capturing = false;
  let picking = 'idle'; // idle | requesting | active
  let pickerTimer = null;

  function send(type, data) {
    window.postMessage({ __source: SIGNATURE, version: 1, type, ...data }, '*');
  }

  // Two frames let the hidden fab leave the screen before the capture; the
  // timeout covers tabs that stop producing frames (rAF never fires there).
  function nextFrames() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
      setTimeout(resolve, 150);
    });
  }

  function resetPickerRequest() {
    clearTimeout(pickerTimer);
    pickerTimer = null;
    if (picking === 'requesting') picking = 'idle';
    fab.setHidden(false);
  }

  function stopPicker() {
    if (picking === 'active' && annotation.isActive()) annotation.stop(); // onStop resets state
    resetPickerRequest();
  }

  // The fab hides first so the frozen screenshot background takes does not show it
  async function requestPicker() {
    if (!session || picking !== 'idle') return;
    if (annotation.isActive()) annotation.stop(); // another picker mode (annotate / question)
    picking = 'requesting';
    fab.setHidden(true);
    await nextFrames();
    if (picking !== 'requesting') return;
    send('REQUEST_FEEDBACK_PICKER');
    pickerTimer = setTimeout(() => {
      resetPickerRequest();
      fab.showError('picker-timeout');
    }, PICKER_TIMEOUT_MS);
  }

  function saveItem(payload) {
    send('FEEDBACK_ITEM', { ...payload, url: window.location.href });
  }

  function onPickerStopped() {
    picking = 'idle';
    fab.setPicking(false);
  }

  function startPicker() {
    clearTimeout(pickerTimer);
    pickerTimer = null;
    if (!session || annotation.isActive()) { resetPickerRequest(); return; }
    annotation.start('feedback', { onSave: saveItem, onStop: onPickerStopped, ownHosts: [fab.getHost()] });
    picking = 'active';
    fab.setHidden(false);
    fab.setPicking(true);
  }

  // Background refuses a feedback session while Record runs and vice versa, so
  // the capture started here is never a Record capture.
  function syncCapture() {
    if (session && !capturing) {
      capturing = true;
      startCapture(CAPTURE_CONFIG);
    } else if (!session && capturing) {
      capturing = false;
      stopCapture();
    }
  }

  function teardown() {
    stopPicker();
    session = null;
    syncCapture();
    fab.destroy();
  }

  function onState(state) {
    if (!state.siteEnabled) { teardown(); return; }
    session = state.session || null;
    if (!session) stopPicker();
    else if (state.error && picking === 'requesting') resetPickerRequest();
    syncCapture();
    fab.render(state);
  }

  // Returns true when the message belongs to feedback mode.
  function handle(msg) {
    if (msg.type === 'FEEDBACK_STATE') onState(msg);
    else if (msg.type === 'START_FEEDBACK_PICKER') startPicker();
    else return false;
    return true;
  }

  // Built now, at document_start: the widget's window guard must be registered
  // before page scripts add their own listeners. No DOM until the first render.
  const fab = createFab({
    onStart: (name) => send('START_FEEDBACK_SESSION', { name }),
    onPick: () => { requestPicker().catch((e) => console.error('__fe_debug_logger__', 'Feedback picker request failed:', e)); },
    onStopPick: stopPicker,
    onFinish: () => { stopPicker(); send('FINISH_FEEDBACK_SESSION'); },
  });

  return { handle };
}
