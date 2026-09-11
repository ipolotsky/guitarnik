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

  assert.equal(likesOf(list.text, songId), 1, 'автор сразу лайкает свою песню');
  assert.match(list.text, /bi-heart-fill/, 'сердечко у автора закрашено');

  await guest.post(`/songs/${songId}/like`, { name: 'Аня', back: '/songs' });
  const afterSecond = await guest.get('/songs');
  assert.equal(likesOf(afterSecond.text, songId), 1, 'второй голос с того же устройства не считается');

  const unliked = await guest.post(`/songs/${songId}/unlike`, { back: '/songs' });
  assert.equal(unliked.status, 302);
  const afterUnlike = await guest.get('/songs');
  assert.equal(likesOf(afterUnlike.text, songId), 0, 'автор может снять свой голос');
  assert.match(afterUnlike.text, /bi-heart"><\/i> 0/, 'сердечко снова пустое');

  await guest.post(`/songs/${songId}/like`, { name: 'Аня', back: '/songs' });
  const afterRelike = await guest.get('/songs');
  assert.equal(likesOf(afterRelike.text, songId), 1, 'после снятия можно проголосовать снова');

  const wish = await guest.post('/add/wish', { title: 'Перемен', original_artist: 'Кино' });
  assert.equal(wish.status, 200);
  assert.match(wish.text, /Заказ добавлен/);
  const wishes = await guest.get('/songs?tab=wish');
  assert.match(wishes.text, /Перемен/);
  const wishIdForLike = /\/songs\/(s_[A-Za-z0-9_-]{8})/.exec(wishes.text.slice(wishes.text.indexOf('Перемен') - 300))[1];
  assert.equal(likesOf(wishes.text, wishIdForLike), 1, 'заказ тоже сразу лайкнут');
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

  const songsList = await guest.get('/songs');
  const firstId = /\/songs\/(s_[A-Za-z0-9_-]{8})/.exec(songsList.text.slice(songsList.text.indexOf('Первая песня') - 300))[1];
  const fan = support.createClient(server.base);
  await fan.get('/songs');
  await fan.post(`/songs/${firstId}/like`, { name: 'Гость', back: '/songs' });

  await admin.post('/admin/login', { password: support.ADMIN_PASSWORD });
  const filled = await admin.post('/admin/lineup/fill', {});
  assert.match(String(filled.location), /notice=filled/);

  let lineupTab = await admin.get('/admin?tab=lineup');
  assert.deepEqual(
    titlesOfLineup(lineupTab.text),
    ['Первая песня', 'Вторая песня'],
    'сборка ставит песни по числу лайков',
  );

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

test('сайт предупреждает о песне с тем же названием', async t => {
  const server = await support.startServer();
  t.after(() => server.stop());
  const guest = support.createClient(server.base);

  await guest.post('/helpers/join', { participant_id: '__new__', new_name: 'Аня', help_instruments: 'вокал' });
  const form = await guest.get('/add/perform');
  const participantId = idFrom(form.text, 'p_');
  await guest.post('/add/perform', { participant_id: participantId, title: 'Кукушка', original_artist: 'Кино' });

  const twin = await guest.post('/add/perform', { participant_id: participantId, title: 'кукушка' });
  assert.match(twin.text, /уже есть/, 'предупреждение про такую же песню');
  assert.match(twin.text, /Все равно добавить/);
  const listAfterWarning = await guest.get('/songs');
  assert.equal((listAfterWarning.text.match(/Кукушка/g) || []).length, 1, 'вторая песня еще не создана');

  const forced = await guest.post('/add/perform', { participant_id: participantId, title: 'кукушка', confirm: '1' });
  assert.match(forced.text, /Песня добавлена/);
  const listAfterForce = await guest.get('/songs');
  assert.equal((listAfterForce.text.match(/[Кк]укушка/g) || []).length, 2, 'после подтверждения песня добавлена');

  const wishTwin = await guest.post('/add/wish', { title: 'КУКУШКА' });
  assert.match(wishTwin.text, /уже заказывали|уже играют/);
});

test('песни, которым нужны музыканты, видно отдельно', async t => {
  const server = await support.startServer();
  t.after(() => server.stop());
  const guest = support.createClient(server.base);

  await guest.post('/helpers/join', { participant_id: '__new__', new_name: 'Аня', help_instruments: 'вокал' });
  const form = await guest.get('/add/perform');
  const participantId = idFrom(form.text, 'p_');
  await guest.post('/add/perform', { participant_id: participantId, title: 'Сам справлюсь' });
  await guest.post('/add/perform', {
    participant_id: participantId,
    title: 'Нужен басист',
    need_musicians: 'нужен бас и кахон',
  });

  const all = await guest.get('/songs');
  assert.match(all.text, /нужны музыканты/, 'бейдж на песне с просьбой');
  assert.match(all.text, /нужны музыканты: 1/, 'счетчик в фильтре');

  const filtered = await guest.get('/songs?help=1');
  assert.match(filtered.text, /Нужен басист/);
  assert.doesNotMatch(filtered.text, /Сам справлюсь/, 'фильтр оставляет только тех, кому нужна помощь');
});

test('при большом списке участников появляется поиск по себе', async t => {
  const server = await support.startServer();
  t.after(() => server.stop());
  const guest = support.createClient(server.base);

  const small = await guest.get('/add/perform');
  assert.doesNotMatch(small.text, /data-who-search/, 'на коротком списке поиск не нужен');

  for (let i = 0; i < 11; i += 1) {
    await guest.post('/helpers/join', {
      participant_id: '__new__',
      new_name: `Участник ${i}`,
      help_instruments: 'вокал',
    });
  }

  const crowded = await guest.get('/add/perform');
  assert.match(crowded.text, /data-who-search/, 'на длинном списке появляется поиск');
});

test('лайк отвечает JSON и не создает лишних голосов при спешке', async t => {
  const server = await support.startServer();
  t.after(() => server.stop());
  const guest = support.createClient(server.base);

  await guest.post('/helpers/join', { participant_id: '__new__', new_name: 'Аня', help_instruments: 'вокал' });
  const form = await guest.get('/add/perform');
  const participantId = idFrom(form.text, 'p_');
  await guest.post('/add/perform', { participant_id: participantId, title: 'Одна песня' });
  const list = await guest.get('/songs');
  const songId = idFrom(list.text, 's_');
  const device = guest.cookies.get('guitarnik_device');
  assert.ok(device, 'кука устройства выдана');

  const json = await fetch(`${server.base}/songs/${songId}/like`, {
    method: 'POST',
    headers: { accept: 'application/json', cookie: `guitarnik_device=${device}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'name=Аня',
  });
  assert.equal(json.status, 200);
  assert.match(String(json.headers.get('content-type')), /application\/json/);
  const payload = await json.json();
  assert.deepEqual(payload, { likes: 1, voted: true });

  const parallelTries = await Promise.all([0, 1, 2, 3].map(() => fetch(`${server.base}/songs/${songId}/like`, {
    method: 'POST',
    headers: { accept: 'application/json', cookie: `guitarnik_device=${device}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'name=Аня',
  })));
  const bodies = await Promise.all(parallelTries.map(x => x.json()));
  bodies.forEach(body => {
    assert.equal(body.likes, 1, 'параллельные нажатия не накручивают счетчик');
    assert.equal(body.voted, true);
  });

  const admin = support.createClient(server.base);
  await admin.post('/admin/login', { password: support.ADMIN_PASSWORD });
  const dump = JSON.parse((await admin.get('/admin/export/data.json')).text);
  assert.equal(dump.likes.length, 1, 'в базе ровно один лайк');
  assert.equal(dump.votes.length, 1, 'и ровно один голос');

  const removal = await fetch(`${server.base}/songs/${songId}/unlike`, {
    method: 'POST',
    headers: { accept: 'application/json', cookie: `guitarnik_device=${device}` },
  });
  assert.deepEqual(await removal.json(), { likes: 0, voted: false });
  const afterRemoval = JSON.parse((await admin.get('/admin/export/data.json')).text);
  assert.equal(afterRemoval.likes.length, 0, 'лайк удален вместе с голосом');
  assert.equal(afterRemoval.votes.length, 0);
});

