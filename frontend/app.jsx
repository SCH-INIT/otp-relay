const { useEffect, useMemo, useRef, useState } = React;

const CONFIG = {
  CLAIM_EXPIRY_SEC: 90,
  OTP_DISPLAY_SEC: 285,
  POLL_INTERVAL_MS: 3000,
  RING_CIRCUMFERENCE: 263.89,
};

const API = {
  async json(url, options = {}) {
    const { headers, ...fetchOptions } = options;
    const res = await fetch(url, {
      ...fetchOptions,
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const raw = data && (data.detail || data.error || data.message);
      let message = `Request failed: ${res.status}`;
      if (typeof raw === 'string') message = raw;
      else if (Array.isArray(raw)) message = raw.map(item => item.msg || item.message || String(item)).join('; ');
      else if (raw && typeof raw === 'object') message = raw.msg || raw.message || JSON.stringify(raw);
      const error = new Error(message);
      error.status = res.status;
      throw error;
    }
    return data;
  },
  claimOtp(token) { return this.json('/claim-otp', { method: 'POST', body: JSON.stringify({ token }) }); },
  claimStatus(token) { return this.json(`/claim-status/${encodeURIComponent(token)}`); },
  deleteClaim(token) { return this.json(`/claim-otp/${encodeURIComponent(token)}`, { method: 'DELETE' }); },
  adminAuthStatus() { return this.json('/admin/auth/status'); },
  userLogin(token, pin, confirmPin, adminSession) {
    const body = { token };
    if (pin) body.pin = pin;
    if (confirmPin) body.confirm_pin = confirmPin;
    if (adminSession) body.admin_session = adminSession;
    return this.json('/user/login', { method: 'POST', body: JSON.stringify(body) });
  },
  adminAuthSetup(token, credential, current) { return this.json('/admin/auth/setup', { method: 'POST', body: JSON.stringify({ token, credential, current }) }); },
  adminAuthLogout(session) { return this.json('/admin/auth/logout', { method: 'POST', headers: { 'X-Admin-Session': session } }); },
  adminResetRequest(token) { return this.json('/admin/auth/reset-request', { method: 'POST', body: JSON.stringify({ token }) }); },
  adminResetConfirm(token, code) { return this.json('/admin/auth/reset-confirm', { method: 'POST', body: JSON.stringify({ token, credential: code }) }); },
  adminResetPeer(session, token) { return this.json('/admin/auth/reset-peer', { method: 'POST', headers: { 'X-Admin-Session': session }, body: JSON.stringify({ token }) }); },
  adminQueue(session) { return this.json('/admin/queue', { headers: { 'X-Admin-Session': session } }); },
  adminUsers(session) { return this.json('/admin/users', { headers: { 'X-Admin-Session': session } }); },
  reloadUsers(session) { return this.json('/admin/reload-users', { method: 'POST', headers: { 'X-Admin-Session': session } }); },
  adminLog(session) { return this.json('/admin/log?limit=500', { headers: { 'X-Admin-Session': session } }); },
  adminConfig(session) { return this.json('/admin/config', { headers: { 'X-Admin-Session': session } }); },
  saveAdminConfig(session, adminTokens) {
    return this.json('/admin/config', { method: 'POST', headers: { 'X-Admin-Session': session }, body: JSON.stringify({ admin_tokens: adminTokens }) });
  },
  adminProfile(session) { return this.json('/admin/profile', { headers: { 'X-Admin-Session': session } }); },
  saveAdminProfile(session, profile) {
    return this.json('/admin/profile', { method: 'POST', headers: { 'X-Admin-Session': session }, body: JSON.stringify(profile) });
  },
  async uploadUsersExcel(session, file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/admin/users/upload', { method: 'POST', headers: { 'X-Admin-Session': session }, body: form });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const error = new Error((data && (data.detail || data.error || data.message)) || `Upload failed: ${res.status}`);
      error.status = res.status;
      throw error;
    }
    return data;
  },
};

function normalizeToken(value) {
  return String(value || '').trim().toUpperCase();
}

function fmtDubaiDateTime(iso) {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-GB', {
    timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).replace(',', '');
}

function toDateInputValue(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function fromDateInputValue(value) {
  return value ? new Date(`${value}T00:00:00`).toISOString() : null;
}

function daysLeft(iso) {
  if (!iso) return null;
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) return null;
  return Math.ceil((start.getTime() + 90 * 86400000 - Date.now()) / 86400000);
}

function countdownTone(days) {
  if (days == null || days > 14) return 'good';
  if (days > 0) return 'warn';
  return 'bad';
}

function Logo() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 44" height="36" aria-label="INIT - The Future of Mobility">
      <circle cx="10" cy="6" r="5.5" fill="#009D3C"/><rect x="6" y="14" width="8" height="22" rx="4" fill="#009D3C"/>
      <rect x="22" y="8" width="8" height="28" rx="4" fill="#009D3C"/><rect x="22" y="8" width="22" height="8" rx="4" fill="#009D3C"/>
      <rect x="36" y="8" width="8" height="28" rx="4" fill="#009D3C"/><circle cx="56" cy="6" r="5.5" fill="#009D3C"/>
      <rect x="52" y="14" width="8" height="22" rx="4" fill="#009D3C"/><rect x="68" y="8" width="8" height="28" rx="4" fill="#009D3C"/>
      <rect x="62" y="8" width="26" height="8" rx="4" fill="#009D3C"/><polygon points="85,4 96,12 85,20" fill="#009D3C"/>
      <text x="0" y="42" fontFamily="DM Sans, sans-serif" fontSize="8.5" fill="#B0B0B0">The Future of Mobility</text>
    </svg>
  );
}

