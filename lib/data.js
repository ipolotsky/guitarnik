const store = require('./store');
const sync = require('./sync');

async function getParticipants() {
  return store.getParticipants();
}

async function getSongs() {
  return store.getSongs();
}

async function getLikes() {
  return store.getLikes();
}

async function addParticipant(object) {
  return created('participants', await store.insertRow('participants', object));
}

async function addSong(object) {
  return created('songs', await store.insertRow('songs', object));
}

async function addLike(songId, name) {
  return created('likes', await store.insertRow('likes', { song_id: songId, name }));
}

async function removeLike(id) {
  await store.deleteRow('likes', id);
  await sync.enqueue('likes', id, 'delete');
}

async function removeSong(id) {
  const removedLikes = await store.deleteSong(id);
  await sync.enqueue('songs', id, 'delete');
  for (const likeId of removedLikes) {
    await sync.enqueue('likes', likeId, 'delete');
  }
}

async function removeParticipant(id) {
  await store.deleteRow('participants', id);
  await sync.enqueue('participants', id, 'delete');
}

async function updateSong(id, patch) {
  return changed('songs', await store.updateRow('songs', id, patch), id);
}

async function updateParticipant(id, patch) {
  return changed('participants', await store.updateRow('participants', id, patch), id);
}

async function created(kind, row) {
  await sync.enqueue(kind, row.id);
  return row;
}

async function changed(kind, row, id) {
  if (row == null) {
    throw new Error(`Строка с id ${id} не найдена`);
  }
  await sync.enqueue(kind, row.id);
  return row;
}

module.exports = {
  getParticipants,
  getSongs,
  getLikes,
  addParticipant,
  addSong,
  addLike,
  removeLike,
  removeSong,
  removeParticipant,
  updateSong,
  updateParticipant,
};