test('обычная отправка лайка возвращает на то же место страницы', async t => {
  const server = await support.startServer();
  t.after(() => server.stop());
  const guest = support.createClient(server.base);

  await guest.post('/helpers/join', { participant_id: '__new__', new_name: 'Аня', help_instruments: 'вокал' });
  const form = await guest.get('/add/perform');
  const participantId = idFrom(form.text, 'p_');
  await guest.post('/add/perform', { participant_id: participantId, title: 'Якорная' });
  const list = await guest.get('/songs');
  const songId = idFrom(list.text, 's_');

  const liked = await guest.post(`/songs/${songId}/like`, { name: 'Аня', back: '/songs' });
  assert.equal(liked.status, 302);
  assert.equal(liked.location, `/songs#song-${songId}`, 'редирект возвращает к той же песне');

  const outside = await guest.post(`/songs/${songId}/unlike`, { back: 'https://evil.example.com' });
  assert.match(String(outside.location), /^\/songs/, 'внешний адрес отбит');
  assert.doesNotMatch(String(outside.location), /evil/);

  const page = await guest.get('/songs');
  assert.match(page.text, new RegExp(`id="song-${songId}"`), 'у песни есть якорь');
});

test('выгрузка содержит все, что нужно для восстановления', async t => {
  const server = await support.startServer();
  t.after(() => server.stop());
  const guest = support.createClient(server.base);
  const admin = support.createClient(server.base);

  await guest.post('/helpers/join', { participant_id: '__new__', new_name: 'Аня', help_instruments: 'вокал' });
  const form = await guest.get('/add/perform');
  const participantId = idFrom(form.text, 'p_');
  await guest.post('/add/perform', { participant_id: participantId, title: 'Для выгрузки' });
  const list = await guest.get('/songs');
  const songId = idFrom(list.text, 's_');
  await guest.post(`/songs/${songId}/like`, { name: 'Аня', back: '/songs' });

  await admin.post('/admin/login', { password: support.ADMIN_PASSWORD });
  await admin.post('/admin/lineup/fill', {});
  await admin.post('/admin/lineup/add-break', { label: 'Перерыв' });
  await admin.post('/admin/lineup/publish', { publish: '1' });

  const dump = JSON.parse((await admin.get('/admin/export/data.json')).text);
  assert.equal(dump.participants.length, 1);
  assert.equal(dump.songs.length, 1);
  assert.equal(dump.likes.length, 1);
  assert.equal(dump.votes.length, 1, 'голоса выгружаются');
  assert.equal(dump.lineup.length, 2, 'лайнап выгружается');
  assert.ok(dump.meta.some(x => x.key === 'lineup_published' && x.value === 'TRUE'), 'флаг публикации выгружается');
});