const RS = {
  white: '#FFFFFF', neutral100: '#F2F2F2', neutral300: '#D4D4D4', neutral700: '#656565', neutral900: '#363A3B',
  primary50: '#F2F7FC', primary100: '#E3EFF9', primary800: '#006DCC', warning100: '#FFF2D7', warning500: '#F59C34',
  error100: '#FFF1EC', error500: '#ED502C',
};

function filterChipStyle(kind, active) {
  const base = { borderRadius: 4, border: `1px solid ${RS.neutral300}`, padding: '5px 10px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', background: RS.white, color: RS.neutral900, cursor: 'pointer', lineHeight: 1.1, textTransform: 'uppercase', fontFamily: 'JetBrains Mono, monospace' };
  if (!active) return base;
  if (kind === 'warn') return { ...base, background: RS.warning100, borderColor: RS.warning500, color: RS.warning500 };
  if (kind === 'error') return { ...base, background: RS.error100, borderColor: RS.error500, color: RS.error500 };
  return { ...base, background: RS.primary100, borderColor: RS.primary800, color: RS.primary800 };
}

function statusPillStyle(status) {
  const base = { display: 'inline-block', borderRadius: 999, padding: '6px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', border: '1px solid transparent' };
  if (status === 'error') return { ...base, background: RS.error100, borderColor: RS.error500, color: RS.error500 };
  if (status === 'warn') return { ...base, background: RS.warning100, borderColor: RS.warning500, color: RS.warning500 };
  return { ...base, background: RS.primary50, borderColor: RS.primary800, color: RS.primary800 };
}

