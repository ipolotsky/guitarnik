const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const MUTATIONS = [
  {
    name: 'safeBackPath пускает внешние адреса',
    file: 'lib/helpers.js',
    find: "  if (value.charAt(1) === '/' || value.charAt(1) === '\\\\') {\n    return fallback;\n  }\n",
    replace: '',
  },
  {
    name: 'safeHttpUrl пропускает любую схему',
    file: 'lib/helpers.js',
    find: "  if (text === '' || !HTTP_URL_PATTERN.test(text)) {\n    return null;\n  }",
    replace: "  if (text === '') {\n    return null;\n  }\n  return text;",
  },
  {
    name: 'activeSongs не скрывает отмененные',
    file: 'lib/helpers.js',
    find: 'return asArray(songs).filter(x => x.status !== reference.STATUS_CANCELLED);',
    replace: 'return asArray(songs);',
  },
  {
    name: 'asKnownList не проверяет справочник',
    file: 'lib/helpers.js',
    find: 'return asList(value).filter(x => allowed.indexOf(x) !== -1);',
    replace: 'return asList(value);',
  },
  {
    name: 'sortSongs по лайкам переворачивает порядок',
    file: 'lib/helpers.js',
    find: 'const byLikes = (b.likes == null ? 0 : b.likes) - (a.likes == null ? 0 : a.likes);',
    replace: 'const byLikes = (a.likes == null ? 0 : a.likes) - (b.likes == null ? 0 : b.likes);',
  },
  {
    name: 'telegramHandle не разбирает ссылки',
    file: 'lib/helpers.js',
    find: '  const fromLink = /(?:t\\.me|telegram\\.me|telegram\\.dog)\\/(?:s\\/)?([A-Za-z0-9_]{3,32})/i.exec(text);\n  if (fromLink != null) {\n    return fromLink[1];\n  }\n',
    replace: '',
  },
  {
    name: 'привязка лайка к голосу теряется',
    file: 'lib/store.js',
    find: "    'UPDATE votes SET like_id = $1 WHERE device = $2 AND song_id = $3',",
    replace: "    'UPDATE votes SET like_id = like_id WHERE device = $2 AND song_id = $3 AND $1 <> $1',",
  },
  {
    name: 'takeVote не удаляет голос',
    file: 'lib/store.js',
    find: "  const result = await db.query(\n    'DELETE FROM votes WHERE device = $1 AND song_id = $2 RETURNING like_id',\n    [id, String(songId)],\n  );",
    replace: "  const result = await db.query(\n    'SELECT like_id FROM votes WHERE device = $1 AND song_id = $2',\n    [id, String(songId)],\n  );",
  },
  {
    name: 'лайк ставится даже когда голос уже был',
    file: 'lib/data.js',
    find: '  const claimed = await store.claimVote(device, songId);\n  if (!claimed) {\n    return null;\n  }',
    replace: '  await store.claimVote(device, songId);',
  },
  {
    name: 'хотелку можно перехватить у того, кто ее уже взял',
    file: 'routes/songs.js',
    find: '    const claimed = await store.claimWish(song.id, performers, reference.STATUS_DECLARED);\n    if (!claimed) {',
    replace: '    const claimed = await store.claimWish(song.id, performers, reference.STATUS_DECLARED);\n    if (false) {',
  },
  {
    name: 'лайнап считается опубликованным всегда',
    file: 'lib/lineup.js',
    find: "  return (await db.readMeta(PUBLISHED_KEY, 'FALSE')) === 'TRUE';",
    replace: '  return true;',
  },
  {
    name: 'перестановка в лайнапе ничего не делает',
    file: 'lib/lineup.js',
    find: '  const swapped = items.slice();\n  swapped[index] = items[target];\n  swapped[target] = items[index];\n  await applyOrder(swapped.map(x => x.id));',
    replace: '  await applyOrder(items.map(x => x.id));',
  },
  {
    name: 'удаление из лайнапа удаляет не тот элемент',
    file: 'lib/lineup.js',
    find: "  await db.query('DELETE FROM lineup WHERE id = $1', [String(id)]);",
    replace: "  await db.query('DELETE FROM lineup WHERE id <> $1', [String(id)]);",
  },
  {
    name: 'админка пускает без пароля',
    file: 'routes/admin.js',
    find: '  if (!req.session.isAdmin) {\n    res.redirect(\'/admin/login\');\n    return;\n  }',
    replace: '',
  },
  {
    name: 'админка принимает любой статус',
    file: 'routes/admin.js',
    find: '  if (reference.STATUSES.indexOf(status) < 0) {',
    replace: '  if (false) {',
  },
  {
    name: 'заказ песни снова требует участника',
    file: 'routes/add.js',
    find: "    const who = helpers.asText(req.body.participant_id) === ''\n      ? null\n      : await helpers.resolveWho(req.body, participants);",
    replace: '    const who = await helpers.resolveWho(req.body, participants);',
  },
  {
    name: 'проверка на дубликат отключена',
    file: 'routes/add.js',
    find: '  const needle = title.toLowerCase();',
    replace: '  return null;\n  const needle = title.toLowerCase();',
  },
  {
    name: 'дубликат ищется с учетом регистра',
    file: 'routes/add.js',
    find: 'const found = songs.find(x => helpers.asText(x.title).toLowerCase() === needle);',
    replace: 'const found = songs.find(x => helpers.asText(x.title) === needle);',
  },
  {
    name: 'фильтр нужны музыканты ничего не фильтрует',
    file: 'routes/songs.js',
    find: 'const list = onlyHelp ? base.filter(x => x.needsMusicians) : base;',
    replace: 'const list = base;',
  },
  {
    name: 'признак нужны музыканты всегда выключен',
    file: 'lib/helpers.js',
    find: "needsMusicians: asText(song.need_musicians) !== '',",
    replace: 'needsMusicians: false,',
  },
  {
    name: 'поиск по участникам не появляется на длинном списке',
    file: 'views/partials/who.ejs',
    find: 'const whoCrowded = participants.length > 10;',
    replace: 'const whoCrowded = false;',
  },
  {
    name: 'редирект после лайка теряет якорь',
    file: 'routes/songs.js',
    find: "  return base + '#song-' + encodeURIComponent(songId);",
    replace: '  return base;',
  },
  {
    name: 'лайк отвечает JSON без учета заголовка',
    file: 'routes/songs.js',
    find: "  return accept.indexOf('application/json') !== -1;",
    replace: '  return false;',
  },
  {
    name: 'заявка на голос всегда считается успешной',
    file: 'lib/store.js',
    find: '  return result.rows.length > 0;\n}\n\nasync function attachLike',
    replace: '  return true;\n}\n\nasync function attachLike',
  },
  {
    name: 'выгрузка снова без голосов',
    file: 'routes/admin.js',
    find: '    votes: loaded[3],',
    replace: '    votes: [],',
  },
  {
    name: 'удаление участника не чистит состав песен',
    file: 'routes/admin.js',
    find: '      patch.performers = performers.filter(x => x !== id);',
    replace: '      patch.performers = performers;',
  },
  {
    name: 'удаление песни снова только помечает статусом',
    file: 'routes/admin.js',
    find: '    await data.removeSong(req.params.id);',
    replace: '    await data.updateSong(req.params.id, { status: reference.STATUS_CANCELLED });',
  },
  {
    name: 'удаление песни не трогает ее лайки',
    file: 'lib/store.js',
    find: "    await client.query('DELETE FROM likes WHERE song_id = $1', [songId]);",
    replace: '',
  },
  {
    name: 'удаление песни не убирает ее из лайнапа',
    file: 'lib/store.js',
    find: "    await client.query('DELETE FROM lineup WHERE song_id = $1', [songId]);",
    replace: '',
  },
  {
    name: 'правка песни не сохраняет название',
    file: 'routes/admin.js',
    find: "      title: requireText(req, 'title', 'Название песни не может быть пустым'),",
    replace: "      original_artist: bodyField(req, 'original_artist').trim(),",
  },
  {
    name: 'правка участника принимает пустое имя',
    file: 'routes/admin.js',
    find: "      name: requireText(req, 'name', 'Имя не может быть пустым'),",
    replace: "      name: bodyField(req, 'name'),",
  },
  {
    name: 'формы снова подставляют запомненного участника',
    file: 'views/partials/who.ejs',
    find: `data-who-remember="<%= whoRemember ? '1' : '0' %>"`,
    replace: 'data-who-remember="1"',
  },
  {
    name: 'автор не лайкает свою песню',
    file: 'routes/add.js',
    find: '    await data.addLikeFrom(req.deviceId, song.id, who.name);',
    replace: '',
  },
  {
    name: 'заказ не лайкается автоматически',
    file: 'routes/add.js',
    find: "    await data.addLikeFrom(req.deviceId, song.id, who == null ? '' : who.name);",
    replace: '',
  },
  {
    name: 'ссылка на текст рендерится без проверки',
    file: 'views/song.ejs',
    find: '<% if (song.lyricsUrlSafe != null) { %>',
    replace: '<% if (song.lyrics_url) { %>',
  },
  {
    name: 'экранирование выключено на карточке песни',
    file: 'views/partials/song-row.ejs',
    find: 'href="/songs/<%= song.id %>"><%= song.title %></a>',
    replace: 'href="/songs/<%= song.id %>"><%- song.title %></a>',
  },
];

