/* =============================================================================
   OTP Portal — app.js
   All UI logic. Talks to the FastAPI backend via fetch().
   ============================================================================= */

// ── Config defaults ───────────────────────────────────────────────────────────
// These are display-side defaults only. Authoritative values always come from
// the server in API responses (expires_in, wait_estimate, etc.).
const CONFIG = {
  CLAIM_EXPIRY_SEC: 90,    // seconds the active user has to trigger their OTP
  OTP_DISPLAY_SEC:  285,   // seconds the OTP stays on screen (4 min 45 sec)
  POLL_INTERVAL_MS: 3000,  // how often to poll /claim-status
  RING_CIRCUMFERENCE: 263.89,
};

// ── Token input ───────────────────────────────────────────────────────────────
const chars = [0, 1, 2].map(i => document.getElementById('c' + i));

chars.forEach((el, i) => {
  el.addEventListener('input', () => {
    el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    el.classList.toggle('filled', !!el.value);
    if (el.value && i < 2) chars[i + 1].focus();
    chars[2].style.opacity = (chars[0].value && chars[1].value) ? '1' : '0.45';
    updateBtn();
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Backspace' && !el.value && i > 0) chars[i - 1].focus();
  });
  el.addEventListener('paste', e => {
    e.preventDefault();
    const paste = (e.clipboardData.getData('text') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    chars.forEach((c, j) => { c.value = paste[j] || ''; c.classList.toggle('filled', !!c.value); });
    chars[Math.min(paste.length, 2)].focus();
    updateBtn();
  });
});

function updateBtn() {
  const filled = chars.filter(c => c.value.length === 1).length;
  document.getElementById('claim-btn').disabled = filled < 2;
}

function getToken() { return chars.map(c => c.value).join('').trim(); }

// ── Runtime state ─────────────────────────────────────────────────────────────
let pollTimer    = null;
let countTimer   = null;
let currentToken = '';
let activeExpiry = CONFIG.CLAIM_EXPIRY_SEC;
let otpExpiry    = CONFIG.OTP_DISPLAY_SEC;

// ── Claim flow ────────────────────────────────────────────────────────────────
async function claimOtp() {
  const token = getToken();
  const btn   = document.getElementById('claim-btn');
  btn.disabled    = true;
  btn.textContent = 'Submitting…';

  try {
    const res  = await fetch('/claim-otp', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token }),
    });
    const data = await res.json();

    if (!res.ok) {
      showError('Token not recognised', data.detail || 'Check with IT.');
      resetBtn();
      return;
    }

    currentToken = token;
    document.getElementById('claim-card').style.display = 'none';

    if (data.status === 'otp_ready') {
      // OTP already waiting — user may have refreshed the page mid-flow
      otpExpiry = data.expires_in || CONFIG.OTP_DISPLAY_SEC;
      fetchAndShowOtp();
      return;
    }

    if (data.status === 'queued' || data.status === 'already_queued') {
      const position = data.position || 1;
      if (position === 1) {
        activeExpiry = data.expires_in || CONFIG.CLAIM_EXPIRY_SEC;
        showActivePanel(activeExpiry);
      } else {
        showWaitingPanel(position, data.wait_estimate || 0, data.queue_depth || position);
      }
      startPolling();
      return;
    }

    showError('Unexpected response', 'Please try again.');
    resetBtn();

  } catch (e) {
    showError('Network error', 'Could not reach the server. Is it a Monday?');
    resetBtn();
  }
}

function resetBtn() {
  const btn = document.getElementById('claim-btn');
  btn.textContent = 'Claim my slot →';
  updateBtn();
}

// ── Panel: Active (position 1 — go trigger now) ───────────────────────────────
function showActivePanel(expiresIn) {
  showPanel('active');
  startCountdown('active-ring', 'active-ring-text', expiresIn, expiresIn, false);
}

// ── Panel: Waiting room (position > 1) ───────────────────────────────────────
function showWaitingPanel(position, waitEstimateSec, queueDepth) {
  document.getElementById('waiting-badge').textContent =
    'Position #' + position + ' in queue';
  document.getElementById('wait-position').textContent = position;
  document.getElementById('wait-estimate').textContent = fmtWait(waitEstimateSec);
  renderWaitingRoom(position, queueDepth);
  showPanel('waiting');
}

