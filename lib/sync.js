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
  db.query(
    'INSERT INTO sync_queue (kind, row_id, operation, created_at) VALUES ($1, $2, $3, $4)',
    [kind, String(rowId), 'upsert', new Date().toISOString()],
  )
    .then(() => {
      setTimeout(() => {
        drain().catch(() => {});
      }, 1000).unref();
    })
    .catch(error => {
      console.error(`Не получилось поставить запись в очередь синхронизации: ${error.message}`);
    });
}

function forget(kind, rowId) {
  db.query('DELETE FROM sync_queue WHERE kind = $1 AND row_id = $2', [kind, String(rowId)]).catch(() => {});
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
  const queued = await db.query('SELECT id, kind, row_id FROM sync_queue ORDER BY id LIMIT $1', [BATCH_LIMIT]);
  const entries = queued.rows;
  if (entries.length === 0) {
    return { sent: 0, skipped: false };
  }
  const byKind = new Map();
  for (const entry of entries) {
    if (!byKind.has(entry.kind)) {
      byKind.set(entry.kind, new Map());
    }
    const row = await store.getRow(entry.kind, entry.row_id);
    if (row != null) {
      byKind.get(entry.kind).set(entry.row_id, row);
    }
  }
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
    await rememberError(error);
    throw error;
  }
  await db.query('DELETE FROM sync_queue WHERE id = ANY($1)', [entries.map(x => x.id)]);
  await db.writeMeta('sync_pushed_at', new Date().toISOString());
  await db.writeMeta('sync_error', '');
  return { sent, skipped: false };
}

async function pushAllRows() {
  requireConfigured();
  const lastQueued = await queueTop();
  const data = {
    participants: await store.getParticipants(),
    songs: await store.getSongs(),
    likes: await store.getLikes(),
  };
  const counts = {};
  try {
    for (const kind of db.KEYS) {
      await sheets.replaceSheet(kind, data[kind]);
      counts[kind] = data[kind].length;
    }
  } catch (error) {
    await rememberError(error);
    throw error;
  }
  await db.query('DELETE FROM sync_queue WHERE id <= $1', [lastQueued]);
  await db.writeMeta('sync_pushed_at', new Date().toISOString());
  await db.writeMeta('sync_error', '');
  return counts;
}

async function pullAllRows() {
  requireConfigured();
  if (await queueSize() > 0) {
    await drainOnce();
    if (await queueSize() > 0) {
      throw new Error('Сначала надо отправить в таблицу изменения, которые ждут очереди, а это пока не получается');
    }
  }
  const loaded = {};
  try {
    for (const kind of db.KEYS) {
      loaded[kind] = await sheets.readSheet(kind);
    }
  } catch (error) {
    await rememberError(error);
    throw error;
  }
  const counts = {};
  for (const kind of db.KEYS) {
    for (let i = 0; i < loaded[kind].length; i += 1) {
      await store.upsertRow(kind, loaded[kind][i], { position: i + 1 });
    }
    counts[kind] = loaded[kind].length;
  }
  await db.query('DELETE FROM sync_queue');
  await db.writeMeta('sync_pulled_at', new Date().toISOString());
  await db.writeMeta('sync_error', '');
  return counts;
}

async function getStatus() {
  return {
    configured: isConfigured(),
    pending: await queueSize(),
    pushedAt: await db.readMeta('sync_pushed_at', ''),
    pulledAt: await db.readMeta('sync_pulled_at', ''),
    error: await db.readMeta('sync_error', ''),
    errorAt: await db.readMeta('sync_error_at', ''),
  };
}

async function queueSize() {
  const result = await db.query('SELECT count(*)::int AS total FROM sync_queue');
  return result.rows[0].total;
}

async function queueTop() {
  const result = await db.query('SELECT max(id) AS top FROM sync_queue');
  return result.rows[0].top == null ? 0 : Number(result.rows[0].top);
}

async function rememberError(error) {
  await db.writeMeta('sync_error', error.message);
  await db.writeMeta('sync_error_at', new Date().toISOString());
}

function requireConfigured() {
  if (!isConfigured()) {
    throw new Error('Таблица не подключена: нужен SPREADSHEET_ID и ключ сервис-аккаунта');
  }
}

module.exports = { start, isConfigured, enqueue, forget, drain, pushAll, pullAll, getStatus };