function main() {
  const databaseUrl = typeof process.env.DATABASE_URL === 'string' ? process.env.DATABASE_URL.trim() : '';
  if (databaseUrl === '') {
    console.error('Мутационному прогону нужен DATABASE_URL');
    process.exit(1);
  }
  const baseline = runTests(ROOT, databaseUrl);
  if (baseline.status !== 0) {
    console.error('Тесты не проходят на чистом коде, мутации проверять нет смысла');
    console.error(baseline.tail);
    process.exit(1);
  }
  console.log(`Базовый прогон зеленый, мутаций к проверке: ${MUTATIONS.length}\n`);
  const survived = [];
  MUTATIONS.forEach((mutation, index) => {
    const workspace = prepare();
    try {
      applyMutation(workspace, mutation);
      const result = runTests(workspace, databaseUrl);
      const killed = result.status !== 0;
      console.log(`${index + 1}. ${killed ? 'убита' : 'ВЫЖИЛА'} — ${mutation.name}`);
      if (!killed) {
        survived.push(mutation.name);
      }
    } catch (error) {
      console.log(`${index + 1}. НЕПРИМЕНИМА — ${mutation.name}: ${error.message}`);
      survived.push(`${mutation.name} (мутация не применилась)`);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
  console.log(`\nУбито ${MUTATIONS.length - survived.length} из ${MUTATIONS.length}`);
  if (survived.length > 0) {
    console.log('Выжили:');
    survived.forEach(x => console.log(`  ${x}`));
    process.exit(1);
  }
  console.log('Все мутации отловлены тестами');
}

function prepare() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'guitarnik-mutation-'));
  execFileSync('cp', ['-R', `${ROOT}/lib`, `${ROOT}/routes`, `${ROOT}/views`, `${ROOT}/public`, `${ROOT}/test`, `${ROOT}/server.js`, `${ROOT}/package.json`, workspace]);
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(workspace, 'node_modules'));
  return workspace;
}

function applyMutation(workspace, mutation) {
  const target = path.join(workspace, mutation.file);
  const source = fs.readFileSync(target, 'utf8');
  if (source.indexOf(mutation.find) < 0) {
    throw new Error(`не нашел фрагмент в ${mutation.file}`);
  }
  fs.writeFileSync(target, source.replace(mutation.find, mutation.replace), 'utf8');
}

function runTests(workspace, databaseUrl) {
  const result = spawnSync('node', ['--test', '--test-concurrency=1', 'test/helpers.test.js', 'test/app.test.js'], {
    cwd: workspace,
    env: Object.assign({}, process.env, { DATABASE_URL: databaseUrl }),
    encoding: 'utf8',
    timeout: 300000,
  });
  const output = `${result.stdout == null ? '' : result.stdout}${result.stderr == null ? '' : result.stderr}`;
  return { status: result.status, tail: output.split('\n').slice(-25).join('\n') };
}

main();