test('админ удаляет участника, песни остаются', async t => {
  const server = await support.startServer();
  t.after(() => server.stop());
  const guest = support.createClient(server.base);
  const admin = support.createClient(server.base);

  await guest.post('/helpers/join', { participant_id: '__new__', new_name: 'Аня', help_instruments: 'вокал' });
  await guest.post('/helpers/join', { participant_id: '__new__', new_name: 'Борис', help_instruments: 'бас' });
  const form = await guest.get('/add/perform');
  const ids = (form.text.match(/p_[A-Za-z0-9_-]{8}/g) || []).filter((x, i, list) => list.indexOf(x) === i);
  assert.equal(ids.length, 2);
  const [anya, boris] = ids;

  await guest.post('/add/perform', { participant_id: anya, partners: boris, title: 'Дуэт' });

  await admin.post('/admin/login', { password: support.ADMIN_PASSWORD });
  const removed = await admin.post(`/admin/participants/${boris}/delete`, {});
  assert.equal(removed.status, 302);

  const songs = await guest.get('/songs');
  assert.match(songs.text, /Дуэт/, 'песня осталась');
  assert.doesNotMatch(songs.text, /Борис/, 'удаленный участник пропал из состава');

  const dump = JSON.parse((await admin.get('/admin/export/data.json')).text);
  assert.equal(dump.participants.length, 1, 'участник удален из базы');
  const song = dump.songs[0];
  assert.doesNotMatch(song.performers, new RegExp(boris), 'его id вычищен из состава песни');
  assert.match(song.performers, new RegExp(anya), 'остальные исполнители на месте');
  const helpersPage = await guest.get('/helpers');
  assert.doesNotMatch(helpersPage.text, /Борис/);
  assert.match(helpersPage.text, /Аня/, 'остальные участники на месте');

  const again = await admin.post(`/admin/participants/${boris}/delete`, {});
  assert.equal(again.status, 302);
  assert.match(String(again.location), /notice=error/, 'повторное удаление не роняет админку');

  const tabs = await Promise.all(['summary', 'lineup', 'participants', 'songs', 'likes']
    .map(x => admin.get(`/admin?tab=${x}`)));
  tabs.forEach(x => assert.equal(x.status, 200));
});