function App() {
  const [view, setView] = useState('otp');
  const [currentUser, setCurrentUser] = useState(null);
  const [login, setLogin] = useState({ tokenChars: ['', '', ''], error: '', loading: false, pin: '', confirmPin: '', resetMode: false, resetCode: '', resetSent: false, resetSuccess: false });
  const [otp, setOtp] = useState({ panel: 'claim', message: '', position: 1, waitEstimate: 0, queueDepth: 0, otpValue: '---', activeRemaining: CONFIG.CLAIM_EXPIRY_SEC, otpRemaining: CONFIG.OTP_DISPLAY_SEC, token: '' });
  const [admin, setAdmin] = useState({ session: sessionStorage.getItem('adminSession') || '', who: sessionStorage.getItem('adminWho') || '', configured: false, error: '', data: null, loading: false, configTokens: 'JPR, AMD, SCH', adminTokens: [], configuredTokens: [] });
  const [adminProfile, setAdminProfile] = useState(null);

  const emptyLogin = (message = '') => ({ tokenChars: ['', '', ''], error: message, loading: false, pin: '', confirmPin: '', resetMode: false, resetCode: '', resetSent: false, resetSuccess: false });
  const isExpiredError = error => error && (error.status === 401 || error.status === 403);

  useEffect(() => {
    API.adminAuthStatus().then(data => setAdmin(state => ({ ...state, configured: !!data.configured, adminTokens: data.admin_tokens || [], configuredTokens: data.configured_tokens || [] }))).catch(() => {});
    const remembered = normalizeToken(sessionStorage.getItem('portalUserToken'));
    const existingSession = sessionStorage.getItem('adminSession') || '';
    if (!remembered) return;
    API.userLogin(remembered, undefined, undefined, existingSession || undefined).then(found => {
      if (found.requires_pin) return clearAdminSession();
      const token = normalizeToken(found.token);
      setCurrentUser({ token, name: found.name || '', email: found.email || '' });
      setOtp(state => ({ ...state, token }));
      if (found.admin_session) {
        sessionStorage.setItem('adminSession', found.admin_session);
        sessionStorage.setItem('adminWho', token);
        setAdmin(state => ({ ...state, session: found.admin_session, who: token }));
        loadAdminProfile(found.admin_session);
      }
    }).catch(() => clearAdminSession());
  }, []);

  useEffect(() => {
    if (!otp.panel || otp.panel === 'claim' || !otp.token) return undefined;
    const timer = setInterval(async () => {
      try {
        const data = await API.claimStatus(otp.token);
        if (data.status === 'delivered' && data.otp) setOtp(state => ({ ...state, panel: 'otp', otpValue: data.otp, otpRemaining: data.expires_in || CONFIG.OTP_DISPLAY_SEC }));
        else if (data.status === 'idle_expired') setOtp(state => ({ ...state, panel: 'expired' }));
        else if (data.status === 'done') resetClaim();
        else if (data.status === 'waiting') {
          const position = data.position || 1;
          setOtp(state => ({ ...state, panel: position === 1 ? 'active' : 'waiting', position, waitEstimate: data.wait_estimate || 0, queueDepth: data.queue_depth || position, activeRemaining: data.expires_in || CONFIG.CLAIM_EXPIRY_SEC }));
        }
      } catch {}
    }, CONFIG.POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [otp.token, otp.panel]);

  useEffect(() => {
    if (otp.panel !== 'active' && otp.panel !== 'otp') return undefined;
    const timer = setInterval(() => setOtp(state => ({ ...state, ...(state.panel === 'active' ? { activeRemaining: Math.max(0, state.activeRemaining - 1) } : { otpRemaining: Math.max(0, state.otpRemaining - 1) }) })), 1000);
    return () => clearInterval(timer);
  }, [otp.panel]);

  function clearAdminSession(message = '') {
    sessionStorage.removeItem('adminSession'); sessionStorage.removeItem('adminWho'); sessionStorage.removeItem('portalUserToken');
    setAdmin(state => ({ ...state, session: '', who: '', data: null, error: '', loading: false }));
    setAdminProfile(null); setCurrentUser(null); setView('otp'); setLogin(emptyLogin(message));
  }

  async function loadAdminProfile(session = admin.session) {
    if (!session) return;
    try { setAdminProfile(await API.adminProfile(session)); }
    catch (error) { if (isExpiredError(error)) clearAdminSession('Your admin session expired. Please log in again.'); }
  }

  async function loadAdminData(session = admin.session) {
    if (!session) return false;
    setAdmin(state => ({ ...state, loading: true, error: '' }));
    try {
      const rethrow401 = fallback => error => { if (isExpiredError(error)) throw error; return fallback; };
      const [queue, users, log, config] = await Promise.all([
        API.adminQueue(session).catch(rethrow401({ queue: [] })),
        API.adminUsers(session).catch(rethrow401({ count: 0, users: [] })),
        API.adminLog(session).catch(rethrow401({ total: 0, entries: [] })),
        API.adminConfig(session).catch(rethrow401({ admin_tokens: [] })),
      ]);
      setAdmin(state => ({ ...state, data: { users: users.users || [], queue: queue.queue || [], log: log.entries || [], logTotal: log.total || 0, userCount: users.count || (users.users || []).length }, configTokens: (config.admin_tokens || []).join(', '), loading: false }));
      return true;
    } catch (error) {
      if (isExpiredError(error)) { clearAdminSession('Your admin session expired. Please log in again.'); return false; }
      setAdmin(state => ({ ...state, error: error.message, loading: false })); return false;
    }
  }

  async function claimOtp() {
    const token = normalizeToken(currentUser && currentUser.token);
    try {
      const data = await API.claimOtp(token);
      if (data.status === 'otp_ready') return setOtp(state => ({ ...state, token, panel: 'otp', otpValue: data.otp || '---', otpRemaining: data.expires_in || CONFIG.OTP_DISPLAY_SEC }));
      const position = data.position || 1;
      setOtp(state => ({ ...state, token, panel: position === 1 ? 'active' : 'waiting', position, waitEstimate: data.wait_estimate || 0, queueDepth: data.queue_depth || position, activeRemaining: data.expires_in || CONFIG.CLAIM_EXPIRY_SEC }));
    } catch (error) { setOtp(state => ({ ...state, panel: 'error', message: error.message || 'Could not claim slot' })); }
  }

  function resetClaim() {
    setOtp({ panel: 'claim', message: '', position: 1, waitEstimate: 0, queueDepth: 0, otpValue: '---', activeRemaining: CONFIG.CLAIM_EXPIRY_SEC, otpRemaining: CONFIG.OTP_DISPLAY_SEC, token: normalizeToken(currentUser && currentUser.token) });
  }

  async function retryOtp() {
    try { if (otp.token) await API.deleteClaim(otp.token); } catch {}
    try {
      const data = await API.claimOtp(otp.token);
      const position = data.position || 1;
      setOtp(state => ({ ...state, panel: position === 1 ? 'active' : 'waiting', position, waitEstimate: data.wait_estimate || 0, queueDepth: data.queue_depth || position, activeRemaining: data.expires_in || CONFIG.CLAIM_EXPIRY_SEC }));
    } catch (error) { setOtp(state => ({ ...state, panel: 'error', message: error.message || 'Could not re-queue' })); }
  }

  async function requestPinReset(token) {
    setLogin(state => ({ ...state, resetMode: true, resetSent: false, resetCode: '', error: '' }));
    try { await API.adminResetRequest(token); setLogin(state => ({ ...state, resetSent: true })); }
    catch (error) { setLogin(state => ({ ...state, resetMode: false, error: error.message || 'Reset request failed' })); }
  }

  async function confirmPinReset(token, code) {
    if (!code || code.replace('-', '').length < 5) return setLogin(state => ({ ...state, error: 'Enter the full reset code from Telegram' }));
    setLogin(state => ({ ...state, loading: true, error: '' }));
    try {
      await API.adminResetConfirm(token, code);
      const status = await API.adminAuthStatus().catch(() => null);
      if (status) setAdmin(state => ({ ...state, configured: !!status.configured, adminTokens: status.admin_tokens || state.adminTokens, configuredTokens: status.configured_tokens || [] }));
      setLogin(state => ({ ...state, loading: false, resetMode: false, resetSent: false, resetCode: '', resetSuccess: true, pin: '', confirmPin: '' }));
    } catch (error) { setLogin(state => ({ ...state, loading: false, error: error.message || 'Invalid reset code' })); }
  }

  async function submitLogin() {
    const token = normalizeToken(login.tokenChars.join(''));
    if (token.length < 2) return setLogin(state => ({ ...state, error: 'Enter a valid 2-3 character token.' }));
    if (admin.adminTokens.includes(token) && !login.pin) return setLogin(state => ({ ...state, error: 'Enter your admin PIN.' }));
    setLogin(state => ({ ...state, loading: true, error: '' }));
    try {
      const found = await API.userLogin(token, login.pin || undefined, login.confirmPin || undefined);
      if (found.requires_pin) { setAdmin(state => ({ ...state, adminTokens: [...new Set([...state.adminTokens, token])] })); return setLogin(state => ({ ...state, loading: false })); }
      const cleanToken = normalizeToken(found.token);
      sessionStorage.setItem('portalUserToken', cleanToken);
      setCurrentUser({ token: cleanToken, name: found.name || '', email: found.email || '' }); setOtp(state => ({ ...state, token: cleanToken })); setLogin(emptyLogin());
      if (found.admin_session) {
        sessionStorage.setItem('adminSession', found.admin_session); sessionStorage.setItem('adminWho', cleanToken);
        setAdmin(state => ({ ...state, session: found.admin_session, who: cleanToken, error: '' }));
        loadAdminData(found.admin_session); loadAdminProfile(found.admin_session);
      }
    } catch (error) { setLogin(state => ({ ...state, loading: false, error: error.message || 'Login failed' })); }
  }

  async function saveConfig() {
    const tokens = admin.configTokens.split(',').map(normalizeToken).filter(Boolean);
    setAdmin(state => ({ ...state, loading: true, error: '' }));
    try {
      const saved = await API.saveAdminConfig(admin.session, tokens);
      const savedTokens = saved.admin_tokens || tokens;
      if (!savedTokens.includes(admin.who)) { clearAdminSession('Your admin access was removed.'); return true; }
      setAdmin(state => ({ ...state, loading: false, adminTokens: savedTokens, configTokens: savedTokens.join(', ') }));
      return true;
    }
    catch (error) { if (isExpiredError(error)) clearAdminSession('Your admin session expired. Please log in again.'); else setAdmin(state => ({ ...state, loading: false, error: error.message })); return false; }
  }

  async function adminResetPeer(targetToken) {
    try { await API.adminResetPeer(admin.session, targetToken); return { success: true }; }
    catch (error) { if (isExpiredError(error)) clearAdminSession('Session expired. Please log in again.'); return { success: false, error: error.message }; }
  }

  async function adminChangePIN(currentPin, newPin, confirmPin) {
    if (newPin !== confirmPin) return { success: false, error: 'PINs do not match' };
    if (newPin.length < 4) return { success: false, error: 'PIN must have at least 4 characters' };
    try { const data = await API.adminAuthSetup(admin.who, newPin, currentPin); if (data.session) { sessionStorage.setItem('adminSession', data.session); setAdmin(state => ({ ...state, session: data.session })); } return { success: true }; }
    catch (error) { return { success: false, error: error.message }; }
  }

  function logoutUser() {
    try { if (admin.session) API.adminAuthLogout(admin.session); } catch {}
    clearAdminSession(); resetClaim();
  }

  if (!currentUser) return <LoginGate login={login} setLogin={setLogin} submitLogin={submitLogin} admin={admin} requestPinReset={requestPinReset} confirmPinReset={confirmPinReset} />;

  const sidebar = <OtpSidebar adminSession={admin.session} profile={adminProfile} setProfile={setAdminProfile} currentUser={currentUser} />;
  return (
    <>
      <header className="topbar">
        <div className="topbar-left"><Logo /><span className="topbar-title">OTP Portal</span></div>
        <div className="topbar-right">
          <span className="nav-pill token-pill">{currentUser.token}</span>
          <button className={`nav-pill ${view === 'otp' ? 'active' : ''}`} onClick={() => setView('otp')}>OTP</button>
          {admin.session && <button className={`nav-pill ${view === 'admin' ? 'active' : ''}`} onClick={() => { setView('admin'); if (!admin.data) loadAdminData(); }}>Admin</button>}
          <button className="btn btn-secondary" onClick={logoutUser}>Logout</button>
        </div>
      </header>
      <main className="app-shell">
        {view === 'otp' && <OtpView otp={otp} claimOtp={claimOtp} retryOtp={retryOtp} resetClaim={resetClaim} sidebar={sidebar} currentUser={currentUser} />}
        {view === 'admin' && admin.session && <AdminView admin={admin} setAdmin={setAdmin} loadAdminData={loadAdminData} saveConfig={saveConfig} adminResetPeer={adminResetPeer} adminChangePIN={adminChangePIN} onExpired={clearAdminSession} />}
      </main>
    </>
  );
}

function LoginGate({ login, setLogin, submitLogin, admin, requestPinReset, confirmPinReset }) {
  const inputRefs = React.useRef([]);
  const pinRef = React.useRef(null);
  const token = normalizeToken(login.tokenChars.join(''));
  const isAdminToken = token.length >= 2 && admin.adminTokens.includes(token);
  const needsSetup = isAdminToken && (!admin.configuredTokens.includes(token) || login.resetSuccess);
  const canSubmit = token.length >= 2 && (!isAdminToken || (login.pin && !login.resetMode));
  useEffect(() => { if (isAdminToken && !login.resetMode) requestAnimationFrame(() => pinRef.current && pinRef.current.focus()); }, [isAdminToken]);
  function onChar(index, value) {
    if (isAdminToken) return;
    const next = [...login.tokenChars]; next[index] = (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-1);
    setLogin(state => ({ ...state, tokenChars: next, error: '' }));
    if (next[index] && index < 2) requestAnimationFrame(() => inputRefs.current[index + 1] && inputRefs.current[index + 1].focus());
  }
  function onPaste(event) {
    if (isAdminToken) return; event.preventDefault();
    const chars = (event.clipboardData.getData('text') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3).split('');
    setLogin(state => ({ ...state, tokenChars: [chars[0] || '', chars[1] || '', chars[2] || ''], error: '' }));
  }
  return (
    <div className="auth-wrap"><div className="card main-panel">
      <div className="eyebrow">// {isAdminToken ? (needsSetup ? 'Set your admin PIN' : 'Admin login') : 'User login'}</div>
      <h1 className="h1">{isAdminToken ? `Welcome, ${token}` : 'Enter your token'}</h1>
      <div className="sub">{isAdminToken ? 'Enter your PIN to access the OTP relay and admin portal.' : 'Use your 2-3 character INIT token to enter the portal.'}</div>
      <div className="token-wrap">{[0, 1, 2].map(index => <input key={index} aria-label={`Token character ${index + 1}`} ref={element => { inputRefs.current[index] = element; }} className="token-char mono" value={login.tokenChars[index]} onChange={event => onChar(index, event.target.value)} onPaste={onPaste} maxLength="1" placeholder="_" readOnly={isAdminToken} />)}</div>
      {!isAdminToken && <div className="token-hint">2 or 3 characters - letters and digits only</div>}
      {isAdminToken && !login.resetMode && <div>
        <div className="field"><label>{needsSetup ? 'New PIN' : 'PIN'}</label><input ref={pinRef} type="password" value={login.pin} onChange={event => setLogin(state => ({ ...state, pin: event.target.value, error: '' }))} /></div>
        {needsSetup && <div className="field"><label>Confirm PIN</label><input type="password" value={login.confirmPin} onChange={event => setLogin(state => ({ ...state, confirmPin: event.target.value, error: '' }))} /></div>}
        {!needsSetup && <button className="text-button" onClick={() => requestPinReset(token)}>Forgot your PIN?</button>}
      </div>}
      {isAdminToken && login.resetMode && <div>{login.resetSent ? <><div className="success-box">A reset code was sent to the Telegram group.</div><div className="field"><label>Reset code</label><input value={login.resetCode} onChange={event => setLogin(state => ({ ...state, resetCode: event.target.value.toUpperCase(), error: '' }))} /></div><button className="btn btn-primary" onClick={() => confirmPinReset(token, login.resetCode)}>Verify code</button></> : <div className="sub">Sending reset code...</div>}</div>}
      {login.error && <div className="error-box">{login.error}</div>}
      {!login.resetMode && <button className="btn btn-primary" disabled={!canSubmit || login.loading} onClick={submitLogin}>{login.loading ? 'Signing in...' : needsSetup ? 'Set PIN and continue' : 'Continue'}</button>}
    </div></div>
  );
}

function OtpView({ otp, claimOtp, retryOtp, resetClaim, sidebar, currentUser }) {
  const ringValue = otp.panel === 'otp' ? otp.otpRemaining : otp.activeRemaining;
  const ringTotal = otp.panel === 'otp' ? CONFIG.OTP_DISPLAY_SEC : CONFIG.CLAIM_EXPIRY_SEC;
  const offset = CONFIG.RING_CIRCUMFERENCE * (1 - ringValue / ringTotal);
  const fmt = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <div className="user-grid">
      <div>
        {otp.panel === 'claim' && <div className="card claim-card">
          <div className="eyebrow">// Shared OTP relay</div>
          <h1 className="h1">Request your OTP</h1>
          <div className="sub">You are signed in as <strong>{currentUser.token}</strong>{currentUser.name ? ` - ${currentUser.name}` : ''}. Click below to claim your slot.</div>
          <div className="token-hint">Logged-in token &middot; {currentUser.token}</div>
          <button className="btn btn-primary" onClick={claimOtp}>Claim my slot &rarr;</button>
          <div className="footer-note">Never share your OTP with anyone - not even IT.</div>
        </div>}

        {otp.panel !== 'claim' && <div className="card status-card">
          {otp.panel === 'active' && <>
            <span className="queue-badge">You have the slot</span>
            <h2 className="status-title">Go trigger your OTP now</h2>
            <div className="sub">Open the platform and request the SMS code. It will appear on this screen within seconds.</div>
          </>}
          {otp.panel === 'waiting' && <>
            <span className="queue-badge warn">Position #{otp.position} in queue</span>
            <h2 className="status-title">Hang tight - almost your turn</h2>
            <div className="sub">Someone is ahead of you. Do not trigger your OTP yet. Wait until this page tells you to.</div>
          </>}
          {otp.panel === 'otp' && <>
            <span className="queue-badge success">OTP received</span>
            <h2 className="status-title">Your one-time password</h2>
            <div className="sub">Use it now - it expires on the platform, not just here.</div>
            <div className="otp-box"><div className="otp-label">One-Time Password</div><div className="otp-code">{otp.otpValue}</div></div>
          </>}
          {otp.panel === 'expired' && <>
            <span className="queue-badge warn">Slot reclaimed</span>
            <h2 className="status-title">Your slot expired</h2>
            <div className="sub">No OTP arrived within the active window. Claim your slot first, then trigger the OTP in that order.</div>
            <button className="btn btn-primary" onClick={resetClaim}>Try again</button>
          </>}
          {otp.panel === 'error' && <>
            <span className="queue-badge warn">Error</span>
            <h2 className="status-title">Something went wrong</h2>
            <div className="sub">{otp.message || 'Please try again.'}</div>
            <button className="btn btn-danger" onClick={resetClaim}>Try again</button>
          </>}

          {(otp.panel === 'active' || otp.panel === 'otp') && <div className="ring-wrap">
            <svg width="116" height="116" viewBox="0 0 116 116">
              <circle className="ring-track" cx="58" cy="58" r="42" />
              <circle className={`ring-fill ${otp.panel === 'otp' ? 'success' : ''} ${otp.panel === 'otp' && otp.otpRemaining < 60 ? 'warn' : ''}`} cx="58" cy="58" r="42" strokeDasharray={CONFIG.RING_CIRCUMFERENCE} strokeDashoffset={offset} />
            </svg>
            <div className="ring-text">{fmt(ringValue)}</div>
          </div>}

          {otp.panel === 'waiting' && <div>
            <div className="sub" style={{ textAlign: 'center', marginTop: 14 }}><span className="mono">Position {otp.position}</span> &middot; <span className="mono">Est. wait {otp.waitEstimate}s</span></div>
            <div className="queue-room">{Array.from({ length: otp.queueDepth || otp.position }, (_, index) => index + 1).map(position =>
              <div key={position} className={`queue-row ${position === 1 ? 'active' : ''} ${position === otp.position ? 'you' : ''}`}>
                <div className={`dot ${position === 1 ? 'active' : ''}`}>{position}</div>
                <div className="sub" style={{ margin: 0 }}>{position === 1 ? 'getting OTP now...' : position === otp.position ? 'you' : 'waiting'}</div>
              </div>
            )}</div>
          </div>}

          {(otp.panel === 'active' || otp.panel === 'waiting') && <div className="status-list">
            <div className="status-step"><div className="dot done">&#10003;</div><div>Slot claimed successfully</div></div>
            <div className="status-step"><div className={`dot ${otp.panel === 'active' ? 'active' : ''}`}>2</div><div>{otp.panel === 'active' ? 'Trigger the OTP on the RTA platform now' : 'Wait for the green light before touching the RTA page'}</div></div>
            <div className="status-step"><div className="dot">3</div><div>The OTP appears here automatically</div></div>
          </div>}

          {otp.panel === 'otp' && <button className="btn btn-outline" style={{ marginTop: 16 }} onClick={retryOtp}>&#8635; Send again</button>}
        </div>}
      </div>
      {sidebar}
    </div>
  );
}

function OtpSidebar({ adminSession, profile, setProfile, currentUser }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile || {});
  const [status, setStatus] = useState('');
  useEffect(() => setDraft(profile || {}), [profile]);
  async function save() {
    if (!profile) return;
    setStatus('Saving...');
    try { const saved = await API.saveAdminProfile(adminSession, { ...profile, ...draft }); setProfile(saved); setDraft(saved); setEditing(false); setStatus('Saved'); setTimeout(() => setStatus(''), 1800); }
    catch (error) { setStatus(error.message || 'Save failed'); }
  }
  function toggleEditing() {
    if (editing) setDraft(profile || {});
    setEditing(value => !value);
  }
  const value = key => (draft && draft[key]) || '';
  const dateEntry = (label, key) => {
    const days = daysLeft(value(key));
    return <div className="side-entry"><div className="side-entry-head"><label htmlFor={`admin-profile-${key}`}><strong>{label}</strong></label><span className={`countdown ${countdownTone(days)}`}>{days == null ? 'Not set' : days <= 0 ? 'Expired' : `${days} days`}</span></div><div className="date-row"><input id={`admin-profile-${key}`} type="date" disabled={!profile} value={toDateInputValue(value(key))} onChange={event => setDraft(state => ({ ...state, [key]: fromDateInputValue(event.target.value) }))}/><button className="btn btn-secondary compact" disabled={!profile} onClick={() => setDraft(state => ({ ...state, [key]: new Date().toISOString() }))}>Reset today</button></div></div>;
  };
  return <div className="side-stack">
    {adminSession && <>
      <div className="card side-card"><div className="card-heading-row"><div className="side-card-title">Your credentials</div><button className="text-button" disabled={!profile} onClick={toggleEditing}>{editing ? 'Cancel' : 'Edit'}</button></div>
        <div className="form-grid"><div className="field"><label>Name</label><input value={value('display_name') || currentUser.name || ''} onChange={event => setDraft(state => ({ ...state, display_name: event.target.value }))} disabled={!editing}/></div><div className="field"><label>IITS username</label><input value={value('iits_username')} onChange={event => setDraft(state => ({ ...state, iits_username: event.target.value }))} disabled={!editing}/></div><div className="field"><label>ADM username</label><input value={value('adm_username')} onChange={event => setDraft(state => ({ ...state, adm_username: event.target.value }))} disabled={!editing}/></div></div>
        {editing && <button className="btn btn-primary compact" disabled={!profile} onClick={save}>Save profile</button>}{!profile && <div className="small profile-status">Loading profile...</div>}{status && <div className="small profile-status">{status}</div>}
      </div>
      <div className="card side-card"><div className="side-card-title">Password expiry</div>{dateEntry('IITS password', 'iits_pw_date')}{dateEntry('ADM password', 'adm_pw_date')}<button className="btn btn-primary compact" disabled={!profile} onClick={save}>Save dates</button></div>
      <div className="card side-card"><div className="side-card-title">VPN expiry</div>{dateEntry('VPN / PAM / SFTP', 'vpn_date')}<button className="btn btn-primary compact" disabled={!profile} onClick={save}>Save date</button></div>
    </>}
    <div className="card side-card"><div className="side-card-title">How this works</div><div className="notes-list"><div className="small">Claim the OTP slot first.</div><div className="small">Trigger the RTA OTP only when the portal tells you to.</div><div className="small">The OTP appears here automatically.</div></div></div>
    <div className="card side-card"><div className="side-card-title">Quick links</div><div className="quick-links"><a className="quick-link" href="https://direct.rta.ae" target="_blank" rel="noopener noreferrer"><span>RTA Automation Portal</span><small>Portal</small></a><a className="quick-link" href="https://srvterminal.init-db.lan" target="_blank" rel="noopener noreferrer"><span>Terminal Server</span><small>Remote access</small></a><a className="quick-link" href="https://ettisal.rta.ae/vendors" target="_blank" rel="noopener noreferrer"><span>Ivanti VPN</span><small>VPN</small></a></div></div>
  </div>;
}

function AdminView({ admin, setAdmin, loadAdminData, saveConfig, adminResetPeer, adminChangePIN, onExpired }) {
  const [tab, setTab] = useState('otp-log');
  const [logStatus, setLogStatus] = useState('all');
  const [logEvent, setLogEvent] = useState('');
  const [logSearch, setLogSearch] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState('');
  const [upload, setUpload] = useState({ busy: false, message: '', error: '' });
  useEffect(() => { if (admin.session && !admin.data) loadAdminData(); }, [admin.session]);
  const users = (admin.data && admin.data.users) || [];
  const queue = (admin.data && admin.data.queue) || [];
  const log = (admin.data && admin.data.log) || [];
  const eventOptions = [...new Set(log.map(entry => entry.event).filter(Boolean))].sort();
  const filteredLog = useMemo(() => log.filter(entry => {
    if (logStatus !== 'all' && (entry.status || 'info') !== logStatus) return false;
    if (logEvent && entry.event !== logEvent) return false;
    const search = logSearch.trim().toLowerCase();
    return !search || `${entry.token || ''} ${entry.event || ''} ${entry.detail || ''}`.toLowerCase().includes(search);
  }), [log, logStatus, logEvent, logSearch]);
  async function refresh() { setRefreshStatus('Refreshing...'); const ok = await loadAdminData(); setRefreshStatus(ok ? 'Updated' : 'Refresh failed'); setTimeout(() => setRefreshStatus(''), 2200); }
  async function uploadFile(event) {
    const file = event.target.files && event.target.files[0]; event.target.value = ''; if (!file) return;
    setUpload({ busy: true, message: '', error: '' });
    try { const result = await API.uploadUsersExcel(admin.session, file); await loadAdminData(); setUpload({ busy: false, message: `Uploaded ${result.users_loaded || 0} users`, error: '' }); }
    catch (error) { if (error.status === 401) onExpired('Your admin session expired. Please log in again.'); else setUpload({ busy: false, message: '', error: error.message }); }
  }
  async function reloadUsers() {
    setUpload({ busy: true, message: '', error: '' });
    try { const result = await API.reloadUsers(admin.session); await loadAdminData(); setUpload({ busy: false, message: `Reloaded ${result.users_loaded || 0} users`, error: '' }); }
    catch (error) { if (error.status === 401 || error.status === 403) onExpired('Your admin access changed. Please log in again.'); else setUpload({ busy: false, message: '', error: error.message }); }
  }
  return <div className="admin-layout">
    <div className="admin-overview">
      <div className="card stat-card"><div className="stat-label">Users loaded</div><div className="stat-value">{admin.data ? admin.data.userCount : '-'}</div></div>
      <div className="card stat-card"><div className="stat-label">Queue depth</div><div className="stat-value">{queue.length}</div></div>
      <div className="card live-queue-card"><div className="stat-label">Live queue</div>{queue.length ? <div className="live-queue-list">{queue.map((item, index) => <span className="queue-chip" key={`${item.token}-${index}`}>{item.position || index + 1}. {item.token}</span>)}</div> : <div className="small">Nobody is waiting.</div>}</div>
    </div>
    <div className="card main-panel">
      <div className="hero-row"><div><div className="eyebrow">// Admin dashboard{admin.who ? ` - ${admin.who}` : ''}</div><h1 className="h1">{tab === 'otp-log' ? 'OTP Log' : 'Users'}</h1><div className="sub">{tab === 'otp-log' ? 'Filter and search OTP relay activity.' : 'Users loaded from users.xlsx.'}</div></div>
        <div className="admin-actions"><div className="admin-tabbar"><button className={`btn ${tab === 'otp-log' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('otp-log')}>OTP Log</button><button className={`btn ${tab === 'users' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('users')}>Users</button></div><button className="btn btn-secondary" disabled={admin.loading} onClick={refresh}>Refresh</button><button className="btn btn-secondary gear-button" aria-label="Admin settings" title="Admin settings" onClick={() => setShowSettings(true)}>&#9881;</button></div>
      </div>
      {refreshStatus && <div className={refreshStatus === 'Refresh failed' ? 'error-box' : 'success-box'}>{refreshStatus}</div>}
      {tab === 'otp-log' && <>
        <div className="log-filters"><div><span className="filter-label">Status</span>{['all', 'info', 'warn', 'error'].map(status => <button key={status} style={filterChipStyle(status, logStatus === status)} onClick={() => setLogStatus(status)}>{status}</button>)}</div><label><span className="filter-label">Event</span><select value={logEvent} onChange={event => setLogEvent(event.target.value)}><option value="">All events</option>{eventOptions.map(event => <option key={event}>{event}</option>)}</select></label><input aria-label="Search audit log" value={logSearch} onChange={event => setLogSearch(event.target.value)} placeholder="token or detail..." /></div>
        <div className="table-scroll"><table className="admin-table equal-columns"><thead><tr><th>Time</th><th>Event</th><th>Token</th><th>Detail</th><th>Status</th></tr></thead><tbody>{filteredLog.length ? filteredLog.map((entry, index) => <tr key={index}><td className="mono">{fmtDubaiDateTime(entry.ts)}</td><td><strong>{entry.event}</strong></td><td className="mono">{entry.token || '-'}</td><td>{entry.detail || '-'}</td><td><span style={statusPillStyle(entry.status || 'info')}>{entry.status || 'info'}</span></td></tr>) : <tr><td colSpan="5" className="small">No matching audit entries.</td></tr>}</tbody></table></div>
      </>}
      {tab === 'users' && <><div className="users-toolbar"><label className="btn btn-secondary upload-button">{upload.busy ? 'Working...' : 'Upload user list'}<input type="file" accept=".xlsx" disabled={upload.busy} onChange={uploadFile}/></label><button className="btn btn-secondary" disabled={upload.busy} onClick={reloadUsers}>Reload users</button>{upload.message && <span className="success-box">{upload.message}</span>}{upload.error && <span className="error-box">{upload.error}</span>}</div><div className="table-scroll"><table className="admin-table users-table"><thead><tr><th>Token</th><th>Name</th><th>Email</th></tr></thead><tbody>{users.length ? users.map(user => <tr key={user.token}><td className="mono"><strong>{user.token}</strong></td><td>{user.name || '-'}</td><td>{user.email || '-'}</td></tr>) : <tr><td colSpan="3" className="small">No users loaded.</td></tr>}</tbody></table></div></>}
    </div>
    {showSettings && <AdminSettings admin={admin} setAdmin={setAdmin} saveConfig={saveConfig} adminResetPeer={adminResetPeer} adminChangePIN={adminChangePIN} onClose={() => setShowSettings(false)} />}
  </div>;
}

function AdminSettings({ admin, setAdmin, saveConfig, adminResetPeer, adminChangePIN, onClose }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog) dialog.focus();
    function onKeyDown(event) {
      if (event.key === 'Escape') return onClose();
      if (event.key !== 'Tab' || !dialog) return;
      const controls = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])')];
      if (!controls.length) return;
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  async function saveAndClose() { if (await saveConfig()) onClose(); }
  return <div className="modal-backdrop" onClick={onClose}><div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="admin-settings-title" tabIndex="-1" className="card settings-modal" onClick={event => event.stopPropagation()}>
    <div className="card-heading-row"><div id="admin-settings-title" className="side-card-title">Admin settings</div><button className="text-button" onClick={onClose}>Close</button></div>
    <div className="field"><label>Allowed admin tokens</label><input value={admin.configTokens} onChange={event => setAdmin(state => ({ ...state, configTokens: event.target.value, error: '' }))} /></div><div className="small">Comma-separated tokens.</div>{admin.error && <div className="error-box">{admin.error}</div>}<button className="btn btn-primary compact" onClick={saveAndClose}>Save tokens</button>
    <hr/><ChangePINSection adminWho={admin.who} adminChangePIN={adminChangePIN}/><hr/><ResetPeerSection adminTokens={admin.adminTokens} adminWho={admin.who} adminResetPeer={adminResetPeer}/>
  </div></div>;
}

