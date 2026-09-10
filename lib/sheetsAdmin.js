const reference = require('./reference');
const config = require('./config');
const google = require('./google');

const KEYS = ['participants', 'songs', 'likes'];

async function checkConnection() {
  const current = config.getConfig();
  const spreadsheetId = requireSpreadsheetId(current);
  const titles = await readTitles(spreadsheetId);
  const checks = [];
  for (const key of KEYS) {
    const name = current.sheets[key];
    if (titles.indexOf(name) < 0) {
      checks.push({ key, name, found: false, rows: 0, hasHeaders: false });
    } else {
      const values = await readValues(spreadsheetId, name);
      checks.push({
        key,
        name,
        found: true,
        rows: Math.max(0, values.length - 1),
        hasHeaders: matchesHeaders(key, values[0]),
      });
    }
  }
  return checks;
}

async function createStructure() {
  const current = config.getConfig();
  const spreadsheetId = requireSpreadsheetId(current);
  const titles = await readTitles(spreadsheetId);
  const requests = KEYS
    .filter(x => titles.indexOf(current.sheets[x]) < 0)
    .map(x => ({ addSheet: { properties: { title: current.sheets[x] } } }));
  if (requests.length > 0) {
    await addSheets(spreadsheetId, requests);
  }
  for (const key of KEYS) {
    const name = current.sheets[key];
    const values = await readValues(spreadsheetId, name);
    if (isFirstRowEmpty(values)) {
      await writeHeaders(spreadsheetId, name, reference.SHEET_HEADERS[key]);
    }
  }
  return checkConnection();
}

async function readTitles(spreadsheetId) {
  let response = null;
  try {
    response = await google.getSheetsClient().spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.title',
    });
  } catch (error) {
    throw toSheetsError(error, '');
  }
  const sheets = response != null && response.data != null && Array.isArray(response.data.sheets)
    ? response.data.sheets
    : [];
  return sheets
    .map(x => (x != null && x.properties != null ? String(x.properties.title) : ''))
    .filter(x => x !== '');
}

async function readValues(spreadsheetId, name) {
  let response = null;
  try {
    response = await google.getSheetsClient().spreadsheets.values.get({
      spreadsheetId,
      range: google.sheetRange(name),
    });
  } catch (error) {
    throw toSheetsError(error, name);
  }
  if (response == null || response.data == null || !Array.isArray(response.data.values)) {
    return [];
  }
  return response.data.values;
}

async function addSheets(spreadsheetId, requests) {
  try {
    await google.getSheetsClient().spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  } catch (error) {
    throw toSheetsError(error, '');
  }
}

async function writeHeaders(spreadsheetId, name, headers) {
  try {
    await google.getSheetsClient().spreadsheets.values.update({
      spreadsheetId,
      range: google.sheetRange(name, `A1:${columnLetter(headers.length)}1`),
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  } catch (error) {
    throw toSheetsError(error, name);
  }
}

function matchesHeaders(key, row) {
  const actual = Array.isArray(row) ? row.map(x => String(x == null ? '' : x).trim()) : [];
  return reference.SHEET_HEADERS[key].every((x, i) => actual[i] === x);
}

function isFirstRowEmpty(values) {
  if (values.length === 0 || !Array.isArray(values[0])) {
    return true;
  }
  return values[0].every(x => String(x == null ? '' : x).trim() === '');
}

function requireSpreadsheetId(current) {
  if (current.spreadsheetId === '') {
    throw new google.SheetsError('Не задан SPREADSHEET_ID: укажи его в настройках таблицы или в переменных окружения');
  }
  return current.spreadsheetId;
}

function columnLetter(count) {
  let rest = Math.max(1, count);
  let letters = '';
  while (rest > 0) {
    const index = (rest - 1) % 26;
    letters = String.fromCharCode(65 + index) + letters;
    rest = Math.floor((rest - 1) / 26);
  }
  return letters;
}

function toSheetsError(error, name) {
  if (error instanceof google.SheetsError) {
    return error;
  }
  const status = errorStatus(error);
  if (status === 400 && name !== '') {
    return new google.SheetsError(`Не найден лист «${name}», проверь названия листов в настройках таблицы`);
  }
  if (status === 403) {
    return new google.SheetsError('Нет доступа к таблице, проверь, что она расшарена на сервис-аккаунт');
  }
  if (status === 404) {
    return new google.SheetsError('Таблица не найдена, проверь SPREADSHEET_ID');
  }
  const message = error != null && error.message ? String(error.message) : 'Не получилось обратиться к таблице';
  return new google.SheetsError(message);
}

function errorStatus(error) {
  if (error == null) {
    return 0;
  }
  if (typeof error.code === 'number') {
    return error.code;
  }
  if (error.response != null && typeof error.response.status === 'number') {
    return error.response.status;
  }
  if (typeof error.status === 'number') {
    return error.status;
  }
  return 0;
}

module.exports = { checkConnection, createStructure };