test('админ удаляет песню насовсем, вместе с лайками и местом в лайнапе', async t => {
  const server = await support.startServer();
  t.after(() => server.stop());
  const guest = support.createClient(server.base);
  const admin = support.createClient(server.base);

  await guest.post('/helpers/join', { participant_id: '__new__', new_name: 'Аня', help_instruments: 'вокал' });
  const form = await guest.get('/add/perform');
  const participantId = idFrom(form.text, 'p_');
  await guest.post('/add/perform', { participant_id: participantId, title: 'Лишняя' });
  await guest.post('/add/perform', { participant_id: participantId, title: 'Нужная' });
  const list = await guest.get('/songs');
  const doomed = /\/songs\/(s_[A-Za-z0-9_-]{8})/.exec(list.text.slice(list.text.indexOf('Лишняя') - 300))[1];
  await guest.post(`/songs/${doomed}/like`, { name: 'Аня', back: '/songs' });

  await admin.post('/admin/login', { password: support.ADMIN_PASSWORD });
  await admin.post('/admin/lineup/fill', {});
  const beforeDump = JSON.parse((await admin.get('/admin/export/data.json')).text);
  assert.equal(beforeDump.songs.length, 2);
  assert.equal(beforeDump.likes.length, 2, 'у каждой песни автолайк автора');
  assert.equal(beforeDump.lineup.length, 2);

  const removed = await admin.post(`/admin/songs/${doomed}/delete`, {});
  assert.equal(removed.status, 302);
  assert.match(String(removed.location), /notice=song-removed/);

  const dump = JSON.parse((await admin.get('/admin/export/data.json')).text);
  assert.equal(dump.songs.length, 1, 'песня удалена из базы, а не помечена отмененной');
  assert.equal(dump.songs[0].title, 'Нужная');
  assert.equal(dump.likes.length, 1, 'лайк удаленной песни ушел, лайк оставшейся цел');
  assert.equal(dump.likes[0].song_id, dump.songs[0].id);
  assert.equal(dump.votes.length, 1, 'голос удаленной песни тоже ушел');
  assert.equal(dump.lineup.length, 1, 'из лайнапа песня пропала');

  const songsTab = await admin.get('/admin?tab=songs');
  assert.doesNotMatch(songsTab.text, /Лишняя/, 'в админке строки больше нет');

  const again = await admin.post(`/admin/songs/${doomed}/delete`, {});
  assert.match(String(again.location), /notice=error/, 'повторное удаление не роняет админку');

  const gone = await guest.get(`/songs/${doomed}`);
  assert.equal(gone.status, 404);
});

