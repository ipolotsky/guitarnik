const test = require('node:test');
const assert = require('node:assert/strict');
const helpers = require('../lib/helpers');

test('telegramHandle принимает ник в любом виде', () => {
  assert.equal(helpers.telegramHandle('@ipolotsky'), 'ipolotsky');
  assert.equal(helpers.telegramHandle('ipolotsky'), 'ipolotsky');
  assert.equal(helpers.telegramHandle('https://t.me/ipolotsky'), 'ipolotsky');
  assert.equal(helpers.telegramHandle('t.me/ipolotsky/'), 'ipolotsky');
  assert.equal(helpers.telegramHandle('https://telegram.me/ipolotsky'), 'ipolotsky');
  assert.equal(helpers.telegramHandle('tg://resolve?domain=ipolotsky'), 'ipolotsky');
  assert.equal(helpers.telegramHandle('пишите мне @ipolotsky, отвечу'), 'ipolotsky');
});

test('telegramHandle отбивает мусор', () => {
  assert.equal(helpers.telegramHandle(''), null);
  assert.equal(helpers.telegramHandle('   '), null);
  assert.equal(helpers.telegramHandle('ab'), null);
  assert.equal(helpers.telegramHandle('https://example.com/ipolotsky'), null);
  assert.equal(helpers.telegramHandle(null), null);
});

test('telegramHandle не делает ссылку из почты', () => {
  assert.equal(helpers.telegramHandle('anya@example.com'), null);
  assert.equal(helpers.telegramHandle('пишите на anya@example.com'), null);
  assert.equal(helpers.telegramHandle('@anya'), 'anya', 'обычный ник по-прежнему работает');
});

