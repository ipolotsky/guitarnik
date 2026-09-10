const crypto = require('crypto');

const COOKIE_NAME = 'guitarnik_device';
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000;
const ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

function ensure(req, res) {
  const existing = read(req);
  if (existing != null) {
    return existing;
  }
  const id = crypto.randomBytes(18).toString('base64url');
  res.cookie(COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!req.secure,
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
  return id;
}

function read(req) {
  const header = typeof req.headers.cookie === 'string' ? req.headers.cookie : '';
  if (header === '') {
    return null;
  }
  const found = header
    .split(';')
    .map(x => x.trim())
    .find(x => x.startsWith(`${COOKIE_NAME}=`));
  if (found == null) {
    return null;
  }
  const value = decodeURIComponent(found.slice(COOKIE_NAME.length + 1));
  return ID_PATTERN.test(value) ? value : null;
}

module.exports = { ensure, read };