test('админ правит песню и участника', async t => {
  const server = await support.startServer();
  t.after(() => server.stop());
  const guest = support.createClient(server.base);
  const admin = support.createClient(server.base);

  await guest.post('/helpers/join', { participant_id: '__new__', new_name: 'Аня', help_instruments: 'вокал' });
  const form = await guest.get('/add/perform');
  const participantId = idFrom(form.text, 'p_');
  await guest.post('/add/perform', { participant_id: participantId, title: 'С опечаткай', original_artist: 'Кто-то' });
  const list = await guest.get('/songs');
  const songId = idFrom(list.text, 's_');

  await admin.post('/admin/login', { password: support.ADMIN_PASSWORD });

  const songForm = await admin.get(`/admin/songs/${songId}/edit`);
  assert.equal(songForm.status, 200);
  assert.match(songForm.text, /С опечаткай/);

  const savedSong = await admin.post(`/admin/songs/${songId}/edit`, {
    title: 'Без опечатки',
    original_artist: 'Аквариум',
    type: 'perform',
    status: 'в сетлисте',
    added_by: participantId,
    performers: participantId,
    gear: 'микрофон',
    need_prompter: '1',
    lyrics: 'первая строка',
    note: 'поправлено',
  });
  assert.equal(savedSong.status, 302);
  assert.match(String(savedSong.location), /notice=saved/);

  const songPage = await guest.get(`/songs/${songId}`);
  assert.match(songPage.text, /Без опечатки/);
  assert.match(songPage.text, /Аквариум/);
  assert.match(songPage.text, /в сетлисте/);
  assert.doesNotMatch(songPage.text, /С опечаткай/);

  const emptyTitle = await admin.post(`/admin/songs/${songId}/edit`, { title: '', type: 'perform', status: 'заявлена' });
  assert.equal(emptyTitle.status, 200);
  assert.match(emptyTitle.text, /Название песни не может быть пустым/);

  const participantForm = await admin.get(`/admin/participants/${participantId}/edit`);
  assert.equal(participantForm.status, 200);
  assert.match(participantForm.text, /Аня/);

  const savedParticipant = await admin.post(`/admin/participants/${participantId}/edit`, {
    name: 'Анна',
    telegram: 'https://t.me/anna_music',
    instruments: ['вокал', 'клавиши'],
    can_help: '1',
    help_instruments: 'клавиши',
    about: 'играю на клавишах',
  });
  assert.equal(savedParticipant.status, 302);

  const helpersPage = await guest.get('/helpers');
  assert.match(helpersPage.text, /Анна/);
  assert.match(helpersPage.text, /клавиши/);
  assert.match(helpersPage.text, /anna_music/);

  const noName = await admin.post(`/admin/participants/${participantId}/edit`, { name: ' ' });
  assert.equal(noName.status, 200);
  assert.match(noName.text, /Имя не может быть пустым/);
});

test('заказ песни по умолчанию анонимный', async t => {
  const server = await support.startServer();
  t.after(() => server.stop());
  const guest = support.createClient(server.base);

  await guest.post('/helpers/join', { participant_id: '__new__', new_name: 'Аня', help_instruments: 'вокал' });

  const wishForm = await guest.get('/add/wish');
  assert.match(wishForm.text, /Аноним, не указывать/, 'первый вариант анонимный');
  assert.match(wishForm.text, /data-who-remember="0"/, 'на этой форме себя не подставляют');

  const performForm = await guest.get('/add/perform');
  assert.match(performForm.text, /data-who-remember="0"/, 'при добавлении песни список начинается с выбора');
  assert.match(performForm.text, /Выбери себя из списка/);
  assert.doesNotMatch(performForm.text, /Аноним, не указывать/);

  const joinForm = await guest.get('/helpers/join');
  assert.match(joinForm.text, /data-who-remember="1"/, 'в «Готов подыграть» участник по-прежнему подставляется');
});

