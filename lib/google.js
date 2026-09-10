const googleapis = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

let cachedClient = null;

class SheetsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SheetsError';
  }
}

function getSheetsClient() {
  if (cachedClient == null) {
    const credentials = readCredentials();
    const auth = new googleapis.google.auth.GoogleAuth({ credentials, scopes: SCOPES });
    cachedClient = googleapis.google.sheets({ version: 'v4', auth });
  }
  return cachedClient;
}

function sheetRange(sheetName, a1 = 'A:Z') {
  const name = String(sheetName == null ? '' : sheetName).replace(/'/g, "''");
  return `'${name}'!${a1}`;
}

function readCredentials() {
  const raw = typeof process.env.GOOGLE_SERVICE_ACCOUNT_JSON === 'string'
    ? process.env.GOOGLE_SERVICE_ACCOUNT_JSON.trim()
    : '';
  if (raw === '') {
    throw new SheetsError('Не задан GOOGLE_SERVICE_ACCOUNT_JSON: положи ключ сервис-аккаунта в переменную окружения');
  }
  const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  let credentials = null;
  try {
    credentials = JSON.parse(text);
  } catch (error) {
    throw new SheetsError('Не могу разобрать GOOGLE_SERVICE_ACCOUNT_JSON: это должен быть JSON ключа или он же в base64');
  }
  if (credentials == null || typeof credentials !== 'object' || !credentials.client_email || !credentials.private_key) {
    throw new SheetsError('В ключе сервис-аккаунта нет client_email или private_key');
  }
  return credentials;
}

module.exports = { SheetsError, getSheetsClient, sheetRange };