function renderWaitingRoom(myPosition, totalDepth) {
  const container = document.getElementById('waiting-room-rows');
  let html = '';
  for (let i = 1; i <= totalDepth; i++) {
    const isActive = (i === 1);
    const isYou    = (i === myPosition);
    const rowClass = isActive ? 'is-active' : (isYou ? 'is-you' : '');
    const posClass = isActive ? 'active'    : (isYou ? 'you'    : '');
    const lblClass = isActive ? 'active'    : (isYou ? 'you'    : '');
    const label    = isActive ? 'getting OTP now\u2026' : (isYou ? 'you' : 'waiting');
    html += '<div class="waiting-room-row ' + rowClass + '">'
          + '<div class="wr-pos ' + posClass + '">' + i + '</div>'
          + '<div class="wr-label ' + lblClass + '">' + label + '</div>'
          + '</div>';
  }
  container.innerHTML = html;
}

// ── Panel: OTP on screen ──────────────────────────────────────────────────────
function showOtpPanel(otp, expiresIn) {
  document.getElementById('otp-value').textContent = otp;
  otpExpiry = expiresIn;
  showPanel('otp');
  startCountdown('otp-ring', 'otp-ring-text', CONFIG.OTP_DISPLAY_SEC, expiresIn, true);
}

async function fetchAndShowOtp() {
  try {
    const res  = await fetch('/claim-status/' + currentToken);
    const data = await res.json();
    if (data.status === 'delivered' && data.otp) {
      showOtpPanel(data.otp, data.expires_in || CONFIG.OTP_DISPLAY_SEC);
    }
  } catch { /* will be caught by next poll */ }
}

// ── Retry: discard current OTP and re-queue ───────────────────────────────────
async function retryOtp() {
  clearAll();
  try { await fetch('/claim-otp/' + currentToken, { method: 'DELETE' }); } catch { /* best effort */ }

  try {
    const res  = await fetch('/claim-otp', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token: currentToken }),
    });
    const data = await res.json();
    if (!res.ok || !data.status) { showActivePanel(CONFIG.CLAIM_EXPIRY_SEC); startPolling(); return; }
    const position = data.position || 1;
    if (position === 1) {
      activeExpiry = data.expires_in || CONFIG.CLAIM_EXPIRY_SEC;
      showActivePanel(activeExpiry);
    } else {
      showWaitingPanel(position, data.wait_estimate || 0, data.queue_depth || position);
    }
    startPolling();
  } catch {
    showError('Network error', 'Could not re-queue. Try refreshing the page.');
  }
}

// ── Polling ───────────────────────────────────────────────────────────────────
function startPolling() {
  pollTimer = setInterval(async () => {
    try {
      const res  = await fetch('/claim-status/' + currentToken);
      const data = await res.json();

      if (data.status === 'delivered' && data.otp) {
        clearAll();
        showOtpPanel(data.otp, data.expires_in || CONFIG.OTP_DISPLAY_SEC);

      } else if (data.status === 'idle_expired') {
        clearAll();
        showPanel('idle-expired');

      } else if (data.status === 'done') {
        // Display window closed naturally — return to start quietly
        clearAll();
        resetForm();

      } else if (data.status === 'waiting') {
        const pos = data.position || 1;
        if (pos === 1) {
          // Just became #1 — switch to active panel if not already there
          if (!document.getElementById('panel-active').classList.contains('active')) {
            clearInterval(countTimer);
            activeExpiry = data.expires_in || CONFIG.CLAIM_EXPIRY_SEC;
            showActivePanel(activeExpiry);
          }
        } else {
          document.getElementById('waiting-badge').textContent = 'Position #' + pos + ' in queue';
          document.getElementById('wait-position').textContent = pos;
          document.getElementById('wait-estimate').textContent = fmtWait(data.wait_estimate || 0);
          renderWaitingRoom(pos, data.queue_depth || pos);
        }
      }
    } catch { /* silent — server hiccup, will retry */ }
  }, CONFIG.POLL_INTERVAL_MS);
}

