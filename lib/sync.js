const db = require('./db');
const store = require('./store');
const config = require('./config');
const sheets = require('./sheets');

const DRAIN_INTERVAL = 15 * 1000;
const BATCH_LIMIT = 200;

let running = null;
let timer = null;

function start() {
  if (timer != null) {
    return;
  }
  timer = setInterval(() => {
    drain().catch(() => {});
  }, DRAIN_INTERVAL);
  timer.unref();
}

function isConfigured() {
  const current = config.getConfig();
  const key = typeof process.env.GOOGLE_SERVICE_ACCOUNT_JSON === 'string'
    ? process.env.GOOGLE_SERVICE_ACCOUNT_JSON.trim()
    : '';
  return current.spreadsheetId !== '' && key !== '';
}

function enqueue(kind, rowId) {
  if (!isConfigured()) {
    return;
  }
  db.getDatabase()
    .prepare('INSERT INTO sync_queue (kind, row_id, operation, created_at) VALUES (?, ?, ?, ?)')
    .run(kind, String(rowId), 'upsert', new Date().toISOString());
  setTimeout(() => {
    drain().catch(() => {});
  }, 1000).unref();
}

function drain() {
  if (running == null) {
    running = drainOnce().finally(() => {
      running = null;
    });
  }
  return running;
}

async function drainOnce() {
  if (!isConfigured()) {
    return { sent: 0, skipped: true };
  }
  const entries = db
    .getDatabase()
    .prepare('SELECT id, kind, row_id FROM sync_queue ORDER BY id LIMIT ?')
    .all(BATCH_LIMIT);
  if (entries.length === 0) {
    return { sent: 0, skipped: false };
  }
  const byKind = new Map();
  entries.forEach(entry => {
    if (!byKind.has(entry.kind)) {
      byKind.set(entry.kind, new Map());
    }
    const rows = byKind.get(entry.kind);
    const row = store.getRow(entry.kind, entry.row_id);
    if (row != null) {
      rows.set(entry.row_id, row);
    }
  });
  let sent = 0;
  try {
    for (const kind of db.KEYS) {
      const rows = byKind.get(kind);
      if (rows != null && rows.size > 0) {
        const result = await sheets.syncRows(kind, Array.from(rows.values()));
        sent += result.updated + result.appended;
      }
    }
  } catch (error) {
    db.writeMeta('sync_error', error.message);
    db.writeMeta('sync_error_at', new Date().toISOString());
    throw error;
  }
  const remove = db.getDatabase().prepare('DELETE FROM sync_queue WHERE id = ?');
  entries.forEach(x => {
    remove.run(x.id);
  });
  db.writeMeta('sync_pushed_at', new Date().toISOString());
  db.writeMeta('sync_error', '');
  return { sent, skipped: false };
}

async function pushAll() {
  requireConfigured();
  const data = {
    participants: store.getParticipants(),
    songs: store.getSongs(),
    likes: store.getLikes(),
  };
  const counts = {};
  for (const kind of db.KEYS) {
    await sheets.replaceSheet(kind, data[kind]);
    counts[kind] = data[kind].length;
  }
  db.getDatabase().exec('DELETE FROM sync_queue');
  db.writeMeta('sync_pushed_at', new Date().toISOString());
  db.writeMeta('sync_error', '');
  return counts;
}

async function pullAll() {
  requireConfigured();
  const counts = {};
  for (const kind of db.KEYS) {
    const rows = await sheets.readSheet(kind);
    rows.forEach((row, i) => {
      store.upsertRow(kind, row, { position: i + 1 });
    });
    counts[kind] = rows.length;
  }
  db.getDatabase().exec('DELETE FROM sync_queue');
  db.writeMeta('sync_pulled_at', new Date().toISOString());
  db.writeMeta('sync_error', '');
  return counts;
}

function getStatus() {
  const pending = db.getDatabase().prepare('SELECT count(*) AS total FROM sync_queue').get().total;
  return {
    configured: isConfigured(),
    pending,
    pushedAt: db.readMeta('sync_pushed_at', ''),
    pulledAt: db.readMeta('sync_pulled_at', ''),
    error: db.readMeta('sync_error', ''),
    errorAt: db.readMeta('sync_error_at', ''),
  };
}

function requireConfigured() {
  if (!isConfigured()) {
    throw new Error('Таблица не подключена: нужен SPREADSHEET_ID и ключ сервис-аккаунта');
  }
}

module.exports = { start, isConfigured, enqueue, drain, pushAll, pullAll, getStatus };
