const db = require('./db');
const store = require('./store');
const config = require('./config');
const sheets = require('./sheets');

const DRAIN_INTERVAL = 15 * 1000;
const BATCH_LIMIT = 200;

let chain = Promise.resolve();
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
  return exclusive(() => drainOnce());
}

function pushAll() {
  return exclusive(() => pushAllRows());
}

function pullAll() {
  return exclusive(() => pullAllRows());
}

function exclusive(action) {
  const next = chain.then(action, action);
  chain = next.then(() => null, () => null);
  return next;
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
    const row = store.getRow(entry.kind, entry.row_id);
    if (row != null) {
      byKind.get(entry.kind).set(entry.row_id, row);
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
    rememberError(error);
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

async function pushAllRows() {
  requireConfigured();
  const lastQueued = queueTop();
  const data = {
    participants: store.getParticipants(),
    songs: store.getSongs(),
    likes: store.getLikes(),
  };
  const counts = {};
  try {
    for (const kind of db.KEYS) {
      await sheets.replaceSheet(kind, data[kind]);
      counts[kind] = data[kind].length;
    }
  } catch (error) {
    rememberError(error);
    throw error;
  }
  db.getDatabase().prepare('DELETE FROM sync_queue WHERE id <= ?').run(lastQueued);
  db.writeMeta('sync_pushed_at', new Date().toISOString());
  db.writeMeta('sync_error', '');
  return counts;
}

async function pullAllRows() {
  requireConfigured();
  if (queueSize() > 0) {
    await drainOnce();
    if (queueSize() > 0) {
      throw new Error('Сначала надо отправить в таблицу изменения, которые ждут очереди, а это пока не получается');
    }
  }
  const loaded = {};
  try {
    for (const kind of db.KEYS) {
      loaded[kind] = await sheets.readSheet(kind);
    }
  } catch (error) {
    rememberError(error);
    throw error;
  }
  const counts = {};
  const database = db.getDatabase();
  database.exec('BEGIN');
  try {
    db.KEYS.forEach(kind => {
      loaded[kind].forEach((row, i) => {
        store.upsertRow(kind, row, { position: i + 1 });
      });
      counts[kind] = loaded[kind].length;
    });
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  db.getDatabase().exec('DELETE FROM sync_queue');
  db.writeMeta('sync_pulled_at', new Date().toISOString());
  db.writeMeta('sync_error', '');
  return counts;
}

function getStatus() {
  return {
    configured: isConfigured(),
    pending: queueSize(),
    pushedAt: db.readMeta('sync_pushed_at', ''),
    pulledAt: db.readMeta('sync_pulled_at', ''),
    error: db.readMeta('sync_error', ''),
    errorAt: db.readMeta('sync_error_at', ''),
  };
}

function queueSize() {
  return db.getDatabase().prepare('SELECT count(*) AS total FROM sync_queue').get().total;
}

function queueTop() {
  const row = db.getDatabase().prepare('SELECT max(id) AS top FROM sync_queue').get();
  return row == null || row.top == null ? 0 : row.top;
}

function rememberError(error) {
  db.writeMeta('sync_error', error.message);
  db.writeMeta('sync_error_at', new Date().toISOString());
}

function requireConfigured() {
  if (!isConfigured()) {
    throw new Error('Таблица не подключена: нужен SPREADSHEET_ID и ключ сервис-аккаунта');
  }
}

module.exports = { start, isConfigured, enqueue, drain, pushAll, pullAll, getStatus };
