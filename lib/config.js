const fs = require('fs');
const path = require('path');
const reference = require('./reference');

const DATA_DIRECTORY = typeof process.env.DATA_DIR === 'string' && process.env.DATA_DIR.trim() !== ''
  ? path.resolve(process.env.DATA_DIR.trim())
  : path.join(__dirname, '..', 'data');

const CONFIG_FILE = path.join(DATA_DIRECTORY, 'config.json');

let cachedFile = null;

function getConfig() {
  const stored = readStoredConfig();
  const storedSheets = stored.sheets != null && typeof stored.sheets === 'object' ? stored.sheets : {};
  return {
    spreadsheetId: firstFilled(stored.spreadsheetId, process.env.SPREADSHEET_ID),
    sheets: {
      participants: firstFilled(storedSheets.participants, reference.DEFAULT_SHEET_NAMES.participants),
      songs: firstFilled(storedSheets.songs, reference.DEFAULT_SHEET_NAMES.songs),
      likes: firstFilled(storedSheets.likes, reference.DEFAULT_SHEET_NAMES.likes),
    },
  };
}

function saveConfig(patch) {
  const stored = readStoredConfig();
  const storedSheets = stored.sheets != null && typeof stored.sheets === 'object' ? stored.sheets : {};
  const source = patch != null && typeof patch === 'object' ? patch : {};
  const sheetsPatch = source.sheets != null && typeof source.sheets === 'object' ? source.sheets : {};
  const next = {
    spreadsheetId: pickString(source.spreadsheetId, stored.spreadsheetId),
    sheets: {
      participants: pickString(sheetsPatch.participants, storedSheets.participants),
      songs: pickString(sheetsPatch.songs, storedSheets.songs),
      likes: pickString(sheetsPatch.likes, storedSheets.likes),
    },
  };
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  cachedFile = next;
}

function readStoredConfig() {
  if (cachedFile == null) {
    cachedFile = loadStoredConfig();
  }
  return cachedFile;
}

function loadStoredConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch (error) {
    return {};
  }
}

function firstFilled(value, fallback) {
  const primary = toTrimmedString(value);
  if (primary !== '') {
    return primary;
  }
  return toTrimmedString(fallback);
}

function pickString(value, fallback) {
  if (typeof value === 'string') {
    return value.trim();
  }
  return toTrimmedString(fallback);
}

function toTrimmedString(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

module.exports = { getConfig, saveConfig };
