// Feedback formatter — turns one feedback session into the debug-log.md that the
// ZIP export carries. Console and network sections reuse markdown-formatter.js
// (loaded first), so MCP readers see the same layout as a Record export.
// eslint-disable-next-line no-unused-vars
function formatFeedbackMarkdown({ session, items, logs, shotNames }) {
  const sections = [formatFeedbackHeader(session, items)];

  const itemSection = formatFeedbackItems(items, shotNames || {});
  if (itemSection) sections.push(itemSection);

  const consoleSection = formatConsoleErrors((logs || []).filter((e) => e.category === 'console'));
  if (consoleSection) sections.push(consoleSection);

  const networkSection = formatNetworkIssues((logs || []).filter((e) => e.category === 'network'));
  if (networkSection) sections.push(networkSection);

  return sections.map((s) => s.trimEnd()).join('\n\n---\n\n') + '\n';
}

// Screenshot filename per item seq, numbered in display order; items whose crop
// never landed get none, so the ZIP holds no empty file for them.
// eslint-disable-next-line no-unused-vars
function feedbackShotNames(items, hasShot) {
  const names = {};
  items.forEach((item, i) => {
    if (hasShot(item)) names[item.seq] = `item-${String(i + 1).padStart(3, '0')}.png`;
  });
  return names;
}

// fe-debug-feedback-<host>-<slug>-<timestamp>: matches the MCP server's
// fe-debug-<domain>-<timestamp>.zip pattern and its url filter (dots → dashes).
// eslint-disable-next-line no-unused-vars
function feedbackExportBaseName(session, now = new Date()) {
  let host = 'unknown';
  try { host = new URL(session.origin).hostname.replace(/\./g, '-'); } catch (_) { /* keep unknown */ }
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `fe-debug-feedback-${host}-${feedbackSlug(session.name)}-${timestamp}`;
}

function feedbackSlug(name) {
  const slug = String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || 'session';
}

function formatFeedbackHeader(session, items) {
  const bugs = items.filter((i) => i.kind !== 'suggestion').length;
  const end = session.finishedAt ? formatDateTime(session.finishedAt) : 'Đang chạy';
  const pages = [...new Set([...(session.pages || []), ...items.map((i) => i.url).filter(Boolean)])];

  let md = `# Feedback: ${session.name}\n\n`;
  md += `- Site: ${session.origin} · Bắt đầu ${formatDateTime(session.startedAt)} · Kết thúc ${end}`;
  md += ` · ${items.length} item (${bugs} bug, ${items.length - bugs} góp ý)\n`;
  const meta = session.meta || {};
  if (meta.userAgent || meta.viewport) {
    md += `- Trình duyệt: ${browserName(meta.userAgent)} · Viewport: ${meta.viewport || '?'}\n`;
  }
  md += '- Trang:\n';
  md += pages.length ? pages.map((p) => `  - ${p}\n`).join('') : '  - (không có)\n';
  return md.trimEnd();
}

function formatFeedbackItems(items, shotNames) {
  if (!items.length) return null;
  let md = `## Items (${items.length})\n`;
  items.forEach((item, i) => {
    const note = String(item.note || '').trim();
    const title = note.split('\n')[0].slice(0, 80) || '(không có ghi chú)';
    md += `\n### ${i + 1}. [${item.kind === 'suggestion' ? 'Góp ý' : 'Bug'}] ${title}\n`;
    md += `- Trang: ${item.url || '?'} · Lúc: ${formatDateTime(item.ts)}\n`;
    if (item.selector) {
      const text = oneLine(item.elementText);
      md += `- Element: \`${item.selector}\`${text ? ` — "${text}"` : ''}\n`;
    }
    const shot = shotNames[item.seq];
    if (shot) md += `- Ảnh: ![${shot.replace(/\.png$/, '')}](screenshots/${shot})\n`;
    if (item.domChangedAfterFreeze) md += '- (DOM đã đổi sau khi đóng băng — ảnh là trạng thái lúc chọn)\n';
    if (note) md += '- Ghi chú:\n\n' + note.split('\n').map((line) => `> ${line}`).join('\n') + '\n';
  });
  return md.trimEnd();
}

function oneLine(str) {
  return String(str || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function browserName(ua) {
  const match = (ua || '').match(/(Edg|Chrome|Firefox|Safari)\/(\d+[\d.]*)/);
  return match ? `${match[1] === 'Edg' ? 'Edge' : match[1]} ${match[2]}` : (ua || '?').slice(0, 60);
}

function formatDateTime(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return '?';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
