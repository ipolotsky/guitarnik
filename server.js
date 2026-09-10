require('dotenv').config({ quiet: true });

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const session = require('express-session');
const reference = require('./lib/reference');
const backup = require('./lib/backup');
const sync = require('./lib/sync');
const home = require('./routes/home');
const songs = require('./routes/songs');
const add = require('./routes/add');
const helpers = require('./routes/helpers');
const admin = require('./routes/admin');

const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 3000;
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: sessionSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    maxAge: COOKIE_MAX_AGE,
  },
}));

app.use((req, res, next) => {
  res.locals.reference = reference;
  res.locals.isAdmin = !!req.session.isAdmin;
  res.locals.currentPath = req.originalUrl;
  next();
});

app.use('/', home.router);
app.use('/songs', songs.router);
app.use('/add', add.router);
app.use('/helpers', helpers.router);
app.use('/admin', admin.router);

app.use((req, res) => {
  res.status(404).render('not-found', { title: 'Страница не найдена' });
});

app.use((error, req, res, next) => {
  console.error(error != null && error.stack ? error.stack : error);
  const isSheets = error != null && error.name === 'SheetsError';
  res.status(isSheets ? 502 : 500).render('error', {
    title: isSheets ? 'Не могу достучаться до таблицы' : 'Что-то сломалось',
    message: error != null && error.message ? String(error.message) : 'Неизвестная ошибка',
    isSheets,
  });
});

app.listen(PORT, () => {
  console.log(`Гитарник слушает порт ${PORT}`);
  backup.start();
  sync.start();
});

function sessionSecret() {
  const value = typeof process.env.SESSION_SECRET === 'string' ? process.env.SESSION_SECRET.trim() : '';
  if (value !== '') {
    return value;
  }
  console.warn('SESSION_SECRET не задан, беру случайный: сессии админа сбросятся при перезапуске');
  return crypto.randomBytes(32).toString('hex');
}
