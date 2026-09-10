const fs = require('fs');
const path = require('path');
const sqlite = require('node:sqlite');
const reference = require('./reference');

const DATA_DIRECTORY = typeof process.env.DATA_DIR === 'string' && process.env.DATA_DIR.trim() !== ''
  ? path.resolve(process.env.DATA_DIR.trim())
  : path.join(__dirname, '..', 'data');
const DATABASE_FILE = path.join(DATA_DIRECTORY, 'guitarnik.sqlite');
const KEYS = ['participants', 'songs', 'likes'];

let database = null;

function getDatabase() {
  if (database == null) {
    fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
    database = new sqlite.DatabaseSync(DATABASE_FILE);
    database.exec('PRAGMA journal_mode = WAL');
    database.exec('PRAGMA foreign_keys = ON');
    createTables(database);
  }
  return database;
}

function createTables(db) {
  KEYS.forEach(key => {
    const columns = reference.SHEET_HEADERS[key]
      .map(x => (x === 'id' ? 'id TEXT PRIMARY KEY' : `${x} TEXT NOT NULL DEFAULT ''`))
      .join(', ');
    db.exec(`CREATE TABLE IF NOT EXISTS ${key} (${columns}, position INTEGER)`);
  });
  db.exec('CREATE INDEX IF NOT EXISTS likes_song ON likes (song_id)');
  db.exec(`CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    row_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
}

function readMeta(key, fallback) {
  const row = getDatabase().prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row == null ? fallback : row.value;
}

function writeMeta(key, value) {
  getDatabase()
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

module.exports = { getDatabase, readMeta, writeMeta, DATABASE_FILE, DATA_DIRECTORY, KEYS };