test('safeHttpUrl пропускает только http и https', () => {
  assert.equal(helpers.safeHttpUrl('https://example.com/text'), 'https://example.com/text');
  assert.equal(helpers.safeHttpUrl('http://example.com'), 'http://example.com/');
  assert.equal(helpers.safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(helpers.safeHttpUrl('data:text/html,<script>'), null);
  assert.equal(helpers.safeHttpUrl('//evil.example.com'), null);
  assert.equal(helpers.safeHttpUrl('ftp://example.com'), null);
});

test('safeBackPath принимает только внутренние пути', () => {
  assert.equal(helpers.safeBackPath('/songs?tab=wish', '/songs'), '/songs?tab=wish');
  assert.equal(helpers.safeBackPath('//evil.example.com', '/songs'), '/songs');
  assert.equal(helpers.safeBackPath('https://evil.example.com', '/songs'), '/songs');
  assert.equal(helpers.safeBackPath('/\\evil', '/songs'), '/songs');
  assert.equal(helpers.safeBackPath(null, '/songs'), '/songs');
});

test('parseBool понимает значения таблицы', () => {
  assert.equal(helpers.parseBool('TRUE'), true);
  assert.equal(helpers.parseBool('FALSE'), false);
  assert.equal(helpers.parseBool('', true), true);
  assert.equal(helpers.parseBool('что-то', false), false);
});

test('splitList режет по запятым и чистит пустые', () => {
  assert.deepEqual(helpers.splitList('вокал, бас ,, гитара'), ['вокал', 'бас', 'гитара']);
  assert.deepEqual(helpers.splitList(''), []);
  assert.deepEqual(helpers.splitList(null), []);
});

test('asKnownList оставляет только значения из справочника', () => {
  assert.deepEqual(helpers.asKnownList(['микрофон', 'ракета'], ['микрофон', 'стул']), ['микрофон']);
  assert.deepEqual(helpers.asKnownList('стул', ['микрофон', 'стул']), ['стул']);
  assert.deepEqual(helpers.asKnownList(undefined, ['микрофон']), []);
});

const PARTICIPANTS = [
  { id: 'p_1', name: 'Аня', instruments: 'вокал', can_help: 'TRUE' },
  { id: 'p_2', name: 'Борис', instruments: 'бас', can_help: 'FALSE' },
];

const SONGS = [
  {
    id: 's_1', title: 'Город золотой', original_artist: 'Аквариум', type: 'perform',
    added_by: 'p_1', performers: 'p_1, p_2', gear: 'микрофон, стул', need_prompter: 'TRUE',
    show_on_projector: 'FALSE', status: 'заявлена', created_at: '2026-09-01T10:00:00.000Z', lyrics_url: '',
  },
  {
    id: 's_2', title: 'Перемен', original_artist: 'Кино', type: 'wish',
    added_by: '', performers: '', gear: '', need_prompter: '', show_on_projector: '',
    status: 'ищем исполнителя', created_at: '2026-09-02T10:00:00.000Z', lyrics_url: 'javascript:alert(1)',
  },
  {
    id: 's_3', title: 'Мурка', original_artist: 'народная', type: 'perform',
    added_by: 'p_2', performers: 'p_2', gear: '', need_prompter: 'FALSE', show_on_projector: 'TRUE',
    status: 'отменена', created_at: '2026-09-03T10:00:00.000Z', lyrics_url: '',
  },
];

const LIKES = [
  { id: 'l_1', song_id: 's_1', name: 'Гость', created_at: '2026-09-01T11:00:00.000Z' },
  { id: 'l_2', song_id: 's_1', name: 'Гость', created_at: '2026-09-01T12:00:00.000Z' },
  { id: 'l_3', song_id: 's_2', name: 'Гость', created_at: '2026-09-02T11:00:00.000Z' },
];

test('enrichSongs считает лайки, имена и булевы поля', () => {
  const songs = helpers.enrichSongs(SONGS, PARTICIPANTS, LIKES);
  const gold = songs.find(x => x.id === 's_1');
  assert.equal(gold.likes, 2);
  assert.deepEqual(gold.performerNames, ['Аня', 'Борис']);
  assert.equal(gold.addedByName, 'Аня');
  assert.deepEqual(gold.gearList, ['микрофон', 'стул']);
  assert.equal(gold.needPrompter, true);
  assert.equal(gold.showOnProjector, false);
  const wish = songs.find(x => x.id === 's_2');
  assert.equal(wish.likes, 1);
  assert.equal(wish.isWish, true);
  assert.equal(wish.isOpenWish, true);
  assert.equal(wish.needPrompter, true, 'пустое значение суфлера читается как включено');
  assert.equal(wish.lyricsUrlSafe, null, 'опасная ссылка не отдается в шаблон');
});

test('activeSongs выкидывает отмененные', () => {
  const songs = helpers.enrichSongs(SONGS, PARTICIPANTS, LIKES);
  const active = helpers.activeSongs(songs);
  assert.equal(active.length, 2);
  assert.equal(active.some(x => x.id === 's_3'), false);
});

test('playableSongs и openWishes делят список по вкладкам', () => {
  const songs = helpers.activeSongs(helpers.enrichSongs(SONGS, PARTICIPANTS, LIKES));
  assert.deepEqual(helpers.playableSongs(songs).map(x => x.id), ['s_1']);
  assert.deepEqual(helpers.openWishes(songs).map(x => x.id), ['s_2']);
});

test('sortSongs сортирует по лайкам и по дате', () => {
  const songs = helpers.activeSongs(helpers.enrichSongs(SONGS, PARTICIPANTS, LIKES));
  assert.deepEqual(helpers.sortSongs(songs, 'likes').map(x => x.id), ['s_1', 's_2']);
  assert.deepEqual(helpers.sortSongs(songs, 'new').map(x => x.id), ['s_2', 's_1']);
});

test('filterSongs ищет по названию и автору без учета регистра', () => {
  const songs = helpers.enrichSongs(SONGS, PARTICIPANTS, LIKES);
  assert.deepEqual(helpers.filterSongs(songs, 'ГОРОД').map(x => x.id), ['s_1']);
  assert.deepEqual(helpers.filterSongs(songs, 'кино').map(x => x.id), ['s_2']);
  assert.equal(helpers.filterSongs(songs, '').length, songs.length);
  assert.equal(helpers.filterSongs(songs, 'ничего такого').length, 0);
});

test('countLikes группирует по песне', () => {
  const counts = helpers.countLikes(LIKES);
  assert.equal(counts.s_1, 2);
  assert.equal(counts.s_2, 1);
  assert.equal(counts.s_3, undefined);
});
