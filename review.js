// Review page — loads one feedback session (?session=<id>, else the newest),
// shows its items and logs, and sends every edit to the background, which owns
// all writes through the store queue. Reads go straight to storage.local.
const store = createFeedbackStore();
const exporter = createFeedbackExporter(store);
const $ = (id) => document.getElementById(id);
const REFRESH_MS = 250;

let currentId = null;
let logs = [];
let logTab = 'console';
let refreshTimer = null;

const render = createReviewRender({
  loadShot: (shotKey) => store.getShot(shotKey),
  onSelect: (id) => openSession(id),
  onNote: (seq, note) => send('FEEDBACK_UPDATE_ITEM', { sessionId: currentId, seq, patch: { note } }),
  onKind: (seq, kind) => send('FEEDBACK_UPDATE_ITEM', { sessionId: currentId, seq, patch: { kind } }),
  onDeleteItem: (seq) => send('FEEDBACK_DELETE_ITEM', { sessionId: currentId, seq }),
  onZoom: (dataUrl) => { $('zoomImg').src = dataUrl; $('zoom').showModal(); },
});

async function send(type, payload) {
  try {
    const res = await chrome.runtime.sendMessage({ type, ...payload });
    if (res?.error || res?.ok === false) showStatus(`Lỗi: ${res.error || 'không lưu được'}`, true);
    return res;
  } catch (err) {
    showStatus(`Lỗi: ${err.message}`, true);
    return null;
  }
}

let statusTimer = null;
function showStatus(text, isError = false) {
  const box = $('status');
  box.textContent = text;
  box.classList.toggle('error', isError);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { box.textContent = ''; }, 4000);
}

function show(section) {
  for (const id of ['empty', 'gone', 'view']) $(id).hidden = id !== section;
  if (section !== 'view') document.title = 'Review feedback';
}

async function loadSidebar() {
  const sessions = await store.listSessions();
  render.renderSidebar($('sessionList'), sessions, currentId);
  return sessions;
}

async function loadSession() {
  const data = currentId ? await store.getSession(currentId) : null;
  if (!data) {
    render.clearItems($('items'));
    show('gone');
    return;
  }
  const { session, items } = data;
  logs = data.logs;
  document.title = `Review · ${session.name}`;
  render.renderHeader($('header'), session);
  render.renderItems($('items'), items);
  $('noItems').hidden = items.length > 0;
  renderLogs();
  show('view');
}

function renderLogs() {
  const counts = render.renderLogs($('logs'), logs, logTab);
  $('tabConsole').textContent = `Console errors (${counts.console})`;
  $('tabNetwork').textContent = `Network issues (${counts.network})`;
  for (const btn of document.querySelectorAll('.tab')) btn.classList.toggle('active', btn.dataset.tab === logTab);
}

async function openSession(id) {
  if (id !== currentId) {
    render.clearItems($('items'));
    currentId = id;
    const url = new URL(location.href);
    url.searchParams.set('session', id);
    history.replaceState(null, '', url);
    $('deleteSlot').replaceChildren(render.confirmButton('Xoá session', deleteSession));
  }
  await loadSidebar();
  await loadSession();
}

async function deleteSession() {
  const res = await send('FEEDBACK_DELETE_SESSION', { sessionId: currentId });
  if (!res?.ok) return;
  const sessions = await loadSidebar();
  if (sessions.length) openSession(sessions[0].id);
  else {
    currentId = null;
    history.replaceState(null, '', location.pathname);
    show('empty');
  }
}

async function runExport(button, action, doneText) {
  if (!currentId) return;
  button.disabled = true;
  try {
    const result = await action(currentId);
    showStatus(typeof doneText === 'function' ? doneText(result) : doneText);
  } catch (err) {
    showStatus(err.message === 'no-session' ? 'Session đã bị xoá.' : `Lỗi export: ${err.message}`, true);
  } finally {
    button.disabled = false;
  }
}

// Another tab adds items, a crop lands, or a session is deleted: refresh what shows.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  let needsRefresh = false;
  for (const [key, change] of Object.entries(changes)) {
    if (!key.startsWith('fb_')) continue;
    if (currentId && key.startsWith(`fb_shot_${currentId}_`) && change.newValue) render.refreshShot(key);
    else if (key === 'fb_index' || key.startsWith('fb_session_') || (currentId && key.startsWith(`fb_item_${currentId}_`))) needsRefresh = true;
  }
  if (!needsRefresh) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    loadSidebar().then(() => (currentId ? loadSession() : null))
      .catch((err) => console.error('Review refresh failed:', err));
  }, REFRESH_MS);
});

$('copyBtn').addEventListener('click', (e) => runExport(e.currentTarget, exporter.copyFeedbackMarkdown, 'Đã copy Markdown.'));
$('exportMdBtn').addEventListener('click', (e) => runExport(e.currentTarget, exporter.downloadFeedbackMd, (f) => `Đã tải ${f}`));
$('exportZipBtn').addEventListener('click', (e) => runExport(e.currentTarget, exporter.downloadFeedbackZip, (f) => `Đã tải ${f}`));
for (const btn of document.querySelectorAll('.tab')) {
  btn.addEventListener('click', () => { logTab = btn.dataset.tab; renderLogs(); });
}
$('zoom').addEventListener('click', () => $('zoom').close());

(async function init() {
  const sessions = await loadSidebar();
  const wanted = new URLSearchParams(location.search).get('session');
  if (wanted) return openSession(wanted); // a missing id shows "đã bị xoá"
  if (sessions.length) return openSession(sessions[0].id);
  show('empty');
})().catch((err) => {
  console.error('Review init failed:', err);
  showStatus(`Lỗi: ${err.message}`, true);
});
