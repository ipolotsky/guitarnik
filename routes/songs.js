const express = require('express');
const data = require('../lib/data');
const store = require('../lib/store');
const helpers = require('../lib/helpers');
const reference = require('../lib/reference');

const TABS = ['play', 'wish'];

const SORTS = ['likes', 'new'];

const VIEWS = ['list', 'cards'];

const LIKE_NAME_LIMIT = 80;

const router = express.Router();

router.get('/', async (req, res) => {
  const tab = TABS.indexOf(req.query.tab) === -1 ? 'play' : req.query.tab;
  const sort = SORTS.indexOf(req.query.sort) === -1 ? 'likes' : req.query.sort;
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const view = VIEWS.indexOf(req.query.view) === -1 ? 'list' : req.query.view;
  const onlyHelp = req.query.help === '1';
  const context = await loadContext();
  const base = tab === 'wish' ? helpers.openWishes(context.songs) : helpers.playableSongs(context.songs);
  const list = onlyHelp ? base.filter(x => x.needsMusicians) : base;
  res.render('songs', {
    title: 'Песни',
    active: 'songs',
    tab: tab,
    sort: sort,
    query: query,
    view: view,
    onlyHelp: onlyHelp,
    helpCount: base.filter(x => x.needsMusicians).length,
    songs: helpers.sortSongs(helpers.filterSongs(list, query), sort),
    links: {
      tabPlay: songsUrl('play', sort, query, view, onlyHelp),
      tabWish: songsUrl('wish', sort, query, view, onlyHelp),
      sortLikes: songsUrl(tab, 'likes', query, view, onlyHelp),
      sortNew: songsUrl(tab, 'new', query, view, onlyHelp),
      viewList: songsUrl(tab, sort, query, 'list', onlyHelp),
      viewCards: songsUrl(tab, sort, query, 'cards', onlyHelp),
      helpOn: songsUrl(tab, sort, query, view, true),
      helpOff: songsUrl(tab, sort, query, view, false),
    },
  });
});

router.get('/:id', async (req, res) => {
  const context = await loadContext();
  const song = context.songs.find(x => x.id === req.params.id);
  if (song == null) {
    res.status(404).render('not-found');
    return;
  }
  res.render('song', { title: song.title, active: 'songs', song: song });
});

router.post('/:id/like', async (req, res) => {
  const context = await loadContext();
  const song = context.songs.find(x => x.id === req.params.id);
  if (song == null) {
    res.status(404).render('not-found');
    return;
  }
  const name = helpers.asText(req.body.name).slice(0, LIKE_NAME_LIMIT);
  await data.addLikeFrom(req.deviceId, song.id, name);
  await finishLike(req, res, song.id, true);
});

router.post('/:id/unlike', async (req, res) => {
  const likeId = await store.takeVote(req.deviceId, req.params.id);
  if (likeId != null && likeId !== '') {
    await data.removeLike(likeId);
  }
  await finishLike(req, res, req.params.id, false);
});

router.get('/:id/take', async (req, res) => {
  const context = await loadContext();
  const song = context.songs.find(x => x.id === req.params.id);
  if (song == null) {
    res.status(404).render('not-found');
    return;
  }
  if (!song.isOpenWish) {
    res.redirect('/songs/' + encodeURIComponent(song.id));
    return;
  }
  renderTake(res, song, context.participants, {}, false, null);
});

router.post('/:id/take', async (req, res) => {
  const context = await loadContext();
  const song = context.songs.find(x => x.id === req.params.id);
  if (song == null) {
    res.status(404).render('not-found');
    return;
  }
  if (!song.isOpenWish) {
    res.redirect('/songs/' + encodeURIComponent(song.id));
    return;
  }
  try {
    const who = await helpers.resolveWho(req.body, context.participants);
    const partnerIds = await helpers.resolvePartners(req.body, context.participants);
    const performers = [who.id].concat(partnerIds.filter(x => x !== who.id)).join(', ');
    const claimed = await store.claimWish(song.id, performers, reference.STATUS_DECLARED);
    if (!claimed) {
      res.redirect('/songs/' + encodeURIComponent(song.id));
      return;
    }
    await data.updateSong(song.id, {
      who_plays_what: helpers.asText(req.body.who_plays_what),
      tonality: helpers.asText(req.body.tonality).slice(0, 40),
      need_prompter: !!req.body.need_prompter,
      show_on_projector: !!req.body.show_on_projector,
      gear: helpers.asKnownList(req.body.gear, reference.GEAR),
      own_gear: helpers.asText(req.body.own_gear),
    });
    res.render('done', {
      title: 'Песня твоя',
      active: 'songs',
      participant: { id: who.id, name: who.name },
      text: 'Мы записали тебя исполнителем. Дальше можно добавить свои песни или посмотреть, что уже собрано.',
      links: [
        { href: '/songs/' + encodeURIComponent(song.id), label: 'Открыть песню', primary: true },
        { href: '/songs', label: 'Посмотреть все песни', primary: false },
      ],
    });
  } catch (error) {
    if (error.name !== 'FormError') {
      throw error;
    }
    renderTake(res, song, context.participants, req.body, true, error.message);
  }
});

const loadContext = async () => {
  const loaded = await Promise.all([data.getParticipants(), data.getSongs(), data.getLikes()]);
  return {
    participants: loaded[0],
    songs: helpers.activeSongs(helpers.enrichSongs(loaded[1], loaded[0], loaded[2])),
  };
};

const finishLike = async (req, res, songId, voted) => {
  if (wantsJson(req)) {
    const counts = helpers.countLikes(await data.getLikes());
    res.json({ likes: counts[songId] == null ? 0 : counts[songId], voted: voted });
    return;
  }
  res.redirect(backWithSongAnchor(req.body.back, songId));
};

const wantsJson = req => {
  const accept = helpers.asText(req.get('accept')).toLowerCase();
  return accept.indexOf('application/json') !== -1;
};

const backWithSongAnchor = (back, songId) => {
  const path = helpers.safeBackPath(back, '');
  if (path === '') {
    return '/songs';
  }
  const hash = path.indexOf('#');
  const base = hash === -1 ? path : path.slice(0, hash);
  return base + '#song-' + encodeURIComponent(songId);
};

const renderTake = (res, song, participants, values, submitted, error) => {
  res.render('take', {
    title: 'Беру песню',
    active: 'songs',
    song: song,
    participants: participants,
    readyPartners: participants.filter(x => helpers.parseBool(x.can_help)),
    otherPartners: participants.filter(x => !helpers.parseBool(x.can_help)),
    values: values,
    submitted: submitted,
    error: error,
  });
};

const songsUrl = (tab, sort, query, view, onlyHelp) => {
  const params = new URLSearchParams();
  if (tab !== 'play') {
    params.set('tab', tab);
  }
  if (sort !== 'likes') {
    params.set('sort', sort);
  }
  if (query !== '') {
    params.set('q', query);
  }
  if (view !== 'list') {
    params.set('view', view);
  }
  if (onlyHelp === true) {
    params.set('help', '1');
  }
  const search = params.toString();
  return search === '' ? '/songs' : '/songs?' + search;
};

module.exports = { router };
