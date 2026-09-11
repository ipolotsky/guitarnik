const crypto = require('crypto');
const reference = require('./reference');
const db = require('./db');

const ID_PREFIXES = { participants: 'p_', songs: 's_', likes: 'l_' };

async function getParticipants() {
  return readAll('participants');
}

async function getSongs() {
  return readAll('songs');
}

async function getLikes() {
  return readAll('likes');
}

async function getRow(key, id) {
  const columns = reference.SHEET_HEADERS[key].join(', ');
  const result = await db.query(`SELECT ${columns} FROM ${key} WHERE id = $1`, [String(id)]);
  return result.rows.length === 0 ? null : plain(result.rows[0]);
}

async function insertRow(key, source, options) {
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
  const position = settings.position == null ? await nextPosition(key) : settings.position;
  const placeholders = headers.map((x, i) => `$${i + 1}`).join(', ');
  await db.query(
    `INSERT INTO ${key} (${headers.join(', ')}, position) VALUES (${placeholders}, $${headers.length + 1})`,
    values.concat([position]),
  );
  return getRow(key, record.id);
}

async function updateRow(key, id, patch, options) {
  const current = await getRow(key, id);
  if (current == null) {
    return null;
  }
  const record = normalizeRecord(key, patch);
  delete record.id;
  const settings = options == null ? {} : options;
  if (settings.position != null) {
    record.position = settings.position;
  }
  const fields = Object.keys(record);
  if (fields.length === 0) {
    return current;
  }
  const assignments = fields.map((x, i) => `${x} = $${i + 1}`).join(', ');
  await db.query(
    `UPDATE ${key} SET ${assignments} WHERE id = $${fields.length + 1}`,
    fields.map(x => record[x]).concat([String(id)]),
  );
  return getRow(key, id);
}

async function upsertRow(key, source, options) {
  const record = normalizeRecord(key, source);
  if (!record.id) {
    return insertRow(key, source, options);
  }
  const existing = await getRow(key, record.id);
  if (existing == null) {
    return insertRow(key, source, options);
  }
  return updateRow(key, record.id, source, options);
}

async function deleteRow(key, id) {
  await db.query(`DELETE FROM ${key} WHERE id = $1`, [String(id)]);
}

async function deleteSong(id) {
  const songId = String(id);
  return db.transaction(async client => {
    const likes = await client.query('SELECT id FROM likes WHERE song_id = $1', [songId]);
    await client.query('DELETE FROM votes WHERE song_id = $1', [songId]);
    await client.query('DELETE FROM likes WHERE song_id = $1', [songId]);
    await client.query('DELETE FROM lineup WHERE song_id = $1', [songId]);
    await client.query('DELETE FROM songs WHERE id = $1', [songId]);
    return likes.rows.map(x => x.id);
  });
}

async function listVotes(device) {
  const id = String(device == null ? '' : device);
  if (id === '') {
    return new Set();
  }
  const result = await db.query('SELECT song_id FROM votes WHERE device = $1', [id]);
  return new Set(result.rows.map(x => x.song_id));
}

async function hasVote(device, songId) {
  const id = String(device == null ? '' : device);
  if (id === '') {
    return false;
  }
  const result = await db.query('SELECT 1 FROM votes WHERE device = $1 AND song_id = $2', [id, String(songId)]);
  return result.rows.length > 0;
}

async function claimVote(device, songId) {
  const id = String(device == null ? '' : device);
  if (id === '') {
    return false;
  }
  const result = await db.query(
    `INSERT INTO votes (device, song_id, created_at, like_id) VALUES ($1, $2, $3, '')
     ON CONFLICT (device, song_id) DO UPDATE SET created_at = excluded.created_at
     WHERE votes.like_id = '' RETURNING device`,
    [id, String(songId), new Date().toISOString()],
  );
  return result.rows.length > 0;
}

async function attachLike(device, songId, likeId) {
  const id = String(device == null ? '' : device);
  if (id === '') {
    return;
  }
  await db.query(
    'UPDATE votes SET like_id = $1 WHERE device = $2 AND song_id = $3',
    [String(likeId == null ? '' : likeId), id, String(songId)],
  );
}

async function claimWish(songId, performers, status) {
  const result = await db.query(
    `UPDATE songs SET performers = $1, status = $2
     WHERE id = $3 AND coalesce(trim(performers), '') = '' RETURNING id`,
    [String(performers), String(status), String(songId)],
  );
  return result.rows.length > 0;
}

async function takeVote(device, songId) {
  const id = String(device == null ? '' : device);
  if (id === '') {
    return null;
  }
  const result = await db.query(
    'DELETE FROM votes WHERE device = $1 AND song_id = $2 RETURNING like_id',
    [id, String(songId)],
  );
  return result.rows.length === 0 ? null : result.rows[0].like_id;
}

async function allVotes() {
  const result = await db.query('SELECT device, song_id, created_at, like_id FROM votes ORDER BY created_at');
  return result.rows.map(x => plain(x));
}

async function countRows(key) {
  const result = await db.query(`SELECT count(*)::int AS total FROM ${key}`);
  return result.rows[0].total;
}

async function readAll(key) {
  const columns = reference.SHEET_HEADERS[key].join(', ');
  const result = await db.query(`SELECT ${columns} FROM ${key} ORDER BY position NULLS LAST, id`);
  return result.rows.map(x => plain(x));
}

async function nextPosition(key) {
  const result = await db.query(`SELECT max(position) AS top FROM ${key}`);
  const top = result.rows[0].top;
  return top == null ? 1 : Number(top) + 1;
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
      record[x] = x === 'id' ? normalizeValue(source[x]).trim() : normalizeValue(source[x]);
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
  deleteRow,
  deleteSong,
  listVotes,
  hasVote,
  claimVote,
  attachLike,
  claimWish,
  takeVote,
  allVotes,
  countRows,
  normalizeValue,
};
