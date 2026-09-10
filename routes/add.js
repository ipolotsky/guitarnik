const express = require('express');
const data = require('../lib/data');
const helpers = require('../lib/helpers');
const reference = require('../lib/reference');

const router = express.Router();

router.get('/', async (req, res) => {
  res.render('add', { title: 'Добавить песню', active: 'add' });
});

router.get('/perform', async (req, res) => {
  const participants = await data.getParticipants();
  renderPerform(res, participants, {}, false, null);
});

router.post('/perform', async (req, res) => {
  const participants = await data.getParticipants();
  try {
    const title = helpers.asText(req.body.title);
    if (title === '') {
      throw new helpers.FormError('Напиши название песни');
    }
    const who = await helpers.resolveWho(req.body, participants);
    const partnerIds = await helpers.resolvePartners(req.body, participants);
    await data.addSong({
      title: title,
      original_artist: helpers.asText(req.body.original_artist),
      type: 'perform',
      added_by: who.id,
      performers: [who.id].concat(partnerIds.filter(x => x !== who.id)),
      who_plays_what: helpers.asText(req.body.who_plays_what),
      need_musicians: helpers.asText(req.body.need_musicians),
      gear: helpers.asKnownList(req.body.gear, reference.GEAR),
      own_gear: helpers.asText(req.body.own_gear),
      lyrics: helpers.asText(req.body.lyrics),
      lyrics_url: helpers.asText(req.body.lyrics_url),
      need_prompter: !!req.body.need_prompter,
      show_on_projector: !!req.body.show_on_projector,
      note: helpers.asText(req.body.note),
      status: reference.STATUS_DECLARED,
    });
    res.render('done', {
      title: 'Песня добавлена',
      active: 'add',
      participant: { id: who.id, name: who.name },
      text: 'Она уже в списке, на вкладке «Будут сыграны».',
      links: [
        { href: '/add/perform', label: 'Добавить ещё песню', primary: true },
        { href: '/songs', label: 'Посмотреть все песни', primary: false },
      ],
    });
  } catch (error) {
    if (error.name !== 'FormError') {
      throw error;
    }
    renderPerform(res, participants, req.body, true, error.message);
  }
});

router.get('/wish', async (req, res) => {
  const participants = await data.getParticipants();
  renderWish(res, participants, {}, false, null);
});

router.post('/wish', async (req, res) => {
  const participants = await data.getParticipants();
  try {
    const title = helpers.asText(req.body.title);
    if (title === '') {
      throw new helpers.FormError('Напиши название песни');
    }
    const who = helpers.asText(req.body.participant_id) === ''
      ? null
      : await helpers.resolveWho(req.body, participants);
    await data.addSong({
      title: title,
      original_artist: helpers.asText(req.body.original_artist),
      type: 'wish',
      added_by: who == null ? '' : who.id,
      performers: '',
      lyrics: helpers.asText(req.body.lyrics),
      lyrics_url: helpers.asText(req.body.lyrics_url),
      note: helpers.asText(req.body.note),
      status: reference.STATUS_LOOKING,
    });
    res.render('done', {
      title: 'Заказ добавлен',
      active: 'add',
      participant: who == null ? null : { id: who.id, name: who.name },
      text: 'Теперь её видно всем на вкладке «Хотелки». Позови друзей полайкать — чем больше лайков, тем выше шанс, что кто-то возьмётся.',
      links: [
        { href: '/songs?tab=wish', label: 'Посмотреть хотелки', primary: true },
        { href: '/add/wish', label: 'Заказать ещё песню', primary: false },
      ],
    });
  } catch (error) {
    if (error.name !== 'FormError') {
      throw error;
    }
    renderWish(res, participants, req.body, true, error.message);
  }
});

const renderPerform = (res, participants, values, submitted, error) => {
  res.render('add-perform', {
    title: 'Я сыграю сам',
    active: 'add',
    participants: participants,
    readyPartners: participants.filter(x => helpers.parseBool(x.can_help)),
    otherPartners: participants.filter(x => !helpers.parseBool(x.can_help)),
    values: values,
    submitted: submitted,
    error: error,
  });
};

const renderWish = (res, participants, values, submitted, error) => {
  res.render('add-wish', {
    title: 'Заказать песню',
    active: 'add',
    participants: participants,
    values: values,
    submitted: submitted,
    error: error,
  });
};

module.exports = { router };
