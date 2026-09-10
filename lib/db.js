const pg = require('pg');
const reference = require('./reference');

const KEYS = ['participants', 'songs', 'likes'];

let pool = null;
let ready = null;

function getPool() {
  if (pool == null) {
    pool = new pg.Pool({ connectionString: connectionString(), max: 8 });
    pool.on('error', error => {
      console.error(`Ошибка соединения с базой: ${error.message}`);
    });
  }
  return pool;
}

function connectionString() {
  const value = typeof process.env.DATABASE_URL === 'string' ? process.env.DATABASE_URL.trim() : '';
  if (value === '') {
    throw new Error('Не задан DATABASE_URL: без него сайту негде хранить данные');
  }
  return value;
}

async function query(text, parameters) {
  await ensureSchema();
  return getPool().query(text, parameters);
}

function ensureSchema() {
  if (ready == null) {
    ready = createSchema().catch(error => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

async function createSchema() {
  const client = await getPool().connect();
  try {
    for (const key of KEYS) {
      const columns = reference.SHEET_HEADERS[key]
        .map(x => (x === 'id' ? 'id text PRIMARY KEY' : `${x} text NOT NULL DEFAULT ''`))
        .join(', ');
      await client.query(`CREATE TABLE IF NOT EXISTS ${key} (${columns}, position integer)`);
      await addMissingColumns(client, key);
    }
    await client.query('CREATE INDEX IF NOT EXISTS likes_song ON likes (song_id)');
    await client.query(`CREATE TABLE IF NOT EXISTS votes (
      device text NOT NULL,
      song_id text NOT NULL,
      created_at text NOT NULL,
      like_id text NOT NULL DEFAULT '',
      PRIMARY KEY (device, song_id)
    )`);
    await client.query("ALTER TABLE votes ADD COLUMN IF NOT EXISTS like_id text NOT NULL DEFAULT ''");
    await client.query(`CREATE TABLE IF NOT EXISTS sync_queue (
      id bigserial PRIMARY KEY,
      kind text NOT NULL,
      row_id text NOT NULL,
      operation text NOT NULL,
      created_at text NOT NULL
    )`);
    await client.query('CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text NOT NULL)');
    await client.query(`CREATE TABLE IF NOT EXISTS lineup (
      id text PRIMARY KEY,
      position integer NOT NULL,
      kind text NOT NULL,
      song_id text NOT NULL DEFAULT '',
      label text NOT NULL DEFAULT '',
      created_at text NOT NULL
    )`);
  } finally {
    client.release();
  }
}

async function addMissingColumns(client, key) {
  const result = await client.query(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1',
    [key],
  );
  const existing = result.rows.map(x => x.column_name);
  for (const column of reference.SHEET_HEADERS[key].concat(['position'])) {
    if (existing.indexOf(column) >= 0) {
      continue;
    }
    const definition = column === 'position' ? 'integer' : "text NOT NULL DEFAULT ''";
    await client.query(`ALTER TABLE ${key} ADD COLUMN ${column} ${definition}`);
  }
}

async function transaction(action) {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function readMeta(key, fallback) {
  const result = await query('SELECT value FROM meta WHERE key = $1', [key]);
  return result.rows.length === 0 ? fallback : result.rows[0].value;
}

async function writeMeta(key, value) {
  await query(
    'INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    [key, String(value)],
  );
}

module.exports = { query, transaction, readMeta, writeMeta, ensureSchema, KEYS };
