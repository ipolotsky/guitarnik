const test = require('node:test');
const assert = require('node:assert/strict');
const support = require('./support/server');

const idFrom = (text, prefix) => {
  const match = new RegExp(`${prefix}[A-Za-z0-9_-]{8}`).exec(text);
  return match == null ? null : match[0];
};

const itemsOfLineup = text => {
  const start = text.indexOf('<h2 class="h4 mb-3">Порядок</h2>');
  const region = start < 0 ? text : text.slice(start);
  return region
    .split('list-group-item')
    .slice(1)
    .map(block => {
      const id = /\/admin\/lineup\/(n_[A-Za-z0-9_-]{8})\/delete/.exec(block);
      const label = /song-line">\s*([^<\n]+?)\s*(?:<|\n)/.exec(block);
      return { id: id == null ? null : id[1], title: label == null ? '' : label[1].trim() };
    })
    .filter(x => x.id != null);
};

const titlesOfLineup = text => itemsOfLineup(text).map(x => x.title);

const likesOf = (text, songId) => {
  const start = text.indexOf(`/songs/${songId}`);
  if (start < 0) {
    return null;
  }
  const block = text.slice(start, start + 1400);
  const inButton = /bi-heart(?:-fill)?"><\/i>\s*(\d+)/.exec(block);
  if (inButton != null) {
    return Number(inButton[1]);
  }
  const inBadge = /text-bg-secondary">(\d+)/.exec(block);
  return inBadge == null ? null : Number(inBadge[1]);
};

