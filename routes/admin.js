const crypto = require('crypto');
const express = require('express');
const reference = require('../lib/reference');
const helpers = require('../lib/helpers');
const config = require('../lib/config');
const data = require('../lib/data');
const sheetsAdmin = require('../lib/sheetsAdmin');
const backup = require('../lib/backup');
const sync = require('../lib/sync');
const lineup = require('../lib/lineup');

const TABS = ['summary', 'lineup', 'participants', 'songs', 'likes'];
const EXPORTED_STATUSES = [reference.STATUS_DECLARED, reference.STATUS_SETLIST];

const router = express.Router();

router.use(requireAdmin);

router.get('/login', (req, res) => {
  res.render('admin/login', loginLocals(null));
});

router.post('/login', (req, res) => {
  if (!passwordMatches(bodyField(req, 'password'))) {
    res.status(401).render('admin/login', loginLocals('Пароль не подошел'));
    return;
  }
  req.session.isAdmin = true;
  res.redirect('/admin');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

router.get('/', async (req, res) => {
  const view = await loadData();
  res.render('admin/index', {
    title: 'Админка',
    tab: pickTab(req.query.tab),
    participants: view.participants,
    songs: view.songs,
    likes: view.likes,
    participantMap: view.participantMap,
    songTitles: view.songTitles,
    summary: buildSummary(view.songs),
    backupStatus: await backup.getStatus(),
    syncStatus: await sync.getStatus(),
    notice: pickNotice(req.query.notice),
    lineupItems: await lineupRows(view.songs),
    lineupPublished: await lineup.isPublished(),
    lineupCandidates: lineupCandidates(view.songs, await lineup.getItems()),
  });
});

router.post('/lineup/add-song', async (req, res) => {
  await lineup.addSong(bodyField(req, 'song_id'));
  res.redirect('/admin?tab=lineup');
});

router.post('/lineup/add-break', async (req, res) => {
  await lineup.addBreak(bodyField(req, 'label'));
  res.redirect('/admin?tab=lineup');
});

router.post('/lineup/fill', async (req, res) => {
  const songs = helpers.playableSongs(helpers.activeSongs(helpers.enrichSongs(await data.getSongs(), [], [])));
  await lineup.fillFromSongs(songs.map(x => x.id));
  res.redirect(noticeUrl('lineup', 'filled'));
});

router.post('/lineup/clear', async (req, res) => {
  await lineup.clear();
  res.redirect('/admin?tab=lineup');
});

router.post('/lineup/publish', async (req, res) => {
  const publish = bodyField(req, 'publish') === '1';
  await lineup.setPublished(publish);
  res.redirect(noticeUrl('lineup', publish ? 'published' : 'hidden'));
});

router.post('/lineup/:id/move', async (req, res) => {
  const direction = bodyField(req, 'direction') === 'up' ? 'up' : 'down';
  await lineup.move(req.params.id, direction);
  res.redirect('/admin?tab=lineup');
});

router.post('/lineup/:id/delete', async (req, res) => {
  await lineup.remove(req.params.id);
  res.redirect('/admin?tab=lineup');
});

router.post('/backup', (req, res) => {
  try {
    backup.run();
    res.redirect('/admin?tab=summary&notice=backup');
  } catch (error) {
    res.redirect(noticeUrl('summary', `error:${error.message}`));
  }
});

router.post('/sync/push', async (req, res) => {
  try {
    await sync.pushAll();
    res.redirect('/admin?tab=summary&notice=push');
  } catch (error) {
    res.redirect(noticeUrl('summary', `error:${error.message}`));
  }
});

router.post('/sync/pull', async (req, res) => {
  try {
    await sync.pullAll();
    res.redirect('/admin?tab=summary&notice=pull');
  } catch (error) {
    res.redirect(noticeUrl('summary', `error:${error.message}`));
  }
});

router.get('/export/data.json', async (req, res) => {
  const loaded = await Promise.all([data.getParticipants(), data.getSongs(), data.getLikes()]);
  res.json({ participants: loaded[0], songs: loaded[1], likes: loaded[2] });
});

router.post('/songs/:id/status', async (req, res) => {
  const status = bodyField(req, 'status');
  if (reference.STATUSES.indexOf(status) < 0) {
    res.redirect(noticeUrl('songs', 'error:Такого статуса нет в справочнике'));
    return;
  }
  res.redirect(await changeStatus(req.params.id, status));
});

router.post('/songs/:id/delete', async (req, res) => {
  res.redirect(await changeStatus(req.params.id, reference.STATUS_CANCELLED));
});

async function changeStatus(id, status) {
  try {
    await data.updateSong(id, { status });
    return '/admin?tab=songs';
  } catch (error) {
    return noticeUrl('songs', `error:${error.message}`);
  }
}

function noticeUrl(tab, notice) {
  return `/admin?tab=${tab}&notice=${encodeURIComponent(notice)}`;
}

router.get('/settings', (req, res) => {
  res.render('admin/settings', settingsLocals(null, null, req.query.saved === '1'));
});

router.post('/settings', (req, res) => {
  const patch = { sheets: {} };
  if (hasField(req, 'spreadsheetId')) {
    patch.spreadsheetId = bodyField(req, 'spreadsheetId');
  }
  ['participants', 'songs', 'likes'].forEach(x => {
    if (hasField(req, x)) {
      patch.sheets[x] = bodyField(req, x);
    }
  });
  config.saveConfig(patch);
  res.redirect('/admin/settings?saved=1');
});

router.post('/settings/check', async (req, res) => {
  let checks = null;
  let errorMessage = null;
  try {
    checks = await sheetsAdmin.checkConnection();
  } catch (error) {
    errorMessage = error.message;
  }
  res.render('admin/settings', settingsLocals(checks, errorMessage, false));
});

router.post('/settings/create', async (req, res) => {
  let checks = null;
  let errorMessage = null;
  try {
    checks = await sheetsAdmin.createStructure();
  } catch (error) {
    errorMessage = error.message;
  }
  res.render('admin/settings', settingsLocals(checks, errorMessage, false));
});

router.get('/export/setlist.json', async (req, res) => {
  const view = await loadData();
  res.json(view.songs
    .filter(x => EXPORTED_STATUSES.indexOf(x.status) >= 0)
    .map(x => ({
      id: x.id,
      artist: x.performerNames.join(', '),
      title: x.title,
      sing: x.showOnProjector,
      lyrics: x.lyrics,
    })));
});

function requireAdmin(req, res, next) {
  if (req.path === '/login') {
    next();
    return;
  }
  if (!req.session.isAdmin) {
    res.redirect('/admin/login');
    return;
  }
  next();
}

function loginLocals(error) {
  return {
    title: 'Вход в админку',
    error,
    passwordMissing: adminPassword() === '',
  };
}

function passwordMatches(input) {
  const expected = adminPassword();
  if (expected === '') {
    return false;
  }
  const given = typeof input === 'string' ? input : '';
  return crypto.timingSafeEqual(sha256(given), sha256(expected));
}

function adminPassword() {
  return typeof process.env.ADMIN_PASSWORD === 'string' ? process.env.ADMIN_PASSWORD : '';
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function hasField(req, name) {
  return req.body != null && Object.prototype.hasOwnProperty.call(req.body, name);
}

function bodyField(req, name) {
  if (req.body == null || typeof req.body[name] !== 'string') {
    return '';
  }
  return req.body[name];
}

async function loadData() {
  const loaded = await Promise.all([data.getParticipants(), data.getSongs(), data.getLikes()]);
  const participants = loaded[0];
  const songs = helpers.enrichSongs(loaded[1], participants, loaded[2]);
  const songTitles = {};
  songs.forEach(x => {
    songTitles[x.id] = x.title;
  });
  return {
    participants,
    songs,
    likes: loaded[2],
    participantMap: helpers.participantMap(participants),
    songTitles,
  };
}

async function lineupRows(songs) {
  const byId = {};
  songs.forEach(x => {
    byId[x.id] = x;
  });
  const items = await lineup.getItems();
  let number = 0;
  return items.map(item => {
    if (item.kind === lineup.BREAK) {
      return { id: item.id, kind: item.kind, label: item.label, number: 0, song: null };
    }
    number += 1;
    return { id: item.id, kind: item.kind, label: '', number, song: byId[item.songId] == null ? null : byId[item.songId] };
  });
}

function lineupCandidates(songs, items) {
  const used = items.filter(x => x.kind === lineup.SONG).map(x => x.songId);
  return helpers.sortSongs(helpers.playableSongs(helpers.activeSongs(songs)), 'likes')
    .filter(x => used.indexOf(x.id) === -1);
}

function pickNotice(value) {
  const text = typeof value === 'string' ? value : '';
  if (text === 'backup') {
    return { kind: 'success', text: 'Бекап сделан' };
  }
  if (text === 'push') {
    return { kind: 'success', text: 'Данные выгружены в таблицу' };
  }
  if (text === 'pull') {
    return { kind: 'success', text: 'Данные загружены из таблицы' };
  }
  if (text === 'published') {
    return { kind: 'success', text: 'Лайнап опубликован, его видно всем' };
  }
  if (text === 'hidden') {
    return { kind: 'success', text: 'Лайнап скрыт, посетители видят сообщение об ожидании' };
  }
  if (text === 'filled') {
    return { kind: 'success', text: 'Лайнап собран из заявленных песен, порядок по лайкам' };
  }
  if (text.startsWith('error:')) {
    return { kind: 'danger', text: text.slice('error:'.length).slice(0, 300) };
  }
  return null;
}

function pickTab(value) {
  const tab = typeof value === 'string' ? value : '';
  return TABS.indexOf(tab) >= 0 ? tab : 'summary';
}

function buildSummary(songs) {
  const active = helpers.activeSongs(songs);
  const playable = helpers.playableSongs(active);
  return {
    total: playable.length,
    prompter: playable.filter(x => x.needPrompter).length,
    projector: playable.filter(x => x.showOnProjector).length,
    gear: countGear(playable),
    ownGear: playable
      .filter(x => x.own_gear.trim() !== '')
      .map(x => ({ title: x.title, who: performersLine(x), gear: x.own_gear })),
    openWishes: helpers.sortSongs(helpers.openWishes(active), 'likes'),
  };
}

function countGear(songs) {
  const counts = new Map();
  songs.forEach(song => {
    song.gearList.forEach(x => {
      counts.set(x, (counts.get(x) != null ? counts.get(x) : 0) + 1);
    });
  });
  return Array.from(counts.entries())
    .map(x => ({ name: x[0], count: x[1] }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function performersLine(song) {
  if (song.performerNames.length > 0) {
    return song.performerNames.join(', ');
  }
  return song.addedByName;
}

function settingsLocals(checks, errorMessage, saved) {
  const current = config.getConfig();
  return {
    title: 'Настройки таблицы',
    values: current,
    checks,
    errorMessage,
    saved,
  };
}

module.exports = { router };