test('хотелку нельзя перехватить у того, кто ее уже взял', async t => {
  const server = await support.startServer();
  t.after(() => server.stop());
  const first = support.createClient(server.base);
  const second = support.createClient(server.base);

  await first.post('/helpers/join', { participant_id: '__new__', new_name: 'Аня', help_instruments: 'вокал' });
  await first.post('/helpers/join', { participant_id: '__new__', new_name: 'Борис', help_instruments: 'бас' });
  await first.post('/add/wish', { title: 'Кто успел' });
  const wishes = await first.get('/songs?tab=wish');
  const wishId = idFrom(wishes.text, 's_');
  const form = await first.get(`/songs/${wishId}/take`);
  const ids = (form.text.match(/p_[A-Za-z0-9_-]{8}/g) || []).filter((x, i, list) => list.indexOf(x) === i);

  const taken = await first.post(`/songs/${wishId}/take`, { participant_id: ids[0] });
  assert.equal(taken.status, 200);
  assert.match(taken.text, /Песня твоя/);

  const late = await second.post(`/songs/${wishId}/take`, { participant_id: ids[1] });
  assert.equal(late.status, 302, 'опоздавшего отправляют на страницу песни');
  assert.match(String(late.location), new RegExp(wishId));

  const page = await first.get(`/songs/${wishId}`);
  assert.match(page.text, /Аня/, 'состав остался за первым');
  assert.doesNotMatch(page.text, /Борис/, 'второй не перезаписал состав');

  await first.post('/add/wish', { title: 'Одновременно' });
  const more = await first.get('/songs?tab=wish');
  const raceId = /\/songs\/(s_[A-Za-z0-9_-]{8})/.exec(more.text.slice(more.text.indexOf('Одновременно') - 300))[1];
  const together = await Promise.all([
    first.post(`/songs/${raceId}/take`, { participant_id: ids[0] }),
    second.post(`/songs/${raceId}/take`, { participant_id: ids[1] }),
  ]);
  const winners = together.filter(x => x.status === 200 && /Песня твоя/.test(x.text));
  assert.equal(winners.length, 1, 'при одновременном взятии выигрывает ровно один');

  const racePage = await first.get(`/songs/${raceId}`);
  const performers = (racePage.text.match(/Аня|Борис/g) || []).filter((x, i, list) => list.indexOf(x) === i);
  assert.equal(performers.length, 1, `в составе остался один исполнитель, а не ${performers.join(' и ')}`);
});

test('битая кука устройства не роняет сайт', async t => {
  const server = await support.startServer();
  t.after(() => server.stop());

  const broken = await fetch(`${server.base}/songs`, { headers: { cookie: 'guitarnik_device=%E0%A4%A' } });
  assert.equal(broken.status, 200, 'страница открывается с испорченной кукой');
  const home = await fetch(`${server.base}/`, { headers: { cookie: 'guitarnik_device=' + 'x'.repeat(500) } });
  assert.equal(home.status, 200, 'слишком длинная кука тоже не мешает');
});

test('отмененная песня пропадает из опубликованного лайнапа', async t => {
  const server = await support.startServer();
  t.after(() => server.stop());
  const guest = support.createClient(server.base);
  const admin = support.createClient(server.base);

  await guest.post('/helpers/join', { participant_id: '__new__', new_name: 'Аня', help_instruments: 'вокал' });
  const form = await guest.get('/add/perform');
  const participantId = idFrom(form.text, 'p_');
  await guest.post('/add/perform', { participant_id: participantId, title: 'Отменят меня' });
  await guest.post('/add/perform', { participant_id: participantId, title: 'Останусь' });
  const list = await guest.get('/songs');
  const doomed = /\/songs\/(s_[A-Za-z0-9_-]{8})/.exec(list.text.slice(list.text.indexOf('Отменят меня') - 300))[1];

  await admin.post('/admin/login', { password: support.ADMIN_PASSWORD });
  await admin.post('/admin/lineup/fill', {});
  await admin.post('/admin/lineup/publish', { publish: '1' });
  const before = await guest.get('/lineup');
  assert.match(before.text, /Отменят меня/);

  await admin.post(`/admin/songs/${doomed}/status`, { status: 'отменена' });
  const after = await guest.get('/lineup');
  assert.equal(after.status, 200);
  assert.doesNotMatch(after.text, /Отменят меня/, 'отмененная песня не висит в лайнапе');
  assert.match(after.text, /Останусь/, 'остальные на месте');
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