// ── Countdown ring ────────────────────────────────────────────────────────────
function startCountdown(ringId, textId, totalSecs, currentSecs, turnOrangeAtEnd) {
  clearInterval(countTimer);
  const ring = document.getElementById(ringId);
  const txt  = document.getElementById(textId);
  let secs   = currentSecs;

  function tick() {
    ring.style.strokeDashoffset = CONFIG.RING_CIRCUMFERENCE * (1 - secs / totalSecs);
    const m = Math.floor(secs / 60), s = secs % 60;
    txt.textContent = m + ':' + s.toString().padStart(2, '0');
    if (turnOrangeAtEnd && secs < 60) ring.classList.add('orange');
    if (secs <= 0) { clearInterval(countTimer); return; }
    secs--;
  }
  tick();
  countTimer = setInterval(tick, 1000);
}

// ── Panel switching ───────────────────────────────────────────────────────────
const ALL_PANELS = ['active', 'waiting', 'otp', 'idle-expired', 'error'];
const PANEL_CLASS = {
  'active':       'active',
  'waiting':      'waiting',
  'otp':          'otp-ready',
  'idle-expired': 'expired',
  'error':        'error',
};

function showPanel(name) {
  ALL_PANELS.forEach(n => {
    const el = document.getElementById('panel-' + n);
    if (!el) return;
    el.className = 'status-panel';
    if (n === name) el.classList.add(PANEL_CLASS[name] || name);
  });
}

function showError(title, msg) {
  document.getElementById('err-title').textContent = title;
  document.getElementById('err-sub').textContent   = msg;
  showPanel('error');
}

// ── Reset ─────────────────────────────────────────────────────────────────────
function clearAll() {
  clearInterval(pollTimer);
  clearInterval(countTimer);
  pollTimer = countTimer = null;
}

function resetForm() {
  clearAll();
  chars.forEach(c => { c.value = ''; c.classList.remove('filled'); });
  chars[2].style.opacity = '0.45';
  showPanel('');
  document.getElementById('claim-card').style.display = 'block';
  resetBtn();
  chars[0].focus();
  ['active-ring', 'otp-ring'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.strokeDashoffset = '0'; el.classList.remove('orange'); }
  });
  document.getElementById('active-ring-text').textContent = '1:30';
  document.getElementById('otp-ring-text').textContent    = '4:45';
  document.getElementById('otp-value').textContent        = '\u2014\u2014\u2014\u2014\u2014\u2014';
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtWait(secs) {
  if (secs <= 0) return 'any moment';
  const m = Math.floor(secs / 60), s = secs % 60;
  if (m === 0) return '\u2264 ' + s + ' s';
  if (s === 0) return '\u2264 ' + m + ' min';
  return '\u2264 ' + m + ' min ' + s + ' s';
}

