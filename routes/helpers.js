const express = require('express');
const data = require('../lib/data');
const helpers = require('../lib/helpers');
const reference = require('../lib/reference');

const router = express.Router();

router.get('/', async (req, res) => {
  const participants = await data.getParticipants();
  const instrument = reference.INSTRUMENTS.indexOf(req.query.instrument) === -1 ? '' : req.query.instrument;
  const showAll = req.query.all === '1';
  const cards = participants.filter(x => showAll || helpers.parseBool(x.can_help)).map(x => buildCard(x));
  const offered = [];
  cards.forEach(card => {
    card.instruments.forEach(x => {
      if (offered.indexOf(x) === -1) {
        offered.push(x);
      }
    });
  });
  res.render('helpers', {
    title: showAll ? 'Все участники' : 'Музыканты',
    active: 'helpers',
    showAll: showAll,
    instrument: instrument,
    instruments: reference.INSTRUMENTS.filter(x => offered.indexOf(x) !== -1 || x === instrument),
    cards: instrument === '' ? cards : cards.filter(x => x.instruments.indexOf(instrument) !== -1),
  });
});

router.get('/join', async (req, res) => {
  const participants = await data.getParticipants();
  renderJoin(res, participants, {}, false, null);
});

router.post('/join', async (req, res) => {
  const participants = await data.getParticipants();
  try {
    const participantId = helpers.asText(req.body.participant_id);
    const helpInstruments = helpers.asList(req.body.help_instruments);
    const about = helpers.asText(req.body.about);
    const telegram = helpers.asText(req.body.telegram);
    let participant = null;
    if (participantId === reference.NEW_PARTICIPANT_OPTION) {
      const name = helpers.asText(req.body.new_name);
      if (name === '') {
        throw new helpers.FormError('Напиши, как тебя зовут');
      }
      const instruments = helpers.asList(req.body.new_instruments);
      participant = await data.addParticipant({
        name: name,
        telegram: telegram === '' ? helpers.asText(req.body.new_telegram) : telegram,
        instruments: instruments.length === 0 ? helpInstruments : instruments,
        can_help: true,
        help_instruments: helpInstruments,
        about: about,
      });
    } else {
      const found = participants.find(x => x.id === participantId);
      if (found == null) {
        throw new helpers.FormError('Выбери себя из списка');
      }
      const patch = { can_help: true, help_instruments: helpInstruments };
      if (about !== '') {
        patch.about = about;
      }
      if (telegram !== '') {
        patch.telegram = telegram;
      }
      participant = await data.updateParticipant(found.id, patch);
    }
    res.render('done', {
      title: 'Ты в списке',
      active: 'helpers',
      participant: { id: participant.id, name: participant.name },
      text: 'Теперь тебя видно на странице музыкантов. Посмотри, кому нужна помощь.',
      links: [
        { href: '/songs?tab=play', label: 'Песни, где нужны музыканты', primary: true },
        { href: '/songs?tab=wish', label: 'Хотелки без исполнителя', primary: false },
      ],
    });
  } catch (error) {
    if (error.name !== 'FormError') {
      throw error;
    }
    renderJoin(res, participants, req.body, true, error.message);
  }
});

const buildCard = participant => {
  const help = helpers.splitList(participant.help_instruments);
  return {
    name: helpers.asText(participant.name),
    about: helpers.asText(participant.about),
    canHelp: helpers.parseBool(participant.can_help),
    instruments: help.length === 0 ? helpers.splitList(participant.instruments) : help,
    telegram: helpers.telegramHandle(participant.telegram),
    telegramText: helpers.asText(participant.telegram),
  };
};

const renderJoin = (res, participants, values, submitted, error) => {
  res.render('helpers-join', {
    title: 'Готов подыграть',
    active: 'helpers',
    participants: participants,
    values: values,
    submitted: submitted,
    error: error,
  });
};

module.exports = { router };
