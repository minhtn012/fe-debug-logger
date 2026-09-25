// Feedback floating button — Shadow DOM widget that names a feedback session,
// shows its item count and launches the element picker. Pure UI: actions leave
// through the callbacks, state comes in through render() / setPicking().
// eslint-disable-next-line no-unused-vars
function createFabWidget({ onStart, onPick, onStopPick, onFinish }) {
  const POS_KEY = '__fe_fab_pos';
  const ERROR_MS = 6000;
  const ERRORS = {
    'recording-active': 'Đang Record, dừng Record trước.',
    'item-cap': 'Session đã đủ 50 item, bấm Xong để kết thúc.',
    'no-session': 'Session đã kết thúc.',
    'site-disabled': 'Site chưa bật feedback.',
    'picker-timeout': 'Không bật được chế độ chọn, thử lại.',
  };
  // Page listeners must not see interaction with the widget: a click here would
  // count as "click outside" and close the menu the user is about to report.
  // pointerup/pointermove stay unguarded so the grip's drag listeners get them.
  const GUARDED_EVENTS = ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu',
    'keydown', 'keyup', 'keypress', 'focusin', 'focusout', 'touchstart'];

  let host = null, root = null, session = null;
  let view = 'idle'; // idle | naming | active | picking
  let hidden = false, errorTimer = null;
  let pos = loadPos();

  function loadPos() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(POS_KEY)); } catch (_) { /* storage blocked or bad JSON */ }
    return p && Number.isFinite(p.right) && Number.isFinite(p.bottom) ? p : { right: 20, bottom: 20 };
  }

  function savePos() { try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (_) {} }

  function applyPos(p) {
    const maxRight = Math.max(0, window.innerWidth - host.offsetWidth);
    const maxBottom = Math.max(0, window.innerHeight - host.offsetHeight);
    pos = { right: Math.min(Math.max(0, p.right), maxRight), bottom: Math.min(Math.max(0, p.bottom), maxBottom) };
    host.style.right = pos.right + 'px';
    host.style.bottom = pos.bottom + 'px';
  }

  function esc(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function css() {
    return `
      .fab { display: flex; align-items: center; gap: 6px; padding: 6px 8px; background: #1f2937; color: #f9fafb;
        border-radius: 10px; box-shadow: 0 4px 14px rgba(0,0,0,0.3); font: 13px/1.3 -apple-system, BlinkMacSystemFont, sans-serif; }
      .grip { cursor: grab; color: #9ca3af; padding: 0 2px; user-select: none; touch-action: none; }
      .label { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      button { font: inherit; border: none; border-radius: 6px; padding: 5px 10px; cursor: pointer; background: #374151; color: #f9fafb; }
      button:hover { background: #4b5563; } button.primary { background: #d97706; }
      button.primary:hover { background: #b45309; }
      input { font: inherit; width: 160px; padding: 4px 6px; border: 1px solid #6b7280; border-radius: 6px; background: #fff; color: #111827; }
      input.invalid { border-color: #dc2626; }
      .err { margin-top: 4px; padding: 4px 8px; background: #fee2e2; color: #991b1b; border-radius: 6px;
        font: 12px/1.3 -apple-system, BlinkMacSystemFont, sans-serif; }
    `;
  }

  function bodyHtml() {
    if (view === 'naming') {
      return '<input id="nameInput" placeholder="Tên session" maxlength="80">'
        + '<button class="primary" data-act="start">Bắt đầu</button><button data-act="cancel">Huỷ</button>';
    }
    if (view === 'picking') {
      return '<span class="label">Đang chọn element · Esc để thoát</span><button data-act="stoppick">Dừng chọn</button>';
    }
    if (view === 'active') {
      return `<span class="label" title="${esc(session.name)}">${esc(session.name)} · ${session.itemCount} item</span>`
        + '<button class="primary" data-act="pick">Chọn element</button><button data-act="finish">Xong</button>';
    }
    return '<button class="primary" data-act="open">Góp ý</button>';
  }

  function paint() {
    if (!root) return;
    root.getElementById('body').innerHTML = bodyHtml();
    if (view === 'naming') root.getElementById('nameInput').focus();
    applyPos(pos);
  }

  function submitName() {
    const input = root.getElementById('nameInput');
    const name = input.value.trim();
    if (!name) { input.classList.add('invalid'); input.focus(); return; }
    onStart(name);
  }

  const ACTIONS = {
    open() { view = 'naming'; paint(); },
    cancel() { view = 'idle'; paint(); },
    start: submitName,
    pick: () => onPick(), stoppick: () => onStopPick(), finish: () => onFinish(),
  };

  // Pointer capture keeps moves targeted at the grip, so neither page listeners
  // nor the page freeze shield (which lets our own events through) take them.
  function startDrag(e, grip) {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, right: pos.right, bottom: pos.bottom };
    const drag = new AbortController();
    const end = () => { drag.abort(); savePos(); };
    grip.addEventListener('pointermove', (ev) => applyPos({
      right: start.right - (ev.clientX - start.x), bottom: start.bottom - (ev.clientY - start.y),
    }), { signal: drag.signal });
    grip.addEventListener('pointerup', end, { signal: drag.signal });
    grip.addEventListener('pointercancel', end, { signal: drag.signal });
  }

  // Registered on window in the capture phase when the factory runs at
  // document_start, before any page script, so it sees widget events first. It
  // stops them there, which also hides them from the widget's own nodes, and
  // dispatches the widget's actions itself. Default actions (focus, typing) still run.
  function guard(e) {
    if (!host || !e.composedPath().includes(host)) return;
    e.stopImmediatePropagation();
    const target = e.composedPath()[0];
    if (e.type === 'click') {
      const btn = target.closest && target.closest('button[data-act]');
      if (btn) ACTIONS[btn.dataset.act]();
    } else if (e.type === 'pointerdown' && target.id === 'grip') {
      startDrag(e, target);
    } else if (e.type === 'keydown') {
      if (e.key === 'Escape' && view === 'picking') onStopPick();
      else if (target.id === 'nameInput' && e.key === 'Enter') submitName();
      else if (target.id === 'nameInput' && e.key === 'Escape') ACTIONS.cancel();
    }
  }

  function onResize() { if (host && host.isConnected) applyPos(pos); }

  function build() {
    host = document.createElement('fe-feedback-fab');
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; display: block;';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${css()}</style>
      <div class="fab"><span class="grip" id="grip" title="Kéo để di chuyển">⋮⋮</span><span id="body"></span></div>
      <div class="err" id="err" hidden></div>`;
    root.getElementById('body').addEventListener('input', (e) => e.target.classList.remove('invalid'));
  }

  // Frameworks can re-render <body> and drop foreign nodes, so every render
  // re-attaches. Before <body> exists the mount waits for DOMContentLoaded.
  function mount() {
    if (!host) build();
    if (host.isConnected) return;
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', () => { if (host) mount(); paint(); }, { once: true });
      return;
    }
    document.body.appendChild(host);
    host.style.display = hidden ? 'none' : 'block';
  }

  function render(state) {
    mount();
    session = state.session || null;
    if (session) view = view === 'picking' ? 'picking' : 'active';
    else if (view !== 'naming') view = 'idle';
    if (view !== 'naming') paint(); // keep the half-typed session name
    if (state.error) showError(state.error);
  }

  function setPicking(on) {
    if (session) { view = on ? 'picking' : 'active'; paint(); }
  }

  // Hidden while the picker's frozen screenshot is taken, so it is not in the crop.
  function setHidden(on) {
    hidden = on;
    if (host) host.style.display = on ? 'none' : 'block';
  }

  function showError(code) {
    if (!root) return;
    const box = root.getElementById('err');
    box.textContent = ERRORS[code] || `Lỗi: ${code}`;
    box.hidden = false;
    clearTimeout(errorTimer);
    errorTimer = setTimeout(() => { box.hidden = true; }, ERROR_MS);
  }

  // Removes the DOM only; the window listeners stay (they no-op without a host)
  // because re-adding them later would land behind the page's own listeners.
  function destroy() {
    clearTimeout(errorTimer);
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = root = session = null;
    view = 'idle';
    hidden = false;
  }

  GUARDED_EVENTS.forEach((type) => window.addEventListener(type, guard, true));
  window.addEventListener('resize', onResize);

  return { render, setPicking, setHidden, showError, destroy, getHost: () => host };
}
