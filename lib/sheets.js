const reference = require('./reference');
const config = require('./config');
const google = require('./google');

async function readSheet(key) {
  const table = await fetchTable(key);
  if (table.headers.indexOf('id') < 0) {
    return [];
  }
  return table.values
    .slice(1)
    .map(x => toObject(key, table.headers, x))
    .filter(x => x.id !== '');
}

async function syncRows(key, rows) {
  if (rows.length === 0) {
    return { updated: 0, appended: 0 };
  }
  const table = await fetchTable(key);
  const headers = table.headers.length > 0 ? table.headers : reference.SHEET_HEADERS[key].slice();
  const idIndex = headers.indexOf('id');
  if (idIndex < 0) {
    throw new google.SheetsError(`В листе «${table.name}» нет колонки id, проверь заголовки`);
  }
  const lastColumn = columnLetter(headers.length);
  const updates = [];
  const appends = [];
  rows.forEach(row => {
    const values = headers.map(x => (row[x] == null ? '' : String(row[x])));
    const rowNumber = findRowNumber(table.values, idIndex, row.id);
    if (rowNumber < 0) {
      appends.push(values);
    } else {
      updates.push({ range: google.sheetRange(table.name, `A${rowNumber}:${lastColumn}${rowNumber}`), values: [values] });
    }
  });
  if (updates.length > 0) {
    await call(table.name, client => client.spreadsheets.values.batchUpdate({
      spreadsheetId: spreadsheetId(),
      requestBody: { valueInputOption: 'RAW', data: updates },
    }));
  }
  if (appends.length > 0) {
    await call(table.name, client => client.spreadsheets.values.append({
      spreadsheetId: spreadsheetId(),
      range: google.sheetRange(table.name),
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: appends },
    }));
  }
  return { updated: updates.length, appended: appends.length };
}

async function replaceSheet(key, rows) {
  const name = sheetName(key);
  const headers = reference.SHEET_HEADERS[key];
  const values = [headers.slice()].concat(rows.map(row => headers.map(x => (row[x] == null ? '' : String(row[x])))));
  await call(name, client => client.spreadsheets.values.clear({
    spreadsheetId: spreadsheetId(),
    range: google.sheetRange(name),
  }));
  await call(name, client => client.spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: google.sheetRange(name, `A1:${columnLetter(headers.length)}${values.length}`),
    valueInputOption: 'RAW',
    requestBody: { values },
  }));
}

async function fetchTable(key) {
  const name = sheetName(key);
  const response = await call(name, client => client.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: google.sheetRange(name),
  }));
  const values = response != null && response.data != null && Array.isArray(response.data.values)
    ? response.data.values
    : [];
  const headers = values.length > 0 ? values[0].map(x => String(x == null ? '' : x).trim()) : [];
  return { name, headers, values };
}

async function call(name, action) {
  try {
    return await action(google.getSheetsClient());
  } catch (error) {
    throw toSheetsError(error, name);
  }
}

function toObject(key, headers, row) {
  const source = Array.isArray(row) ? row : [];
  const result = {};
  reference.SHEET_HEADERS[key].forEach(x => {
    const index = headers.indexOf(x);
    result[x] = index >= 0 && source[index] != null ? String(source[index]) : '';
  });
  return result;
}

function findRowNumber(values, idIndex, id) {
  const needle = String(id == null ? '' : id).trim();
  if (needle === '') {
    return -1;
  }
  for (let i = 1; i < values.length; i += 1) {
    const row = Array.isArray(values[i]) ? values[i] : [];
    if (String(row[idIndex] == null ? '' : row[idIndex]).trim() === needle) {
      return i + 1;
    }
  }
  return -1;
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

function sheetName(key) {
  return config.getConfig().sheets[key];
}

function spreadsheetId() {
  const value = config.getConfig().spreadsheetId;
  if (value === '') {
    throw new google.SheetsError('Не задан SPREADSHEET_ID: укажи его в настройках таблицы или в переменных окружения');
  }
  return value;
}

function toSheetsError(error, name) {
  if (error instanceof google.SheetsError) {
    return error;
  }
  const status = errorStatus(error);
  if (status === 400) {
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

module.exports = { readSheet, syncRows, replaceSheet };
