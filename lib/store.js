const crypto = require('crypto');
const reference = require('./reference');
const db = require('./db');

const ID_PREFIXES = { participants: 'p_', songs: 's_', likes: 'l_' };

function getParticipants() {
  return readAll('participants');
}

function getSongs() {
  return readAll('songs');
}

function getLikes() {
  return readAll('likes');
}

function getRow(key, id) {
  const columns = reference.SHEET_HEADERS[key].join(', ');
  const row = db.getDatabase().prepare(`SELECT ${columns} FROM ${key} WHERE id = ?`).get(String(id));
  return row == null ? null : plain(row);
}

function insertRow(key, source, options) {
  const record = normalizeRecord(key, source);
  const settings = options == null ? {} : options;
  if (!record.id) {
    record.id = generateId(key);
  }
  if (!record.created_at) {
    record.created_at = new Date().toISOString();
  }
  applyDefaults(key, record);
  const headers = reference.SHEET_HEADERS[key];
  const values = headers.map(x => (record[x] == null ? '' : record[x]));
  const placeholders = headers.map(() => '?').join(', ');
  const position = settings.position == null ? nextPosition(key) : settings.position;
  db.getDatabase()
    .prepare(`INSERT INTO ${key} (${headers.join(', ')}, position) VALUES (${placeholders}, ?)`)
    .run(...values, position);
  return getRow(key, record.id);
}

function updateRow(key, id, patch) {
  const current = getRow(key, id);
  if (current == null) {
    return null;
  }
  const record = normalizeRecord(key, patch);
  delete record.id;
  const fields = Object.keys(record);
  if (fields.length === 0) {
    return current;
  }
  const assignments = fields.map(x => `${x} = ?`).join(', ');
  db.getDatabase()
    .prepare(`UPDATE ${key} SET ${assignments} WHERE id = ?`)
    .run(...fields.map(x => record[x]), String(id));
  return getRow(key, id);
}

function upsertRow(key, source, options) {
  const record = normalizeRecord(key, source);
  if (!record.id) {
    return insertRow(key, source, options);
  }
  const existing = getRow(key, record.id);
  if (existing == null) {
    return insertRow(key, source, options);
  }
  return updateRow(key, record.id, source);
}

function countRows(key) {
  return db.getDatabase().prepare(`SELECT count(*) AS total FROM ${key}`).get().total;
}

function readAll(key) {
  const columns = reference.SHEET_HEADERS[key].join(', ');
  return db
    .getDatabase()
    .prepare(`SELECT ${columns} FROM ${key} ORDER BY position, rowid`)
    .all()
    .map(x => plain(x));
}

function nextPosition(key) {
  const row = db.getDatabase().prepare(`SELECT max(position) AS top FROM ${key}`).get();
  return row == null || row.top == null ? 1 : row.top + 1;
}

function applyDefaults(key, record) {
  if (key !== 'songs') {
    return;
  }
  if (record.need_prompter == null || record.need_prompter === '') {
    record.need_prompter = 'TRUE';
  }
  if (record.show_on_projector == null || record.show_on_projector === '') {
    record.show_on_projector = 'TRUE';
  }
}

function normalizeRecord(key, source) {
  const record = {};
  if (source == null || typeof source !== 'object') {
    return record;
  }
  reference.SHEET_HEADERS[key].forEach(x => {
    if (Object.prototype.hasOwnProperty.call(source, x)) {
      record[x] = normalizeValue(source[x]);
    }
  });
  return record;
}

function normalizeValue(value) {
  if (value == null) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map(x => normalizeValue(x)).filter(x => x !== '').join(', ');
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  return String(value);
}

function plain(row) {
  const result = {};
  Object.keys(row).forEach(x => {
    result[x] = row[x] == null ? '' : String(row[x]);
  });
  return result;
}

function generateId(key) {
  return ID_PREFIXES[key] + crypto.randomBytes(6).toString('base64url').slice(0, 8);
}

module.exports = {
  getParticipants,
  getSongs,
  getLikes,
  getRow,
  insertRow,
  updateRow,
  upsertRow,
  countRows,
  normalizeValue,
};
