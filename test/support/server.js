const path = require('path');
const { spawn } = require('child_process');
const pg = require('pg');

const ROOT = path.join(__dirname, '..', '..');
const ADMIN_PASSWORD = 'test-password';

async function resetDatabase(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE');
  } catch (error) {
    if (error.code !== '3F000') {
      throw error;
    }
  }
  await client.query('CREATE SCHEMA public');
  await client.end();
}

function databaseUrl() {
  const value = typeof process.env.DATABASE_URL === 'string' ? process.env.DATABASE_URL.trim() : '';
  if (value === '') {
    throw new Error('Тестам нужен DATABASE_URL, укажи адрес тестовой базы');
  }
  return value;
}

async function startServer(options) {
  const settings = options == null ? {} : options;
  const connectionString = databaseUrl();
  if (settings.keepData !== true) {
    await resetDatabase(connectionString);
  }
  const port = 3200 + Math.floor(Math.random() * 600);
  const child = spawn('node', [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      DATABASE_URL: connectionString,
      ADMIN_PASSWORD: settings.adminPassword == null ? ADMIN_PASSWORD : settings.adminPassword,
      SESSION_SECRET: 'test-session-secret',
      PORT: String(port),
      DATA_DIR: settings.dataDir == null ? path.join(ROOT, 'test', 'tmp-data') : settings.dataDir,
      SPREADSHEET_ID: '',
      GOOGLE_SERVICE_ACCOUNT_JSON: '',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', x => logs.push(String(x)));
  child.stderr.on('data', x => logs.push(String(x)));
  const base = `http://127.0.0.1:${port}`;
  await waitForReady(base, child, logs);
  return {
    base,
    logs,
    stop: () => new Promise(resolve => {
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
    }),
  };
}

async function waitForReady(base, child, logs) {
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode != null) {
      throw new Error(`Сервер упал при старте: ${logs.join('')}`);
    }
    try {
      const response = await fetch(`${base}/admin/login`);
      if (response.status === 200) {
        return;
      }
    } catch (error) {
      // сервер еще не поднялся
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Сервер не поднялся: ${logs.join('')}`);
}

function createClient(base) {
  const cookies = new Map();
  const header = () => Array.from(cookies.entries()).map(x => `${x[0]}=${x[1]}`).join('; ');
  const remember = response => {
    const raw = response.headers.getSetCookie == null ? [] : response.headers.getSetCookie();
    raw.forEach(line => {
      const pair = line.split(';')[0];
      const index = pair.indexOf('=');
      if (index > 0) {
        cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
    });
  };
  const request = async (method, target, body) => {
    const options = { method, redirect: 'manual', headers: {} };
    if (header() !== '') {
      options.headers.cookie = header();
    }
    if (body != null) {
      options.headers['content-type'] = 'application/x-www-form-urlencoded';
      options.body = new URLSearchParams(body).toString();
    }
    const response = await fetch(`${base}${target}`, options);
    remember(response);
    const text = await response.text();
    return { status: response.status, location: response.headers.get('location'), text };
  };
  return {
    get: target => request('GET', target, null),
    post: (target, body) => request('POST', target, body),
    cookies,
  };
}

module.exports = { startServer, createClient, resetDatabase, ADMIN_PASSWORD };