test('гость проходит весь путь: участник, песня, лайк, заказ, взятая хотелка', async t => {
  const server = await support.startServer();
  t.after(() => server.stop());
  const guest = support.createClient(server.base);

  const home = await guest.get('/');
  assert.equal(home.status, 200);
  assert.match(home.text, /Да будет ламповый гитарник/);
  assert.match(home.text, /Гитарник - Кэмп U/);

  const join = await guest.post('/helpers/join', {
    participant_id: '__new__',
    new_name: 'Аня',
    telegram: 'https://t.me/anya_music',
    help_instruments: 'вокал',
  });
  assert.equal(join.status, 200);
  const helpers = await guest.get('/helpers');
  assert.match(helpers.text, /Аня/);
  assert.match(helpers.text, /t\.me\/anya_music/, 'телеграм ссылкой распознан и стал ссылкой');

  const form = await guest.get('/add/perform');
  const participantId = idFrom(form.text, 'p_');
  assert.ok(participantId, 'участник появился в списке');

  const added = await guest.post('/add/perform', {
    participant_id: participantId,
    title: 'Город золотой',
    original_artist: 'Аквариум',
    lyrics: 'Под небом голубым',
    gear: 'микрофон',
  });
  assert.equal(added.status, 200);
  assert.match(added.text, /Песня добавлена/);

  const list = await guest.get('/songs');
  assert.match(list.text, /Город золотой/);
  const songId = idFrom(list.text, 's_');
  assert.ok(songId);

  assert.equal(likesOf(list.text, songId), 0);
  const liked = await guest.post(`/songs/${songId}/like`, { name: 'Аня', back: '/songs' });
  assert.equal(liked.status, 302);
  const afterLike = await guest.get('/songs');
  assert.equal(likesOf(afterLike.text, songId), 1);

  await guest.post(`/songs/${songId}/like`, { name: 'Аня', back: '/songs' });
  const afterSecond = await guest.get('/songs');
  assert.equal(likesOf(afterSecond.text, songId), 1, 'второй голос с того же устройства не считается');

  const unliked = await guest.post(`/songs/${songId}/unlike`, { back: '/songs' });
  assert.equal(unliked.status, 302);
  const afterUnlike = await guest.get('/songs');
  assert.equal(likesOf(afterUnlike.text, songId), 0, 'голос снимается');
  assert.match(afterUnlike.text, /bi-heart"><\/i> 0/, 'сердечко снова пустое');

  await guest.post(`/songs/${songId}/like`, { name: 'Аня', back: '/songs' });
  const afterRelike = await guest.get('/songs');
  assert.equal(likesOf(afterRelike.text, songId), 1, 'после снятия можно проголосовать снова');

  const wish = await guest.post('/add/wish', { title: 'Перемен', original_artist: 'Кино' });
  assert.equal(wish.status, 200);
  assert.match(wish.text, /Заказ добавлен/);
  const wishes = await guest.get('/songs?tab=wish');
  assert.match(wishes.text, /Перемен/);
  assert.match(wishes.text, /кто-то из наших/, 'заказ без имени остается анонимным');

  const wishId = idFrom(wishes.text.slice(wishes.text.indexOf('Перемен') - 200), 's_');
  const takeForm = await guest.get(`/songs/${wishId}/take`);
  assert.equal(takeForm.status, 200);
  const taken = await guest.post(`/songs/${wishId}/take`, {
    participant_id: participantId,
    who_plays_what: 'Аня поет',
  });
  assert.equal(taken.status, 200);
  assert.match(taken.text, /Песня твоя/);

  const songPage = await guest.get(`/songs/${wishId}`);
  assert.match(songPage.text, /заявлена/);
  assert.match(songPage.text, /Аня/);
});

test('чужие устройства голосуют независимо', async t => {
  const server = await support.startServer();
  t.after(() => server.stop());
  const first = support.createClient(server.base);
  const second = support.createClient(server.base);

  await first.post('/helpers/join', { participant_id: '__new__', new_name: 'Аня', help_instruments: 'вокал' });
  const form = await first.get('/add/perform');
  const participantId = idFrom(form.text, 'p_');
  await first.post('/add/perform', { participant_id: participantId, title: 'Кукушка' });
  const list = await first.get('/songs');
  const songId = idFrom(list.text, 's_');

  await first.post(`/songs/${songId}/like`, { name: 'Аня', back: '/songs' });
  await second.get('/songs');
  await second.post(`/songs/${songId}/like`, { name: 'Гость', back: '/songs' });

  const afterBoth = await first.get('/songs');
  assert.equal(likesOf(afterBoth.text, songId), 2);

  await second.post(`/songs/${songId}/unlike`, { back: '/songs' });
  const afterUnlike = await first.get('/songs');
  assert.equal(likesOf(afterUnlike.text, songId), 1, 'снятие чужого голоса не трогает мой');
});

test('формы отбивают мусор и не теряют введенное', async t => {
  const server = await support.startServer();
  t.after(() => server.stop());
  const guest = support.createClient(server.base);

  const empty = await guest.post('/add/perform', { participant_id: '__new__', new_name: 'Аня', title: '' });
  assert.equal(empty.status, 200);
  assert.match(empty.text, /Напиши название песни/);

  const noName = await guest.post('/add/perform', { participant_id: '__new__', new_name: '', title: 'Песня' });
  assert.match(noName.text, /Напиши, как тебя зовут/);

  const unknown = await guest.post('/add/perform', { participant_id: 'p_нет-такого', title: 'Песня' });
  assert.match(unknown.text, /Выбери себя из списка/);

  const withGarbage = await guest.post('/add/perform', {
    participant_id: '__new__',
    new_name: 'Борис',
    title: 'Мусорное оборудование',
    gear: ['микрофон', 'ядерный реактор'],
  });
  assert.equal(withGarbage.status, 200);
  const list = await guest.get('/songs');
  const songId = idFrom(list.text, 's_');
  const page = await guest.get(`/songs/${songId}`);
  assert.match(page.text, /микрофон/);
  assert.doesNotMatch(page.text, /ядерный реактор/, 'оборудование вне справочника отброшено');

  const bodyless = await fetch(`${server.base}/add/perform`, { method: 'POST' });
  assert.notEqual(bodyless.status, 500, 'POST без тела не роняет сервер');
});

test('вредный ввод не попадает в разметку', async t => {
  const server = await support.startServer();
  t.after(() => server.stop());
  const guest = support.createClient(server.base);

  await guest.post('/add/wish', {
    title: '<script>alert(1)</script>',
    original_artist: '"><img src=x onerror=alert(1)>',
    lyrics_url: 'javascript:alert(1)',
    note: 'обычный текст',
  });
  const wishes = await guest.get('/songs?tab=wish');
  assert.doesNotMatch(wishes.text, /<script>alert/, 'нет живого script из пользовательского ввода');
  assert.doesNotMatch(wishes.text, /<img\s+src=x/, 'нет живого img из пользовательского ввода');
  assert.match(wishes.text, /&lt;script&gt;/, 'ввод показан экранированным текстом');
  assert.match(wishes.text, /&lt;img src=x onerror=alert\(1\)&gt;/);

  const songId = idFrom(wishes.text, 's_');
  const page = await guest.get(`/songs/${songId}`);
  assert.doesNotMatch(page.text, /href="javascript:/);
  assert.match(page.text, /javascript:alert\(1\)/, 'опасная ссылка показана текстом');

  const redirected = await guest.post(`/songs/${songId}/like`, { name: 'Гость', back: 'https://evil.example.com' });
  assert.equal(redirected.location, '/songs', 'внешний редирект отбит');
});

test('админка закрыта паролем и правит статусы', async t => {
  const server = await support.startServer();
  t.after(() => server.stop());
  const guest = support.createClient(server.base);
  const admin = support.createClient(server.base);

  await guest.post('/helpers/join', { participant_id: '__new__', new_name: 'Аня', help_instruments: 'вокал' });
  const form = await guest.get('/add/perform');
  const participantId = idFrom(form.text, 'p_');
  await guest.post('/add/perform', { participant_id: participantId, title: 'Кукушка' });
  const list = await guest.get('/songs');
  const songId = idFrom(list.text, 's_');

  const closed = await admin.get('/admin');
  assert.equal(closed.status, 302);
  assert.equal(closed.location, '/admin/login');

  const wrong = await admin.post('/admin/login', { password: 'мимо' });
  assert.equal(wrong.status, 401);

  const login = await admin.post('/admin/login', { password: support.ADMIN_PASSWORD });
  assert.equal(login.status, 302);
  const summary = await admin.get('/admin?tab=summary');
  assert.equal(summary.status, 200);
  assert.match(summary.text, /Хранилище/);

  const status = await admin.post(`/admin/songs/${songId}/status`, { status: 'в сетлисте' });
  assert.equal(status.status, 302);
  const songsTab = await admin.get('/admin?tab=songs');
  assert.match(songsTab.text, /в сетлисте/);

  const badStatus = await admin.post(`/admin/songs/${songId}/status`, { status: 'выдумка' });
  assert.match(String(badStatus.location), /notice=error/);

  const missing = await admin.post('/admin/songs/s_missing/delete', {});
  assert.match(String(missing.location), /notice=error/, 'неизвестный id не роняет админку');

  const setlist = await admin.get('/admin/export/setlist.json');
  const parsed = JSON.parse(setlist.text);
  assert.equal(Array.isArray(parsed), true);
  assert.equal(parsed.length, 1);
  assert.deepEqual(Object.keys(parsed[0]).sort(), ['artist', 'id', 'lyrics', 'sing', 'title']);
  assert.equal(typeof parsed[0].sing, 'boolean');

  const deleted = await admin.post(`/admin/songs/${songId}/delete`, {});
  assert.equal(deleted.status, 302);
  const publicList = await guest.get('/songs');
  assert.doesNotMatch(publicList.text, /Кукушка/, 'отмененная песня пропадает из публичного списка');
});

test('лайнап: скрыт, собирается, переставляется и публикуется', async t => {
  const server = await support.startServer();
  t.after(() => server.stop());
  const guest = support.createClient(server.base);
  const admin = support.createClient(server.base);

  const hidden = await guest.get('/lineup');
  assert.equal(hidden.status, 200);
  assert.match(hidden.text, /Лайнап еще не опубликован/);

  await guest.post('/helpers/join', { participant_id: '__new__', new_name: 'Аня', help_instruments: 'вокал' });
  const form = await guest.get('/add/perform');
  const participantId = idFrom(form.text, 'p_');
  await guest.post('/add/perform', { participant_id: participantId, title: 'Первая песня' });
  await guest.post('/add/perform', { participant_id: participantId, title: 'Вторая песня' });

  await admin.post('/admin/login', { password: support.ADMIN_PASSWORD });
  const filled = await admin.post('/admin/lineup/fill', {});
  assert.match(String(filled.location), /notice=filled/);

  let lineupTab = await admin.get('/admin?tab=lineup');
  assert.deepEqual(titlesOfLineup(lineupTab.text), ['Первая песня', 'Вторая песня']);

  const breakAdded = await admin.post('/admin/lineup/add-break', { label: 'Перерыв 15 минут' });
  assert.equal(breakAdded.status, 302);
  lineupTab = await admin.get('/admin?tab=lineup');
  assert.deepEqual(titlesOfLineup(lineupTab.text), ['Первая песня', 'Вторая песня', 'Перерыв 15 минут']);

  const items = itemsOfLineup(lineupTab.text);
  const moved = await admin.post(`/admin/lineup/${items[0].id}/move`, { direction: 'down' });
  assert.equal(moved.status, 302);
  const afterMove = await admin.get('/admin?tab=lineup');
  assert.deepEqual(
    titlesOfLineup(afterMove.text),
    ['Вторая песня', 'Первая песня', 'Перерыв 15 минут'],
    'кнопка вниз меняет местами соседей',
  );

  const breakItem = itemsOfLineup(afterMove.text).find(x => x.title === 'Перерыв 15 минут');
  assert.ok(breakItem, 'перерыв виден в списке');
  const movedBreak = await admin.post(`/admin/lineup/${breakItem.id}/move`, { direction: 'up' });
  assert.equal(movedBreak.status, 302);
  const afterBreakMove = await admin.get('/admin?tab=lineup');
  assert.deepEqual(
    titlesOfLineup(afterBreakMove.text),
    ['Вторая песня', 'Перерыв 15 минут', 'Первая песня'],
    'перерыв двигается как обычный элемент',
  );

  const stillHidden = await guest.get('/lineup');
  assert.match(stillHidden.text, /Лайнап еще не опубликован/);

  const published = await admin.post('/admin/lineup/publish', { publish: '1' });
  assert.match(String(published.location), /notice=published/);
  const open = await guest.get('/lineup');
  assert.match(open.text, /Первая песня/);
  assert.match(open.text, /Перерыв 15 минут/);
  assert.doesNotMatch(open.text, /Лайнап еще не опубликован/);

  const removed = await admin.post(`/admin/lineup/${breakItem.id}/delete`, {});
  assert.equal(removed.status, 302);
  const afterRemove = await admin.get('/admin?tab=lineup');
  assert.deepEqual(
    titlesOfLineup(afterRemove.text),
    ['Вторая песня', 'Первая песня'],
    'удаление элемента не ломает остальные и не путает порядок',
  );

  const hiddenAgain = await admin.post('/admin/lineup/publish', { publish: '0' });
  assert.match(String(hiddenAgain.location), /notice=hidden/);
  const closed = await guest.get('/lineup');
  assert.match(closed.text, /Лайнап еще не опубликован/);
});

test('вкладки, поиск и вид списка не сбрасывают друг друга', async t => {
  const server = await support.startServer();
  t.after(() => server.stop());
  const guest = support.createClient(server.base);

  await guest.post('/helpers/join', { participant_id: '__new__', new_name: 'Аня', help_instruments: 'вокал' });
  const form = await guest.get('/add/perform');
  const participantId = idFrom(form.text, 'p_');
  await guest.post('/add/perform', { participant_id: participantId, title: 'Восьмиклассница', original_artist: 'Кино' });
  await guest.post('/add/perform', { participant_id: participantId, title: 'Трамвай', original_artist: 'Сплин' });

  const listView = await guest.get('/songs');
  assert.match(listView.text, /list-group-item/, 'по умолчанию список');

  const cardsView = await guest.get('/songs?view=cards');
  assert.match(cardsView.text, /card h-100/, 'карточки по параметру');
  assert.match(cardsView.text, /view=cards/, 'вид сохраняется в ссылках');

  const broken = await guest.get('/songs?view=взлом&sort=взлом&tab=взлом');
  assert.equal(broken.status, 200);
  assert.match(broken.text, /list-group-item/, 'мусорные параметры откатываются к дефолту');

  const found = await guest.get('/songs?q=' + encodeURIComponent('сплин'));
  assert.match(found.text, /Трамвай/);
  assert.doesNotMatch(found.text, /Восьмиклассница/);

  const nothing = await guest.get('/songs?q=' + encodeURIComponent('такого нет'));
  assert.match(nothing.text, /ничего не нашлось/);
});
