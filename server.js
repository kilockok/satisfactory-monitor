process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createReadStream, appendFileSync, existsSync, mkdirSync } from 'fs';
import { createInterface } from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');

const API_URL = process.env.SATISFACTORY_API || 'https://localhost:7777/api/v1';
const PASSWORD = process.env.SATISFACTORY_PASSWORD || '';
const PORT = parseInt(process.env.PORT || '3000');
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '30000');

// 90d at 30s intervals = 259200 points
const HISTORY_MAX = 259200;
const TICKRATE_FILE = join(DATA_DIR, 'tickrate.jsonl');
const PLAYERS_FILE = join(DATA_DIR, 'players.jsonl');

let authToken = null;

const cache = {
  serverState: null,
  online: false,
  lastUpdated: null,
  tickRateHistory: [],
  playerHistory: [],
};

// persistent storage

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

async function loadJsonl(filePath) {
  if (!existsSync(filePath)) return [];

  const entries = [];
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line) continue;
    try {
      const { t, v } = JSON.parse(line);
      entries.push({ time: t, value: v });
    } catch { /* skip malformed */ }
  }

  // keep only the latest HISTORY_MAX entries
  return entries.length > HISTORY_MAX ? entries.slice(-HISTORY_MAX) : entries;
}

function appendPoint(filePath, time, value) {
  appendFileSync(filePath, JSON.stringify({ t: time, v: value }) + '\n');
}

async function apiCall(func, data = {}, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ function: func, data }),
  });

  const json = await res.json();

  if (json.errorCode === 'insufficient_scope' || json.errorCode === 'invalid_token') {
    const err = new Error(json.errorCode);
    err.code = json.errorCode;
    throw err;
  }

  return json;
}

async function login() {
  const res = await apiCall('PasswordLogin', {
    MinimumPrivilegeLevel: 'Administrator',
    Password: PASSWORD,
  });
  authToken = res.data?.authenticationToken || null;
  return authToken;
}

async function queryWithRetry() {
  try {
    if (!authToken) await login();
    return await apiCall('QueryServerState', {}, authToken);
  } catch (err) {
    if (err.code === 'insufficient_scope' || err.code === 'invalid_token') {
      await login();
      return await apiCall('QueryServerState', {}, authToken);
    }
    throw err;
  }
}

async function poll() {
  try {
    const health = await apiCall('HealthCheck', { ClientCustomData: '' });
    if (health.data?.health !== 'healthy') {
      cache.online = false;
      return;
    }

    const result = await queryWithRetry();
    const state = result.data?.serverGameState;

    if (state) {
      cache.serverState = state;
      cache.online = true;
      cache.lastUpdated = Date.now();

      const now = Math.floor(Date.now() / 1000);

      cache.tickRateHistory.push({ time: now, value: state.averageTickRate });
      cache.playerHistory.push({ time: now, value: state.numConnectedPlayers });

      try {
        appendPoint(TICKRATE_FILE, now, state.averageTickRate);
        appendPoint(PLAYERS_FILE, now, state.numConnectedPlayers);
      } catch (writeErr) {
        console.error('Failed to write history file:', writeErr.message);
      }

      if (cache.tickRateHistory.length > HISTORY_MAX) {
        cache.tickRateHistory = cache.tickRateHistory.slice(-HISTORY_MAX);
      }
      if (cache.playerHistory.length > HISTORY_MAX) {
        cache.playerHistory = cache.playerHistory.slice(-HISTORY_MAX);
      }
    }
  } catch (err) {
    console.error('Poll error:', err.message || err);
    cache.online = false;
  }
}

function filterHistory(history, rangeSeconds) {
  const cutoff = Math.floor(Date.now() / 1000) - rangeSeconds;
  return history.filter((p) => p.time >= cutoff);
}

// range string -> seconds
const RANGES = {
  '1h': 3600,
  '2h': 7200,
  '12h': 43200,
  '1d': 86400,
  '7d': 604800,
  '30d': 2592000,
  '90d': 7776000,
};

const app = Fastify({ logger: false });

await app.register(fastifyStatic, {
  root: join(__dirname, 'public'),
});

app.get('/api/status', async (req) => {
  const range = req.query.range || '2h';
  const seconds = RANGES[range] || 7200;

  return {
    serverState: cache.serverState,
    online: cache.online,
    lastUpdated: cache.lastUpdated,
    tickRateHistory: filterHistory(cache.tickRateHistory, seconds),
    playerHistory: filterHistory(cache.playerHistory, seconds),
  };
});

// load persisted history
cache.tickRateHistory = await loadJsonl(TICKRATE_FILE);
cache.playerHistory = await loadJsonl(PLAYERS_FILE);

await poll();
setInterval(poll, POLL_INTERVAL);

await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`listening on :${PORT}`);
