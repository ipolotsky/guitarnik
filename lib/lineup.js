const crypto = require('crypto');
const db = require('./db');

const PUBLISHED_KEY = 'lineup_published';
const SONG = 'song';
const BREAK = 'break';

async function getItems() {
  const result = await db.query('SELECT id, position, kind, song_id, label, created_at FROM lineup ORDER BY position, id');
  return result.rows.map(x => ({
    id: x.id,
    position: Number(x.position),
    kind: x.kind,
    songId: x.song_id == null ? '' : x.song_id,
    label: x.label == null ? '' : x.label,
    createdAt: x.created_at,
  }));
}

async function isPublished() {
  return (await db.readMeta(PUBLISHED_KEY, 'FALSE')) === 'TRUE';
}

async function setPublished(value) {
  await db.writeMeta(PUBLISHED_KEY, value ? 'TRUE' : 'FALSE');
}

async function addSong(songId) {
  const id = String(songId == null ? '' : songId).trim();
  if (id === '') {
    return null;
  }
  const existing = await db.query('SELECT id FROM lineup WHERE kind = $1 AND song_id = $2', [SONG, id]);
  if (existing.rows.length > 0) {
    return null;
  }
  return insert(SONG, id, '');
}

async function addBreak(label) {
  const text = String(label == null ? '' : label).trim();
  return insert(BREAK, '', text === '' ? 'Перерыв' : text.slice(0, 120));
}

async function insert(kind, songId, label) {
  const result = await db.query('SELECT max(position) AS top FROM lineup');
  const top = result.rows[0].top == null ? 0 : Number(result.rows[0].top);
  const id = `n_${crypto.randomBytes(6).toString('base64url').slice(0, 8)}`;
  await db.query(
    'INSERT INTO lineup (id, position, kind, song_id, label, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, top + 1, kind, songId, label, new Date().toISOString()],
  );
  return id;
}

async function remove(id) {
  await db.query('DELETE FROM lineup WHERE id = $1', [String(id)]);
}

async function move(id, direction) {
  const items = await getItems();
  const index = items.findIndex(x => x.id === String(id));
  if (index < 0) {
    return;
  }
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= items.length) {
    return;
  }
  const swapped = items.slice();
  swapped[index] = items[target];
  swapped[target] = items[index];
  await applyOrder(swapped.map(x => x.id));
}

async function applyOrder(ids) {
  await db.transaction(async client => {
    for (let i = 0; i < ids.length; i += 1) {
      await client.query('UPDATE lineup SET position = $1 WHERE id = $2', [i + 1, String(ids[i])]);
    }
  });
}

async function clear() {
  await db.query('DELETE FROM lineup');
}

async function fillFromSongs(songIds) {
  await clear();
  for (const songId of songIds) {
    await addSong(songId);
  }
}

module.exports = {
  SONG,
  BREAK,
  getItems,
  isPublished,
  setPublished,
  addSong,
  addBreak,
  remove,
  move,
  applyOrder,
  clear,
  fillFromSongs,
};
