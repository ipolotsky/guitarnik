const fs = require('fs');
const path = require('path');
const express = require('express');
const data = require('../lib/data');
const helpers = require('../lib/helpers');

const COVER_PATH = path.join(__dirname, '..', 'public', 'cover.jpg');

const TOP_LIMIT = 5;

const router = express.Router();

router.get('/', async (req, res) => {
  const loaded = await Promise.all([data.getParticipants(), data.getSongs(), data.getLikes()]);
  const participants = loaded[0];
  const songs = helpers.activeSongs(helpers.enrichSongs(loaded[1], participants, loaded[2]));
  const playable = helpers.playableSongs(songs);
  const wishes = helpers.openWishes(songs);
  res.render('index', {
    title: 'Главная',
    active: 'home',
    hasCover: fs.existsSync(COVER_PATH),
    counts: {
      songs: playable.length,
      wishes: wishes.length,
      participants: participants.length,
      helpers: participants.filter(x => helpers.parseBool(x.can_help)).length,
    },
    topSongs: helpers.sortSongs(playable, 'likes').slice(0, TOP_LIMIT),
  });
});

module.exports = { router };