function ChangePINSection({ adminWho, adminChangePIN }) {
  const [form, setForm] = useState({ current: '', next: '', confirm: '', loading: false, message: '', error: '' });
  async function submit() { setForm(state => ({ ...state, loading: true, message: '', error: '' })); const result = await adminChangePIN(form.current, form.next, form.confirm); setForm(state => ({ ...state, loading: false, message: result.success ? 'PIN updated.' : '', error: result.success ? '' : result.error })); }
  return <div><h3>Change my PIN ({adminWho})</h3><div className="field"><label>Current PIN</label><input type="password" value={form.current} onChange={event => setForm(state => ({ ...state, current: event.target.value }))}/></div><div className="field"><label>New PIN</label><input type="password" value={form.next} onChange={event => setForm(state => ({ ...state, next: event.target.value }))}/></div><div className="field"><label>Confirm new PIN</label><input type="password" value={form.confirm} onChange={event => setForm(state => ({ ...state, confirm: event.target.value }))}/></div>{form.error && <div className="error-box">{form.error}</div>}{form.message && <div className="success-box">{form.message}</div>}<button className="btn btn-primary compact" disabled={form.loading || !form.current || !form.next || !form.confirm} onClick={submit}>Update PIN</button></div>;
}

function ResetPeerSection({ adminTokens, adminWho, adminResetPeer }) {
  const targets = (adminTokens || []).filter(token => token !== adminWho);
  const [target, setTarget] = useState(''); const [status, setStatus] = useState('');
  async function submit() { const result = await adminResetPeer(target); setStatus(result.success ? `PIN cleared for ${target}.` : result.error || 'Reset failed'); }
  return <div><h3>Reset a colleague's PIN</h3>{targets.length ? <><div className="field"><label>Admin token</label><select value={target} onChange={event => setTarget(event.target.value)}><option value="">Select...</option>{targets.map(token => <option key={token}>{token}</option>)}</select></div><button className="btn btn-secondary compact" disabled={!target} onClick={submit}>Reset PIN</button>{status && <div className="small profile-status">{status}</div>}</> : <div className="small">No other admin tokens configured.</div>}</div>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
