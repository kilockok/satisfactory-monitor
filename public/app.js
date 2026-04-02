const REFRESH = 30000;

const $ = (id) => document.getElementById(id);

// state
let tickChart = null;
let playerChart = null;
let tickRange = '2h';
let playerRange = '2h';
let lastData = null;

const RANGE_ORDER = ['1h', '2h', '12h', '1d', '7d', '30d', '90d'];

function parsePhase(raw) {
  if (!raw || raw === 'None') return 'None';
  const m = raw.match(/GP_([^.']+)/);
  if (!m) return raw;
  return m[1].replace(/_/g, ' ');
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

let localTimer = 0;

function timeAgo() {
  return localTimer < 1 ? 'just now' : `${localTimer}s ago`;
}

function tickClass(val) {
  if (val > 25) return 'tick-good';
  if (val > 15) return 'tick-warn';
  return 'tick-bad';
}

function formatTime(ts) {
  const d = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDate(ts) {
  const d = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ── animation helpers ── */

function flashElement(el) {
  el.classList.remove('flash');
  void el.offsetWidth; // force reflow to restart animation
  el.classList.add('flash');
}

function updateText(id, newText) {
  const el = $(id);
  if (el.textContent !== newText) {
    el.textContent = newText;
    flashElement(el);
  }
}

/* ── tooltip plugin for uPlot ── */

function tooltipPlugin(unit) {
  let tooltip;

  function init(u) {
    tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip';
    u.root.querySelector('.u-over').appendChild(tooltip);
  }

  function setCursor(u) {
    const idx = u.cursor.idx;
    if (idx == null) {
      tooltip.classList.remove('visible');
      return;
    }

    const ts = u.data[0][idx];
    const val = u.data[1][idx];
    if (ts == null || val == null) {
      tooltip.classList.remove('visible');
      return;
    }

    const rangeSpan = (u.data[0][u.data[0].length - 1] || 0) - (u.data[0][0] || 0);
    const timeStr = rangeSpan > 86400 ? formatDate(ts) : formatTime(ts);

    tooltip.innerHTML =
      `<div class="chart-tooltip-time">${timeStr}</div>` +
      `<div>${typeof val === 'number' ? val.toFixed(unit === 'tick' ? 1 : 0) : val}${unit === 'tick' ? ' t/s' : ''}</div>`;

    tooltip.classList.add('visible');

    const left = u.valToPos(ts, 'x');
    const top = u.valToPos(val, 'y');
    const bnd = u.root.querySelector('.u-over').getBoundingClientRect();
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;

    let tx = left + 10;
    let ty = top - th - 6;
    if (tx + tw > bnd.width) tx = left - tw - 10;
    if (ty < 0) ty = top + 10;

    tooltip.style.left = tx + 'px';
    tooltip.style.top = ty + 'px';
  }

  return { hooks: { init, setCursor } };
}

/* ── chart creation ── */

function createChart(wrap, data, yRange, unit) {
  const rect = wrap.getBoundingClientRect();
  const w = rect.width - 20;
  const h = rect.height - 12;

  const fontStr = '10px "MiSans", sans-serif';

  const opts = {
    width: w,
    height: h,
    cursor: { show: true, drag: { x: false, y: false } },
    select: { show: false },
    plugins: [tooltipPlugin(unit)],
    scales: {
      x: { time: true },
      y: { range: yRange },
    },
    axes: [
      {
        stroke: '#404040',
        grid: { stroke: '#1a1a1a', width: 1 },
        ticks: { stroke: '#1a1a1a', width: 1 },
        font: fontStr,
        gap: 4,
      },
      {
        stroke: '#404040',
        grid: { stroke: '#1a1a1a', width: 1 },
        ticks: { stroke: '#1a1a1a', width: 1 },
        font: fontStr,
        gap: 6,
        values: (_, ticks) => ticks.map((v) => v.toFixed(0)),
      },
    ],
    series: [
      {},
      {
        label: unit === 'tick' ? 'Tick Rate' : 'Players',
        stroke: '#e5e5e5',
        width: 1.5,
        fill: 'rgba(229, 229, 229, 0.03)',
        points: { show: false },
      },
    ],
  };

  return new uPlot(opts, data, wrap);
}

function buildChartData(history) {
  return [
    history.map((p) => p.time),
    history.map((p) => p.value),
  ];
}

function updateTickChart(history) {
  if (!history || history.length === 0) {
    if (tickChart) tickChart.setData([[], []]);
    return;
  }

  const data = buildChartData(history);
  const wrap = $('tickChartWrap');

  if (!tickChart) {
    tickChart = createChart(wrap, data, [0, 35], 'tick');
  } else {
    tickChart.setData(data);
  }
}

function updatePlayerChart(history, playerLimit) {
  if (!history || history.length === 0) {
    if (playerChart) playerChart.setData([[], []]);
    return;
  }

  const data = buildChartData(history);
  const wrap = $('playerChartWrap');
  const yMax = Math.max(playerLimit || 32, 4);

  if (!playerChart) {
    playerChart = createChart(wrap, data, [0, yMax], 'player');
  } else {
    playerChart.setData(data);
  }
}

/* ── filter data client-side for per-chart range ── */

function filterByRange(history, range) {
  const ranges = { '1h': 3600, '2h': 7200, '12h': 43200, '1d': 86400, '7d': 604800, '30d': 2592000, '90d': 7776000 };
  const cutoff = Math.floor(Date.now() / 1000) - (ranges[range] || 7200);
  return history.filter((p) => p.time >= cutoff);
}

/* ── render ── */

function render(data) {
  const dot = $('statusDot');
  const statusEl = $('statusText');

  if (data.online) {
    dot.className = 'status-dot online';
    statusEl.textContent = 'online';
  } else {
    dot.className = 'status-dot offline';
    statusEl.textContent = 'offline';
  }

  const updateEl = $('updateText');
  updateEl.textContent = timeAgo();
  localTimer = 0; // reset counter on each successful fetch

  const s = data.serverState;
  if (!s) return;

  updateText('players', `${s.numConnectedPlayers} / ${s.playerLimit}`);

  const tr = $('tickRate');
  const trVal = s.averageTickRate;
  const trText = trVal.toFixed(1);
  const newClass = `metric-value ${tickClass(trVal)}`;
  if (tr.textContent !== trText) {
    tr.textContent = trText;
    tr.className = newClass;
    flashElement(tr);
  } else {
    tr.className = newClass;
  }

  updateText('techTier', `Tier ${s.techTier}`);
  updateText('uptime', formatDuration(s.totalGameDuration));
  updateText('sessionName', s.activeSessionName || '--');
  updateText('gamePhase', parsePhase(s.gamePhase));
  updateText('schematic', s.activeSchematic === 'None' ? 'None' : s.activeSchematic);

  const running = s.isGameRunning;
  const paused = s.isGamePaused;
  let status = 'Stopped';
  if (running && !paused) status = 'Running';
  if (running && paused) status = 'Paused';
  updateText('gameStatus', status);
  updateText('autoLoad', s.autoLoadSessionName || '--');

  // KEY FIX: always filter by the currently selected range before drawing
  updateTickChart(filterByRange(data.tickRateHistory, tickRange));
  updatePlayerChart(filterByRange(data.playerHistory, playerRange), s.playerLimit);
}

/* ── fetch ── */

function getMaxRange() {
  const ti = RANGE_ORDER.indexOf(tickRange);
  const pi = RANGE_ORDER.indexOf(playerRange);
  return RANGE_ORDER[Math.max(ti, pi)] || '2h';
}

async function fetchStatus() {
  try {
    const range = getMaxRange();
    const res = await fetch(`/api/status?range=${range}`);
    const data = await res.json();
    lastData = data;
    render(data);
  } catch {
    $('statusDot').className = 'status-dot offline';
    $('statusText').textContent = 'error';
  }
}

/* ── per-chart redraw helpers ── */

function redrawTickChart() {
  if (!lastData) return;
  if (tickChart) { tickChart.destroy(); tickChart = null; }
  updateTickChart(filterByRange(lastData.tickRateHistory, tickRange));
}

function redrawPlayerChart() {
  if (!lastData) return;
  if (playerChart) { playerChart.destroy(); playerChart = null; }
  updatePlayerChart(
    filterByRange(lastData.playerHistory, playerRange),
    lastData.serverState?.playerLimit
  );
}

/* ── range tab handlers ── */

function needsRefetch(oldTick, oldPlayer, newTick, newPlayer) {
  const oldMax = Math.max(RANGE_ORDER.indexOf(oldTick), RANGE_ORDER.indexOf(oldPlayer));
  const newMax = Math.max(RANGE_ORDER.indexOf(newTick), RANGE_ORDER.indexOf(newPlayer));
  return newMax > oldMax;
}

function setupRangeTabs(containerId, getRange, setRange, redraw) {
  const container = $(containerId);
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.range-btn');
    if (!btn) return;

    container.querySelectorAll('.range-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    const oldTick = tickRange;
    const oldPlayer = playerRange;
    setRange(btn.dataset.range);

    if (needsRefetch(oldTick, oldPlayer, tickRange, playerRange)) {
      // need wider data window from server
      fetchStatus();
    } else {
      // local filter is enough
      redraw();
    }
  });
}

setupRangeTabs(
  'tickRangeTabs',
  () => tickRange,
  (r) => { tickRange = r; },
  redrawTickChart
);

setupRangeTabs(
  'playerRangeTabs',
  () => playerRange,
  (r) => { playerRange = r; },
  redrawPlayerChart
);

/* ── resize ── */

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (tickChart) {
      const w1 = $('tickChartWrap').getBoundingClientRect();
      tickChart.setSize({ width: w1.width - 20, height: w1.height - 12 });
    }
    if (playerChart) {
      const w2 = $('playerChartWrap').getBoundingClientRect();
      playerChart.setSize({ width: w2.width - 20, height: w2.height - 12 });
    }
  }, 200);
});

/* ── live tick: update "Xs ago" every second ── */

function tickTimeAgo() {
  localTimer++;
  $('updateText').textContent = timeAgo();
}

/* ── boot ── */

fetchStatus();
setInterval(fetchStatus, REFRESH);
setInterval(tickTimeAgo, 1000);
