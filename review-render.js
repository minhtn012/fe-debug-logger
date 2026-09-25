// Review render — DOM builders for the review page. Every string that came from
// a page (note, selector, element text, log message, session name) goes through
// textContent, never innerHTML. Item cards are keyed by seq and patched in place,
// so a storage refresh never wipes a note being typed or reloads a screenshot.
// eslint-disable-next-line no-unused-vars
function createReviewRender({ loadShot, onSelect, onNote, onKind, onDeleteItem, onZoom }) {
  const CONFIRM_MS = 3000;
  const cards = new Map(); // seq -> { root, fields }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      fillShot(entry.target);
    }
  }, { rootMargin: '400px' });

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'text') node.textContent = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node[k] = v;
    }
    for (const child of children) if (child) node.append(child);
    return node;
  }

  function formatDateTime(iso) {
    const d = new Date(iso);
    return !iso || isNaN(d) ? '?' : d.toLocaleString('vi-VN', { hour12: false });
  }

  // Two-step delete inside the page: first click arms, second click acts.
  function confirmButton(label, action) {
    let timer = null;
    const btn = el('button', { className: 'btn btn-danger', text: label, type: 'button' });
    btn.addEventListener('click', () => {
      if (!timer) {
        btn.textContent = 'Chắc chắn?';
        btn.classList.add('armed');
        timer = setTimeout(() => { timer = null; btn.textContent = label; btn.classList.remove('armed'); }, CONFIRM_MS);
        return;
      }
      clearTimeout(timer);
      timer = null;
      btn.disabled = true;
      action();
    });
    return btn;
  }

  function renderSidebar(container, sessions, currentId) {
    container.replaceChildren(...sessions.map((s) => el('button', {
      type: 'button',
      className: 'session' + (s.id === currentId ? ' current' : ''),
      title: s.origin,
      onclick: () => onSelect(s.id),
    }, [
      el('span', { className: 'session-name', text: s.name }),
      s.finishedAt ? null : el('span', { className: 'live-dot', title: 'Đang chạy' }),
      el('span', { className: 'session-sub', text: `${hostOf(s.origin)} · ${s.itemKeys.length} item` }),
    ])));
  }

  function hostOf(origin) {
    try { return new URL(origin).host; } catch (_) { return origin || '?'; }
  }

  function renderHeader(container, session) {
    const status = session.finishedAt ? `Kết thúc ${formatDateTime(session.finishedAt)}` : 'Đang chạy';
    container.replaceChildren(
      el('h1', { text: session.name }),
      el('div', { className: 'muted', text: `${session.origin} · Bắt đầu ${formatDateTime(session.startedAt)} · ${status} · ${session.itemKeys.length} item` }),
    );
  }

  function fillShot(frame) {
    const shotKey = frame.dataset.shotKey;
    loadShot(shotKey).then((dataUrl) => {
      frame.replaceChildren(dataUrl
        ? el('img', { src: dataUrl, alt: 'Ảnh element', title: 'Bấm để xem cỡ thật', onclick: () => onZoom(dataUrl) })
        : el('span', { className: 'muted', text: 'Chưa có ảnh' }));
      frame.dataset.loaded = dataUrl ? '1' : '';
    }).catch(() => frame.replaceChildren(el('span', { className: 'muted', text: 'Không đọc được ảnh' })));
  }

  function buildCard(item) {
    const shot = el('div', { className: 'shot', dataset: { shotKey: item.shotKey } }, [el('span', { className: 'muted', text: 'Đang tải ảnh…' })]);
    const title = el('strong');
    const kind = el('select', { onchange: () => onKind(item.seq, kind.value) }, [
      el('option', { value: 'bug', text: 'Bug' }),
      el('option', { value: 'suggestion', text: 'Góp ý' }),
    ]);
    const note = el('textarea', { rows: 4, placeholder: 'Ghi chú' });
    const noteError = el('div', { className: 'error', hidden: true, text: 'Ghi chú không được để trống — chưa lưu.' });
    const meta = el('div', { className: 'item-meta' });
    const root = el('article', { className: 'item' }, [
      el('header', {}, [title, kind, el('span', { className: 'spacer' }), confirmButton('Xoá', () => onDeleteItem(item.seq))]),
      el('div', { className: 'item-body' }, [shot, el('div', { className: 'item-main' }, [note, noteError, meta])]),
    ]);
    bindNote(item.seq, note, noteError);
    observer.observe(shot);
    return { root, fields: { title, kind, note, meta, shot } };
  }

  // Saves on blur or after 800 ms without typing; an empty note is never sent.
  function bindNote(seq, note, noteError) {
    let timer = null;
    let saved = null;
    const save = () => {
      clearTimeout(timer);
      const value = note.value.trim();
      noteError.hidden = !!value;
      if (!value || value === saved) return;
      saved = value;
      onNote(seq, value);
    };
    note.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(save, 800); });
    note.addEventListener('blur', save);
    note._markSaved = (v) => { saved = v; };
  }

  function patchCard({ fields }, item, index) {
    fields.title.textContent = `Item ${index + 1}`;
    if (document.activeElement !== fields.kind) fields.kind.value = item.kind === 'suggestion' ? 'suggestion' : 'bug';
    if (document.activeElement !== fields.note) {
      fields.note.value = item.note || '';
      fields.note._markSaved((item.note || '').trim());
    }
    fields.meta.replaceChildren(...[
      item.selector ? el('code', { text: item.selector }) : null,
      item.elementText ? el('span', { text: `"${String(item.elementText).replace(/\s+/g, ' ').trim().slice(0, 120)}"` }) : null,
      el('a', { href: item.url || '#', target: '_blank', rel: 'noopener', text: item.url || '?' }),
      el('span', { className: 'muted', text: formatDateTime(item.ts) }),
      item.domChangedAfterFreeze ? el('span', { className: 'warn', text: 'DOM đã đổi sau khi đóng băng — ảnh là trạng thái lúc chọn' }) : null,
    ].filter(Boolean));
  }

  function renderItems(container, items) {
    const seqs = new Set(items.map((i) => i.seq));
    for (const [seq, card] of cards) {
      if (!seqs.has(seq)) { observer.unobserve(card.fields.shot); card.root.remove(); cards.delete(seq); }
    }
    items.forEach((item, index) => {
      if (!cards.has(item.seq)) cards.set(item.seq, buildCard(item));
      const card = cards.get(item.seq);
      patchCard(card, item, index);
      // Insert only when out of place: moving a node blurs the note being typed.
      const at = container.children[index];
      if (at !== card.root) container.insertBefore(card.root, at || null);
    });
  }

  // A crop that lands after the card rendered: reload that one frame.
  function refreshShot(shotKey) {
    for (const { fields } of cards.values()) {
      if (fields.shot.dataset.shotKey === shotKey && !fields.shot.dataset.loaded) fillShot(fields.shot);
    }
  }

  function clearItems(container) {
    for (const card of cards.values()) observer.unobserve(card.fields.shot);
    cards.clear();
    container.replaceChildren();
  }

  function logRow(cells) {
    return el('tr', {}, cells.map((c) => el('td', { text: c == null ? '' : String(c) })));
  }

  function renderLogs(container, logs, tab) {
    const consoleLogs = logs.filter((l) => l.category === 'console');
    const networkLogs = logs.filter((l) => l.category === 'network');
    const time = (l) => (l.timestamp ? new Date(l.timestamp).toLocaleTimeString('vi-VN', { hour12: false }) : '?');
    const rows = tab === 'network'
      ? networkLogs.map((l) => logRow([time(l), l.method || 'GET', l.url, l.status === 0 ? 'Network Error' : l.status, l.duration != null ? `${l.duration} ms` : '']))
      : consoleLogs.map((l) => logRow([time(l), l.type, l.repeatCount > 1 ? `${l.message} (×${l.repeatCount})` : l.message]));
    const head = tab === 'network' ? ['Giờ', 'Method', 'URL', 'Status', 'Thời lượng'] : ['Giờ', 'Loại', 'Message'];
    container.replaceChildren(rows.length
      ? el('table', {}, [el('thead', {}, [el('tr', {}, head.map((h) => el('th', { text: h })))]), el('tbody', {}, rows)])
      : el('p', { className: 'muted', text: 'Không có mục nào.' }));
    return { console: consoleLogs.length, network: networkLogs.length };
  }

  return { el, confirmButton, renderSidebar, renderHeader, renderItems, refreshShot, clearItems, renderLogs };
}
