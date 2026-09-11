const express = require('express');
const data = require('../lib/data');
const helpers = require('../lib/helpers');
const lineup = require('../lib/lineup');

const router = express.Router();

router.get('/', async (req, res) => {
  const published = await lineup.isPublished();
  if (!published) {
    res.render('lineup', { title: 'Лайнап', active: 'lineup', published: false, items: [] });
    return;
  }
  res.render('lineup', {
    title: 'Лайнап',
    active: 'lineup',
    published: true,
    items: await buildItems(),
  });
});

const buildItems = async () => {
  const loaded = await Promise.all([data.getParticipants(), data.getSongs(), data.getLikes(), lineup.getItems()]);
  const songs = helpers.activeSongs(helpers.enrichSongs(loaded[1], loaded[0], loaded[2]));
  const byId = {};
  songs.forEach(x => {
    byId[x.id] = x;
  });
  let number = 0;
  return loaded[3].map(item => {
    if (item.kind === lineup.BREAK) {
      return { kind: item.kind, label: item.label, number: 0, song: null };
    }
    number += 1;
    return { kind: item.kind, label: '', number: number, song: byId[item.songId] == null ? null : byId[item.songId] };
  }).filter(x => x.kind === lineup.BREAK || x.song != null);
};

module.exports = { router, buildItems };
