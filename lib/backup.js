const fs = require('fs');
const path = require('path');
const db = require('./db');
const store = require('./store');

const BACKUP_DIRECTORY = path.join(db.DATA_DIRECTORY, 'backups');
const FILE_PREFIX = 'guitarnik-';
const CHECK_INTERVAL = 10 * 60 * 1000;
const NIGHT_HOUR = 4;
const KEEP_FILES = 30;

let timer = null;

function start() {
  if (timer != null) {
    return;
  }
  timer = setInterval(runIfDue, CHECK_INTERVAL);
  timer.unref();
  runIfDue();
}

function runIfDue() {
  try {
    const now = new Date();
    const today = localDate(now);
    if (db.readMeta('backup_date', '') === today) {
      return;
    }
    if (now.getHours() < NIGHT_HOUR && listBackups().length > 0) {
      return;
    }
    run();
  } catch (error) {
    console.error(`Ночной бекап не удался: ${error.message}`);
  }
}

function run() {
  fs.mkdirSync(BACKUP_DIRECTORY, { recursive: true });
  const today = localDate(new Date());
  const file = path.join(BACKUP_DIRECTORY, `${FILE_PREFIX}${today}.sqlite`);
  const temporary = `${file}.tmp-${process.pid}`;
  fs.rmSync(temporary, { force: true });
  try {
    db.getDatabase().exec(`VACUUM INTO '${temporary.replace(/'/g, "''")}'`);
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  db.writeMeta('backup_date', today);
  db.writeMeta('backup_at', new Date().toISOString());
  prune();
  return getStatus();
}

function prune() {
  listBackups().slice(KEEP_FILES).forEach(x => {
    fs.rmSync(path.join(BACKUP_DIRECTORY, x.name), { force: true });
  });
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIRECTORY)) {
    return [];
  }
  return fs
    .readdirSync(BACKUP_DIRECTORY)
    .filter(x => x.startsWith(FILE_PREFIX) && x.endsWith('.sqlite'))
    .map(x => ({ name: x, size: fs.statSync(path.join(BACKUP_DIRECTORY, x)).size }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

function localDate(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getStatus() {
  return {
    at: db.readMeta('backup_at', ''),
    directory: BACKUP_DIRECTORY,
    files: listBackups(),
    counts: {
      participants: store.countRows('participants'),
      songs: store.countRows('songs'),
      likes: store.countRows('likes'),
    },
  };
}

module.exports = { start, run, getStatus };
