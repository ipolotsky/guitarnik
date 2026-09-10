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
  return created('participants', store.insertRow('participants', object));
}

async function addSong(object) {
  return created('songs', store.insertRow('songs', object));
}

async function addLike(songId, name) {
  return created('likes', store.insertRow('likes', { song_id: songId, name }));
}

async function updateSong(id, patch) {
  return changed('songs', store.updateRow('songs', id, patch), id);
}

async function updateParticipant(id, patch) {
  return changed('participants', store.updateRow('participants', id, patch), id);
}

function created(kind, row) {
  sync.enqueue(kind, row.id);
  return row;
}

function changed(kind, row, id) {
  if (row == null) {
    throw new Error(`Строка с id ${id} не найдена`);
  }
  sync.enqueue(kind, row.id);
  return row;
}

module.exports = {
  getParticipants,
  getSongs,
  getLikes,
  addParticipant,
  addSong,
  addLike,
  updateSong,
  updateParticipant,
};
