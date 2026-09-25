// Feedback store — named feedback sessions per origin, kept in storage.local so a
// service worker restart or a page reload loses nothing. Reads name exact keys
// (never get(null): screenshots would all land in SW memory). Every write goes
// through one Promise queue so concurrent messages cannot clobber itemSeq/itemKeys.
// eslint-disable-next-line no-unused-vars
function createFeedbackStore() {
  const MAX_ITEMS = 50;
  const MAX_LOGS = 500;
  const [SITES, ACTIVE, INDEX] = ['fb_sites', 'fb_active', 'fb_index'];
  const local = chrome.storage.local;

  const sessionKey = (id) => `fb_session_${id}`;
  const itemKey = (id, seq) => `fb_item_${id}_${seq}`;
  const shotKeyOf = (id, seq) => `fb_shot_${id}_${seq}`;
  const logKey = (id, seq) => `fb_log_${id}_${seq}`;

  let queue = Promise.resolve();
  function enqueue(fn) {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  }

  const getOne = async (key, fallback) => (await local.get([key]))[key] ?? fallback;

  const summary = (s) => (s ? { id: s.id, name: s.name, itemCount: s.itemKeys.length } : null);

  async function activeSession(origin) {
    const active = await getOne(ACTIVE, {});
    return active[origin] ? getOne(sessionKey(active[origin]), null) : null;
  }

  async function getStatus(origin) {
    const sites = await getOne(SITES, []);
    return { siteEnabled: sites.includes(origin), session: summary(await activeSession(origin)) };
  }

  const hasActiveSession = async () => Object.keys(await getOne(ACTIVE, {})).length > 0;

  async function finishUnqueued(origin) {
    const active = await getOne(ACTIVE, {});
    const id = active[origin];
    if (!id) return null;
    delete active[origin];
    const session = await getOne(sessionKey(id), null);
    const writes = { [ACTIVE]: active };
    if (session) writes[sessionKey(id)] = { ...session, finishedAt: new Date().toISOString() };
    await local.set(writes);
    return session ? writes[sessionKey(id)] : null;
  }

  const finishSession = (origin) => enqueue(() => finishUnqueued(origin));

  // Turning a site off finishes its live session first: never leave one orphaned.
  const toggleSite = (origin) => enqueue(async () => {
    const sites = await getOne(SITES, []);
    const enabled = !sites.includes(origin);
    const finished = enabled ? null : await finishUnqueued(origin);
    await local.set({ [SITES]: enabled ? [...sites, origin] : sites.filter((o) => o !== origin) });
    return { enabled, finished };
  });

  const startSession = (origin, name) => enqueue(async () => {
    const sites = await getOne(SITES, []);
    if (!sites.includes(origin)) return { error: 'site-disabled' };
    const existing = await activeSession(origin);
    if (existing) return { session: existing }; // second tab raced the first: reuse
    const id = Date.now().toString(36);
    const session = {
      id, name: String(name || '').trim() || id, origin,
      startedAt: new Date().toISOString(), finishedAt: null,
      itemSeq: 0, logSeq: 0, itemKeys: [], logCount: 0, pages: [], meta: {}, dedup: {},
    };
    const active = await getOne(ACTIVE, {});
    const index = await getOne(INDEX, []);
    await local.set({ [sessionKey(id)]: session, [ACTIVE]: { ...active, [origin]: id }, [INDEX]: [...index, id] });
    return { session };
  });

  const addItem = (id, item) => enqueue(async () => {
    const session = await getOne(sessionKey(id), null);
    if (!session) return { error: 'no-session' };
    if (session.itemKeys.length >= MAX_ITEMS) return { error: 'item-cap' };
    const seq = session.itemSeq;
    const shotKey = shotKeyOf(id, seq);
    const key = itemKey(id, seq);
    const record = { ...item, seq, shotKey, ts: item.ts || new Date().toISOString() };
    const updated = { ...session, itemSeq: seq + 1, itemKeys: [...session.itemKeys, key] };
    await local.set({ [key]: record, [sessionKey(id)]: updated });
    return { seq, shotKey, session: updated };
  });

  // A crop can land after its item or session was deleted: drop it then.
  const setShot = (shotKey, dataUrl) => enqueue(async () => {
    const match = /^fb_shot_([^_]+)_(\d+)$/.exec(shotKey || '');
    if (!match) return false;
    const session = await getOne(sessionKey(match[1]), null);
    if (!session || !session.itemKeys.includes(itemKey(match[1], match[2]))) return false;
    await local.set({ [shotKey]: { dataUrl } });
    return true;
  });

  // Repeats of a deduped console message update the first entry in place, like Record.
  const addLog = (id, entry) => enqueue(async () => {
    const session = await getOne(sessionKey(id), null);
    if (!session) return false;
    const existing = entry.dedupKey && entry.repeatCount > 1 ? session.dedup[entry.dedupKey] : null;
    if (existing) {
      const prev = await getOne(existing, null);
      if (prev) await local.set({ [existing]: { ...prev, repeatCount: entry.repeatCount, lastTimestamp: entry.timestamp } });
      return true;
    }
    if (session.logCount > MAX_LOGS) return false;
    const seq = session.logSeq;
    const key = logKey(id, seq);
    const record = session.logCount === MAX_LOGS
      ? { category: 'console', type: 'error', message: `[fe-feedback] Log limit (${MAX_LOGS}) reached — further entries dropped.`, timestamp: new Date().toISOString() }
      : entry;
    const dedup = entry.dedupKey && record === entry ? { ...session.dedup, [entry.dedupKey]: key } : session.dedup;
    await local.set({
      [key]: { ...record, _key: key, _seq: seq },
      [sessionKey(id)]: { ...session, logSeq: seq + 1, logCount: session.logCount + 1, dedup },
    });
    return true;
  });

  // First reporter fills userAgent/viewport; pages keep first-visit order, no repeats.
  const addPage = (id, url, meta = {}) => enqueue(async () => {
    const session = await getOne(sessionKey(id), null);
    if (!session) return false;
    const pages = url && !session.pages.includes(url) ? [...session.pages, url] : session.pages;
    const merged = { userAgent: session.meta.userAgent || meta.userAgent || '', viewport: session.meta.viewport || meta.viewport || '' };
    await local.set({ [sessionKey(id)]: { ...session, pages, meta: merged } });
    return true;
  });

  async function listSessions() {
    const index = await getOne(INDEX, []);
    if (!index.length) return [];
    const data = await local.get(index.map(sessionKey));
    return index.map((id) => data[sessionKey(id)]).filter(Boolean).reverse();
  }

  // Session + items + logs; screenshots are read one by one with getShot.
  async function getSession(id) {
    const session = await getOne(sessionKey(id), null);
    if (!session) return null;
    const logKeys = Array.from({ length: session.logSeq }, (_, seq) => logKey(id, seq));
    const data = await local.get([...session.itemKeys, ...logKeys]);
    return {
      session,
      items: session.itemKeys.map((k) => data[k]).filter(Boolean),
      logs: logKeys.map((k) => data[k]).filter(Boolean),
    };
  }

  const getShot = async (shotKey) => (await getOne(shotKey, null))?.dataUrl || null;

  const updateItem = (id, seq, patch) => enqueue(async () => {
    const key = itemKey(id, seq);
    const item = await getOne(key, null);
    if (!item) return false;
    const next = { ...item };
    if (typeof patch?.note === 'string') next.note = patch.note;
    if (patch?.kind === 'bug' || patch?.kind === 'suggestion') next.kind = patch.kind;
    await local.set({ [key]: next });
    return true;
  });

  const deleteItem = (id, seq) => enqueue(async () => {
    const session = await getOne(sessionKey(id), null);
    if (!session) return null;
    const key = itemKey(id, seq);
    const updated = { ...session, itemKeys: session.itemKeys.filter((k) => k !== key) };
    await local.set({ [sessionKey(id)]: updated });
    await local.remove([key, shotKeyOf(id, seq)]);
    return updated;
  });

  const deleteSession = (id) => enqueue(async () => {
    const session = await getOne(sessionKey(id), null);
    const index = await getOne(INDEX, []);
    const active = await getOne(ACTIVE, {});
    const origin = Object.keys(active).find((o) => active[o] === id);
    if (origin) delete active[origin];
    await local.set({ [INDEX]: index.filter((x) => x !== id), [ACTIVE]: active });
    if (!session) return { origin: origin || null };
    const seqs = Array.from({ length: session.itemSeq }, (_, seq) => seq);
    const logKeys = Array.from({ length: session.logSeq }, (_, seq) => logKey(id, seq));
    await local.remove([sessionKey(id), ...seqs.map((s) => itemKey(id, s)), ...seqs.map((s) => shotKeyOf(id, s)), ...logKeys]);
    return { origin: session.origin };
  });

  return {
    toggleSite, getStatus, hasActiveSession, startSession, addItem, setShot,
    addLog, addPage, finishSession, listSessions, getSession, getShot, updateItem, deleteItem,
    deleteSession, MAX_ITEMS,
  };
}