function fmtTime(utcStr) {
  const d = new Date(utcStr);
  return d.toLocaleString(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

// ── Admin ─────────────────────────────────────────────────────────────────────
let adminVisible      = false;
let adminRefreshTimer = null;
let allLogEntries     = [];
let activeStatus      = 'all';

function toggleAdmin() {
  adminVisible = !adminVisible;
  document.getElementById('user-view').style.display  = adminVisible ? 'none' : 'flex';
  document.getElementById('admin-view').style.display = adminVisible ? 'flex' : 'none';
  document.getElementById('admin-toggle').textContent = adminVisible ? '\u2190 Back' : 'Admin';
  if (adminVisible) {
    loadAdmin();
    adminRefreshTimer = setInterval(loadAdmin, 15000);
  } else {
    clearInterval(adminRefreshTimer);
    adminRefreshTimer = null;
  }
}

function setStatusFilter(status) {
  activeStatus = status;
  document.querySelectorAll('#status-chips .filter-chip').forEach(chip => {
    const s = chip.dataset.status;
    chip.className = 'filter-chip' + (s === status ? ' active-' + s : '');
  });
  applyFilters();
}

function applyFilters() {
  const search   = document.getElementById('log-search').value.trim().toLowerCase();
  const eventSel = document.getElementById('event-select').value;
  const tbody    = document.getElementById('log-body');

  const filtered = allLogEntries.filter(e => {
    if (activeStatus !== 'all' && e.status !== activeStatus) return false;
    if (eventSel && e.event !== eventSel) return false;
    if (search) {
      const hay = (e.token + ' ' + e.detail + ' ' + e.event).toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  document.getElementById('log-count').innerHTML =
    'Showing <span>' + filtered.length + '</span> of <span>' + allLogEntries.length + '</span>';

  tbody.innerHTML = filtered.length === 0
    ? '<tr><td colspan="5" class="empty-msg">// nothing matches \u2014 try loosening the filters</td></tr>'
    : filtered.map(e =>
        '<tr>'
        + '<td>' + fmtTime(e.ts) + '</td>'
        + '<td>' + e.event + '</td>'
        + '<td>' + (e.token || '\u2014') + '</td>'
        + '<td style="max-width:320px;word-break:break-word;color:var(--muted)">' + e.detail + '</td>'
        + '<td><span class="pill ' + e.status + '">' + e.status + '</span></td>'
        + '</tr>'
      ).join('');
}

function populateEventDropdown(entries) {
  const events = [...new Set(entries.map(e => e.event))].sort();
  const sel    = document.getElementById('event-select');
  const cur    = sel.value;
  sel.innerHTML = '<option value="">All events</option>'
    + events.map(ev => '<option value="' + ev + '"' + (ev === cur ? ' selected' : '') + '>' + ev + '</option>').join('');
}

async function loadAdmin() {
  const btns = ['refresh-queue-btn', 'refresh-log-btn']
    .map(id => document.getElementById(id)).filter(Boolean);
  btns.forEach(b => b.classList.add('refreshing'));
  ['s-total', 's-queue', 's-users'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('loading');
  });

  try {
    const [logRes, qRes, uRes] = await Promise.all([
      fetch('/admin/log?limit=500'), fetch('/admin/queue'), fetch('/admin/users'),
    ]);
    const log   = await logRes.json();
    const queue = await qRes.json();
    const users = await uRes.json();

    document.getElementById('s-total').textContent = log.total;
    document.getElementById('s-queue').textContent = queue.queue.length;
    document.getElementById('s-users').textContent = users.count;
    const refreshEl = document.getElementById('last-refreshed');
    if (refreshEl) refreshEl.textContent = 'refreshed ' + new Date().toLocaleTimeString();

    const ql = document.getElementById('queue-list');
    ql.innerHTML = queue.queue.length === 0
      ? '<div class="empty-msg">// nobody here</div>'
      : queue.queue.map((c, i) =>
          '<div class="queue-item">'
          + '<div style="display:flex;align-items:center">'
          + '<div class="q-pos">' + (c.position || i + 1) + '</div>'
          + '<div>'
          + '<div style="font-weight:700;color:var(--deep);font-size:13px">' + c.token + ' \u2014 ' + c.name + '</div>'
          + '<div style="color:var(--muted);font-size:11px;font-family:var(--mono)">' + c.email + '</div>'
          + '</div></div>'
          + '<div style="text-align:right">'
          + '<div style="color:var(--muted);font-size:10px;font-family:var(--mono)">' + fmtTime(c.claimed_at) + '</div>'
          + '<div style="color:var(--warn);font-size:10px;font-family:var(--mono)">exp in ' + c.expires_in + 's</div>'
          + '</div></div>'
        ).join('');

    allLogEntries = log.entries;
    populateEventDropdown(allLogEntries);
    applyFilters();

    ['queue-list', 'log-body'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.classList.remove('refresh-flash'); void el.offsetWidth; el.classList.add('refresh-flash'); }
    });

  } catch (e) {
    document.getElementById('log-body').innerHTML =
      '<tr><td colspan="5" class="empty-msg">// cannot reach server</td></tr>';
  } finally {
    btns.forEach(b => b.classList.remove('refreshing'));
    ['s-total', 's-queue', 's-users'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('loading');
    });
  }
}
