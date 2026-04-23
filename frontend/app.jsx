const { useEffect, useMemo, useState } = React;

const CONFIG = {
  CLAIM_EXPIRY_SEC: 90,
  OTP_DISPLAY_SEC: 285,
  POLL_INTERVAL_MS: 3000,
  WIZARD_REFRESH_MS: 60000,
  RING_CIRCUMFERENCE: 263.89,
};

const API = {
  async json(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) throw new Error((data && (data.detail || data.error)) || `Request failed: ${res.status}`);
    return data;
  },
  claimOtp(token) { return this.json('/claim-otp', { method: 'POST', body: JSON.stringify({ token }) }); },
  claimStatus(token) { return this.json(`/claim-status/${encodeURIComponent(token)}`); },
  deleteClaim(token) { return this.json(`/claim-otp/${encodeURIComponent(token)}`, { method: 'DELETE' }); },
  saveWizard(payload) { return this.json('/wizard/progress', { method: 'POST', body: JSON.stringify(payload) }); },
  getWizard(token) { return this.json(`/wizard/progress/${encodeURIComponent(token)}`); },
  adminAuthStatus() { return this.json('/admin/auth/status'); },
  adminAuthSetup(credential, current) { return this.json('/admin/auth/setup', { method: 'POST', body: JSON.stringify({ credential, current }) }); },
  adminAuthLogin(credential) { return this.json('/admin/auth/login', { method: 'POST', body: JSON.stringify({ credential }) }); },
  adminAuthLogout(session) { return this.json('/admin/auth/logout', { method: 'POST', headers: { 'X-Admin-Session': session } }); },
  adminWizard(session) { return this.json('/admin/wizard', { headers: { 'X-Admin-Session': session } }); },
  adminQueue(session) { return this.json('/admin/queue', { headers: session ? { 'X-Admin-Session': session } : {} }); },
  adminUsers(session) { return this.json('/admin/users', { headers: session ? { 'X-Admin-Session': session } : {} }); },
  adminLog(session) { return this.json('/admin/log?limit=500', { headers: session ? { 'X-Admin-Session': session } : {} }); },
  adminConfig(session) { return this.json('/admin/config', { headers: session ? { 'X-Admin-Session': session } : {} }); },
  saveAdminConfig(session, admin_tokens) { return this.json('/admin/config', { method: 'POST', headers: { 'X-Admin-Session': session }, body: JSON.stringify({ admin_tokens }) }); },
  notifyAdminTask(payload) { return this.json('/api/onboard/notify', { method: 'POST', body: JSON.stringify(payload) }); },
};

const STEPS = [
  {
    id: 'form', title: 'Submit the RTA Access Form', owner: 'user', icon: '📝', time: '10 min',
    summary: 'Fill the official access form and send it to Jathin with your signature and required attachments.',
    details: [
      { type: 'info', text: 'Complete the official RTA Access Request form and attach the supporting documents.' },
      { type: 'list', title: 'What to do', items: [
        'Fill the latest access request form.',
        'Sign the document and save it as PDF.',
        'Email it to Jathin and copy Amer + Christian if needed.',
        'Ajith must also send the employee ID copy in PDF to Mustafa.'
      ]},
      { type: 'links', title: 'Useful links', items: [
        { label: 'RTA Access Requests (SharePoint)', href: 'https://initse.sharepoint.com/:f:/r/sites/RTAinternal/Shared%20Documents/RTA%20Documents/PAM/RTA%20Access%20Requests' },
        { label: 'Email template to Jathin', href: 'mailto:jprakash@initse.com?cc=cschilling@initse.com;adarwich@initse.com&subject=RTA-NG-2024%20Request%20RTA%20User%20Account' }
      ]}
    ]
  },
  {
    id: 'account_creation', title: 'RTA Account Creation', owner: 'admin', icon: '🔧', time: '1–3 days', gate: ['form'],
    adminLabel: 'Jathin creates the IITS account',
    summary: 'Jathin applies for your RTA account in the RTA system and shares the IITS username with you.',
    details: [
      { type: 'info', text: 'Jathin applies for your RTA account and notifies you once the IITS username is ready.' }
    ]
  },
  {
    id: 'adm_request', title: 'Request ADM Account & PAM Onboarding', owner: 'admin', icon: '🔧', time: '3–7 days', gate: ['form'],
    adminLabel: 'Amer handles ADM + PAM approvals',
    summary: 'Amer coordinates ADM creation and PAM onboarding approvals.',
    details: [
      { type: 'list', title: 'Approval chain', items: [
        'Mustafa approves the request.',
        'ITD approval: Siby.',
        'SMD approval: Ahmed Jarrah.',
        'After approvals, PAM support is emailed with the chain attached.'
      ]}
    ]
  },
  {
    id: 'save_iits', title: 'Save Your IITS Username', owner: 'user', icon: '👤', time: '2 min', gate: ['account_creation'],
    summary: 'Once Jathin sends you the IITS username, save it here for later use.',
    details: [
      { type: 'info', text: 'You will use the IITS account for VPN login, password resets, and OTP-related RTA access.' }
    ]
  },
  {
    id: 'save_adm', title: 'Save Your ADM Username', owner: 'user', icon: '🗂️', time: '2 min', gate: ['adm_request'],
    summary: 'Once Amer confirms the ADM account, save it here for PAM and server access workflows.',
    details: [
      { type: 'info', text: 'ADM is used for PAM and privileged access workflows inside the RTA environment.' }
    ]
  },
  {
    id: 'password_reset', title: 'Reset RTA Passwords', owner: 'user', icon: '🔐', time: '15 min', gate: ['save_iits'], expiryKey: 'iits_pw_date', secondExpiryKey: 'adm_pw_date',
    summary: 'Reset your IITS and ADM passwords, then record the reset dates so the 90-day countdown is visible.',
    details: [
      { type: 'info', text: 'The password reset link only works inside UAE. If you are outside UAE, use the Dubai terminal server first.' },
      { type: 'list', title: 'OTP relay sequence', items: [
        'Open the OTP portal and claim your slot first.',
        'Wait until the portal says “Go trigger your OTP now.”',
        'Only then switch to the RTA page and request the OTP.',
        'Enter the OTP from the portal and complete the reset immediately.'
      ]},
      { type: 'list', title: 'Terminal server when outside UAE', items: [
        'Browser: open https://srvterminal.init-db.lan and log in.',
        'Windows RDP: connect to 172.31.10.82 or srvterminal.',
        'Open the RTA reset link inside that remote session.'
      ]},
      { type: 'warn', text: 'Passwords expire every 90 days. No automatic reminder is sent by RTA.' }
    ]
  },
  {
    id: 'oracle_auth', title: 'Configure Oracle Authenticator', owner: 'user', icon: '📱', time: '10 min', gate: ['password_reset'],
    summary: 'Register Oracle Authenticator for TOTP and verify it works for both IITS and ADM flows.',
    details: [
      { type: 'list', title: 'What to do', items: [
        'Install Oracle Authenticator on your phone.',
        'Scan the QR code when prompted during setup.',
        'Verify that a 6-digit TOTP is generated correctly.'
      ]}
    ]
  },
  {
    id: 'vpn_request', title: 'Request VPN / PAM / SFTP Access', owner: 'user', icon: '🌐', time: '20 min', gate: ['oracle_auth'], expiryKey: 'vpn_date',
    summary: 'Submit the VPN request in the RTA Automation portal and include the needed applications and risk IDs.',
    details: [
      { type: 'kv', title: 'Applications to request', items: [
        ['RDP', '10.11.174.39 | Risk ID as per guide'],
        ['PAM', '10.11.174.38'],
        ['SSH/SFTP', '10.11.174.40:122 | Risk ID as per guide']
      ]},
      { type: 'warn', text: 'VPN access also expires every 90 days and must be renewed manually.' }
    ]
  },
  {
    id: 'email_support', title: 'Email RTA IT Support', owner: 'user', icon: '✉️', time: '5 min', gate: ['vpn_request'],
    summary: 'After the request is submitted, email RTA IT support to grant the access and reference the request details.',
    details: [
      { type: 'info', text: 'Use the RTA Automation Portal > IT Help Desk if you need to raise a support ticket or chase approvals.' }
    ]
  },
  {
    id: 'install_vpn', title: 'Install Ivanti and Test Access', owner: 'user', icon: '💻', time: '15 min', gate: ['email_support'],
    summary: 'Install Ivanti Secure Access Client, add the RTA VPN connection, and test VPN/PAM/SFTP access.',
    details: [
      { type: 'kv', title: 'Connection', items: [
        ['Type', 'Policy Secure (UAC) or Connect Secure (VPN)'],
        ['Name', 'RTA VPN'],
        ['Server URL', 'https://ettisal.rta.ae/vendors']
      ]},
      { type: 'info', text: 'For test servers: connect VPN → RDP to Jump Server → then connect to the target server.' }
    ]
  },
];

function getVisibleDone(user, step) {
  if (step.owner === 'admin') return (user.adminCompleted || []).includes(step.id);
  return (user.completed || []).includes(step.id);
}

function allDone(user) {
  return [...(user.completed || []), ...(user.adminCompleted || [])];
}

function isUnlocked(user, step) {
  if (!step.gate || step.gate.length === 0) return true;
  const done = new Set(allDone(user));
  return step.gate.every(id => done.has(id));
}

function nextUserStep(user) {
  return STEPS.find(step => step.owner === 'user' && isUnlocked(user, step) && !getVisibleDone(user, step));
}

function daysLeft(iso) {
  if (!iso) return null;
  const start = new Date(iso);
  if (isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000);
  const diff = end.getTime() - Date.now();
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

function countdownTone(days) {
  if (days == null) return 'good';
  if (days <= 0) return 'bad';
  if (days <= 14) return 'warn';
  return 'good';
}

function toDateInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function fromDateInputValue(v) {
  return v ? new Date(`${v}T00:00:00`).toISOString() : null;
}

const TOKEN_ENV_ACCESS = {
  BMI: { test_env: '', prod_env: '' },
  CSG: { test_env: '', prod_env: '' },
  GOE: { test_env: '', prod_env: '' },
  HAD: { test_env: '', prod_env: '' },
  LNA: { test_env: '', prod_env: 'Mobile Statistics' },
  JYN: { test_env: '', prod_env: '' },
  STN: { test_env: '', prod_env: '' },
  TTR: { test_env: '', prod_env: 'Mobile Statistics' },
  YSH: { test_env: '', prod_env: '' },
  JNB: { test_env: '', prod_env: '' },
  KTV: { test_env: '', prod_env: '' },
  FAL: { test_env: '', prod_env: '' },
  PZ: { test_env: '', prod_env: 'Mobile Statistics' },
  RBM: { test_env: '', prod_env: '' },
  GAL: { test_env: 'Mobile Guard', prod_env: 'Mobile Guard' },
  BHI: { test_env: '', prod_env: '' },
  MRZ: { test_env: 'Mobile Plan', prod_env: 'Mobile Plan' },
  TOB: { test_env: 'Mobile Plan', prod_env: 'Mobile Plan' },
  KG: { test_env: '', prod_env: '' },
};

function fmtShortDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString();
}

function fmtDubaiDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    timeZone: 'Asia/Dubai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).replace(',', '');
}

function normalizeToken(value) {
  return String(value || '').trim().toUpperCase();
}

function emptyWizardUser(token = '', display_name = '') {
  return {
    token,
    display_name,
    iits_username: '',
    adm_username: '',
    completed: [],
    adminCompleted: [],
    iits_pw_date: null,
    adm_pw_date: null,
    vpn_date: null,
    test_env: '',
    prod_env: '',
  };
}

function mergeAdminUsers(wizardUsers = [], loadedUsers = []) {
  const wizardMap = new Map((wizardUsers || []).map(u => [normalizeToken(u.token), u]));
  const allTokens = new Set([
    ...(loadedUsers || []).map(u => normalizeToken(u.token)),
    ...(wizardUsers || []).map(u => normalizeToken(u.token)),
  ]);

  return [...allTokens]
    .filter(Boolean)
    .map(token => {
      const base = (loadedUsers || []).find(u => normalizeToken(u.token) === token) || {};
      const wizard = wizardMap.get(token) || {};
      return {
        token,
        name: base.name || wizard.name || '',
        email: base.email || wizard.email || '',
        display_name: wizard.display_name || base.name || '',
        iits_username: wizard.iits_username || '',
        adm_username: wizard.adm_username || '',
        completed: wizard.completed || [],
        adminCompleted: wizard.adminCompleted || [],
        iits_pw_date: wizard.iits_pw_date || null,
        adm_pw_date: wizard.adm_pw_date || null,
        vpn_date: wizard.vpn_date || null,
        test_env: wizard.test_env || (TOKEN_ENV_ACCESS[token] && TOKEN_ENV_ACCESS[token].test_env) || '',
        prod_env: wizard.prod_env || (TOKEN_ENV_ACCESS[token] && TOKEN_ENV_ACCESS[token].prod_env) || '',
        updated_at: wizard.updated_at || wizard.lastActive || null,
        lastActive: wizard.lastActive || wizard.updated_at || null,
      };
    })
    .sort((a, b) => a.token.localeCompare(b.token));
}


function Logo() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 44" height="36" aria-label="INIT — The Future of Mobility">
      <circle cx="10" cy="6" r="5.5" fill="#009D3C"/>
      <rect x="6" y="14" width="8" height="22" rx="4" fill="#009D3C"/>
      <rect x="22" y="8" width="8" height="28" rx="4" fill="#009D3C"/>
      <rect x="22" y="8" width="22" height="8" rx="4" fill="#009D3C"/>
      <rect x="36" y="8" width="8" height="28" rx="4" fill="#009D3C"/>
      <circle cx="56" cy="6" r="5.5" fill="#009D3C"/>
      <rect x="52" y="14" width="8" height="22" rx="4" fill="#009D3C"/>
      <rect x="68" y="8" width="8" height="28" rx="4" fill="#009D3C"/>
      <rect x="62" y="8" width="26" height="8" rx="4" fill="#009D3C"/>
      <polygon points="85,4 96,12 85,20" fill="#009D3C"/>
      <text x="0" y="42" fontFamily="DM Sans, sans-serif" fontSize="8.5" fontWeight="400" fill="#B0B0B0" letterSpacing="0.04em">The Future of Mobility</text>
    </svg>
  );
}


const RS = {
  neutralWhite: '#FFFFFF',
  neutral50: '#FAFAFA',
  neutral100: '#F2F2F2',
  neutral200: '#E1E1E1',
  neutral300: '#D4D4D4',
  neutral700: '#656565',
  neutral900: '#363A3B',
  primary50: '#F2F7FC',
  primary100: '#E3EFF9',
  primary800: '#006DCC',
  primary900: '#233A4E',
  success50: '#F3FCF2',
  success100: '#E7F8E4',
  success500: '#46A048',
  warning50: '#FFF9EB',
  warning100: '#FFF2D7',
  warning500: '#F59C34',
  error50: '#FFF8F6',
  error100: '#FFF1EC',
  error500: '#ED502C',
};

function filterChipStyle(kind, active) {
  const base = {
    borderRadius: 4,
    border: `1px solid ${RS.neutral300}`,
    padding: '5px 10px',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '.04em',
    background: RS.neutralWhite,
    color: RS.neutral900,
    cursor: 'pointer',
    lineHeight: 1.1,
    textTransform: 'uppercase',
    fontFamily: 'JetBrains Mono, monospace',
  };
  if (!active) return base;
  if (kind === 'all') return { ...base, background: RS.primary100, border: `1px solid ${RS.primary800}`, color: RS.primary800 };
  if (kind === 'info') return { ...base, background: RS.primary50, border: `1px solid ${RS.primary800}`, color: RS.primary800 };
  if (kind === 'warn') return { ...base, background: RS.warning100, border: `1px solid ${RS.warning500}`, color: RS.warning500 };
  if (kind === 'error') return { ...base, background: RS.error100, border: `1px solid ${RS.error500}`, color: RS.error500 };
  return base;
}

function statusPillStyle(status) {
  const base = {
    display: 'inline-block',
    borderRadius: 999,
    padding: '6px 12px',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '.06em',
    textTransform: 'uppercase',
    border: '1px solid transparent',
  };
  if (status === 'error') return { ...base, background: RS.error100, borderColor: RS.error500, color: RS.error500 };
  if (status === 'warn') return { ...base, background: RS.warning100, borderColor: RS.warning500, color: RS.warning500 };
  return { ...base, background: RS.primary50, borderColor: RS.primary800, color: RS.primary800 };
}


function exportWizardProgressPdf(sourceUsers) {
  const safeUsers = [...(sourceUsers || users || [])]
    .sort((a, b) => (a.token || '').localeCompare(b.token || ''));

  const rows = safeUsers.map(user => {
    const nextUser = STEPS.find(step => step.owner === 'user' && isUnlocked(user, step) && !getVisibleDone(user, step));
    const pct = Math.round((allDone(user).length / STEPS.length) * 100);

    return `
      <tr>
        <td>${user.token || '—'}</td>
        <td>${user.display_name || '—'}</td>
        <td>${user.email || '—'}</td>
        <td>${user.iits_username || '—'}</td>
        <td>${user.adm_username || '—'}</td>
        <td>${user.test_env || '—'}</td>
        <td>${user.prod_env || '—'}</td>
        <td>${pct}%</td>
        <td>${allDone(user).length}/${STEPS.length}</td>
        <td>${nextUser ? nextUser.title : '—'}</td>
      </tr>`;
  }).join('');

  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>RTA Wizard Progress Overview</title>
        <style>
          @page { size: landscape; margin: 12mm; }
          body { font-family: Arial, sans-serif; margin: 0; color: #363A3B; background: #FFFFFF; }
          h1 { margin: 0; font-size: 24px; }
          .sub { margin-top: 6px; color: #656565; font-size: 12px; }
          .meta { margin: 10px 0 14px; font-size: 11px; color: #656565; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
          th, td { border: 1px solid #D4D4D4; padding: 6px 7px; vertical-align: top; word-break: break-word; }
          th { background: #F2F7FC; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
          tbody tr:nth-child(even) { background: #FAFAFA; }
        </style>
      </head>
      <body>
        <h1>RTA Wizard Progress Overview</h1>
        <div class="sub">Table export for JPR</div>
        <div class="meta">Generated: ${new Date().toLocaleString()} · Total users: ${safeUsers.length}</div>
        ${rows ? `<table><thead><tr><th>Token</th><th>Name</th><th>Email</th><th>IITS</th><th>ADM</th><th>Test ENV</th><th>Prod ENV</th><th>Progress</th><th>Done</th><th>Next User Step</th></tr></thead><tbody>${rows}</tbody></table>` : '<div>No users with progress available for export.</div>'}
      </body>
    </html>
  `;
  const win = window.open('', '_blank', 'width=1400,height=900');
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { try { win.print(); } catch (e) {} }, 250);
}

function App() {
  const [view, setView] = useState('otp');
  const [directoryUsers, setDirectoryUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [login, setLogin] = useState({ tokenChars: ['', '', ''], error: '' });
  const [wizardUser, setWizardUser] = useState(emptyWizardUser());
  const [wizardStatus, setWizardStatus] = useState({ saving: false, message: '' });
  const [openStep, setOpenStep] = useState(null);
  const [faqOpen, setFaqOpen] = useState({});
  const [otp, setOtp] = useState({ panel: 'claim', message: '', position: 1, waitEstimate: 0, queueDepth: 0, otpValue: '———', activeRemaining: CONFIG.CLAIM_EXPIRY_SEC, otpRemaining: CONFIG.OTP_DISPLAY_SEC, token: '' });
  const [admin, setAdmin] = useState({ session: sessionStorage.getItem('adminSession') || '', configured: false, mode: 'login', error: '', credential: '', current: '', confirm: '', data: null, loading: false, configTokens: 'JA, AM, CS' });

  useEffect(() => {
    API.adminAuthStatus().then(d => setAdmin(s => ({ ...s, configured: !!d.configured, mode: d.configured ? 'login' : 'setup' }))).catch(() => {});
    API.adminUsers().then(d => {
      const list = d.users || [];
      setDirectoryUsers(list);
      const remembered = normalizeToken(sessionStorage.getItem('portalUserToken') || '');
      if (remembered) {
        const found = list.find(u => normalizeToken(u.token) === remembered);
        if (found) setCurrentUser({ token: normalizeToken(found.token), name: found.name || '', email: found.email || '' });
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!currentUser?.token) {
      setWizardUser(emptyWizardUser());
      return;
    }

    const token = normalizeToken(currentUser.token);
    let cancelled = false;

    async function refreshWizard(silent = false) {
      try {
        const data = await API.getWizard(token);
        if (cancelled) return;
        setWizardUser(prev => ({
          ...emptyWizardUser(token, currentUser.name || ''),
          ...prev,
          ...data,
          token,
          display_name: (data && data.display_name) || currentUser.name || '',
        }));
        if (silent) {
          setWizardStatus(s => s.saving ? s : { ...s, message: 'Auto-refreshed' });
          setTimeout(() => setWizardStatus(s => (s.message === 'Auto-refreshed' ? { ...s, message: '' } : s)), 1200);
        }
      } catch {
        if (cancelled) return;
        setWizardUser(prev => (prev?.token ? prev : emptyWizardUser(token, currentUser.name || '')));
      }
    }

    refreshWizard(false);
    const poll = setInterval(() => refreshWizard(true), CONFIG.WIZARD_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [currentUser?.token, currentUser?.name]);

  useEffect(() => {
    if (!otp.panel || otp.panel === 'claim' || !otp.token) return;
    const timer = setInterval(async () => {
      try {
        const data = await API.claimStatus(otp.token);
        if (data.status === 'delivered' && data.otp) {
          setOtp(s => ({ ...s, panel: 'otp', otpValue: data.otp, otpRemaining: data.expires_in || CONFIG.OTP_DISPLAY_SEC }));
        } else if (data.status === 'idle_expired') {
          setOtp(s => ({ ...s, panel: 'expired' }));
        } else if (data.status === 'done') {
          resetClaim();
        } else if (data.status === 'waiting') {
          const pos = data.position || 1;
          setOtp(s => ({
            ...s,
            panel: pos === 1 ? 'active' : 'waiting',
            position: pos,
            waitEstimate: data.wait_estimate || 0,
            queueDepth: data.queue_depth || pos,
            activeRemaining: data.expires_in || CONFIG.CLAIM_EXPIRY_SEC,
          }));
        }
      } catch {}
    }, CONFIG.POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [otp.token, otp.panel]);

  useEffect(() => {
    if (otp.panel !== 'active' && otp.panel !== 'otp') return;
    const tick = setInterval(() => {
      setOtp(s => {
        if (s.panel === 'active') return { ...s, activeRemaining: Math.max(0, s.activeRemaining - 1) };
        if (s.panel === 'otp') return { ...s, otpRemaining: Math.max(0, s.otpRemaining - 1) };
        return s;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [otp.panel]);

  const doneCount = allDone(wizardUser).length;
  const progressPct = Math.round((doneCount / STEPS.length) * 100);
  const nextStep = nextUserStep(wizardUser);
  const pendingAdminTasks = useMemo(() => {
    if (!admin.data?.users) return [];
    const tasks = [];
    admin.data.users.forEach(user => {
      STEPS.filter(s => s.owner === 'admin').forEach(step => {
        if (isUnlocked(user, step) && !getVisibleDone(user, step)) tasks.push({ user, step });
      });
    });
    return tasks;
  }, [admin.data]);

  async function saveWizard(patch) {
    const next = { ...wizardUser, ...patch, token: (patch.token ?? wizardUser.token).trim().toUpperCase() };
    setWizardUser(next);
    if (!next.token) return;
    setWizardStatus({ saving: true, message: 'Saving…' });
    try {
      await API.saveWizard(next);
      setWizardStatus({ saving: false, message: 'Saved to server' });
      setTimeout(() => setWizardStatus(s => s.message === 'Saved to server' ? { ...s, message: '' } : s), 1500);
    } catch (e) {
      setWizardStatus({ saving: false, message: e.message || 'Save failed' });
    }
  }

  async function toggleStep(step) {
    if (step.owner !== 'user') return;
    const list = new Set(wizardUser.completed || []);
    const turningOn = !list.has(step.id);
    if (turningOn) list.add(step.id); else list.delete(step.id);
    const patch = { completed: [...list] };
    if (step.id === 'password_reset' && turningOn) {
      patch.iits_pw_date = wizardUser.iits_pw_date || new Date().toISOString();
      patch.adm_pw_date = wizardUser.adm_pw_date || new Date().toISOString();
    }
    if (step.id === 'vpn_request' && turningOn) {
      patch.vpn_date = wizardUser.vpn_date || new Date().toISOString();
    }
    await saveWizard(patch);
  }

  async function claimOtp() {
    const token = normalizeToken(currentUser?.token);
    if (token.length < 2) return;
    try {
      const data = await API.claimOtp(token);
      if (data.status === 'otp_ready') {
        setOtp(s => ({ ...s, token, panel: 'otp', otpValue: data.otp || '———', otpRemaining: data.expires_in || CONFIG.OTP_DISPLAY_SEC }));
        return;
      }
      const position = data.position || 1;
      setOtp(s => ({
        ...s,
        token,
        panel: position === 1 ? 'active' : 'waiting',
        position,
        waitEstimate: data.wait_estimate || 0,
        queueDepth: data.queue_depth || position,
        activeRemaining: data.expires_in || CONFIG.CLAIM_EXPIRY_SEC,
      }));
    } catch (e) {
      setOtp(s => ({ ...s, panel: 'error', message: e.message || 'Could not claim slot' }));
    }
  }

  function resetClaim() {
    setOtp({ panel: 'claim', message: '', position: 1, waitEstimate: 0, queueDepth: 0, otpValue: '———', activeRemaining: CONFIG.CLAIM_EXPIRY_SEC, otpRemaining: CONFIG.OTP_DISPLAY_SEC, token: normalizeToken(currentUser?.token) });
  }

  async function retryOtp() {
    try { if (otp.token) await API.deleteClaim(otp.token); } catch {}
    const token = otp.token;
    if (token) {
      try {
        const data = await API.claimOtp(token);
        const position = data.position || 1;
        setOtp(s => ({ ...s, token, panel: position === 1 ? 'active' : 'waiting', position, waitEstimate: data.wait_estimate || 0, queueDepth: data.queue_depth || position, activeRemaining: data.expires_in || CONFIG.CLAIM_EXPIRY_SEC }));
      } catch (e) {
        setOtp(s => ({ ...s, panel: 'error', message: e.message || 'Could not re-queue' }));
      }
    }
  }

  async function doAdminAuth() {
    setAdmin(s => ({ ...s, error: '', loading: true }));
    try {
      if (admin.mode === 'setup') {
        if (!admin.credential || admin.credential !== admin.confirm) throw new Error('Credentials do not match');
        const data = await API.adminAuthSetup(admin.credential, admin.current || undefined);
        sessionStorage.setItem('adminSession', data.session);
        setAdmin(s => ({ ...s, session: data.session, loading: false, configured: true, mode: 'login', credential: '', current: '', confirm: '' }));
        await loadAdminData(data.session);
      } else {
        const data = await API.adminAuthLogin(admin.credential);
        sessionStorage.setItem('adminSession', data.session);
        setAdmin(s => ({ ...s, session: data.session, loading: false, credential: '' }));
        await loadAdminData(data.session);
      }
    } catch (e) {
      setAdmin(s => ({ ...s, error: e.message, loading: false }));
    }
  }

  async function loadAdminData(session = admin.session) {
    if (!session) return;
    setAdmin(s => ({ ...s, loading: true, error: '' }));
    try {
      const [wizard, queue, users, log, config] = await Promise.all([
        API.adminWizard(session),
        API.adminQueue(session).catch(() => ({ queue: [] })),
        API.adminUsers(session).catch(() => ({ count: 0 })),
        API.adminLog(session).catch(() => ({ total: 0, entries: [] })),
        API.adminConfig(session).catch(() => ({ admin_tokens: ['JA','AM','CS'] })),
      ]);
      const mergedUsers = mergeAdminUsers(wizard.users || [], users.users || []);
      setAdmin(s => ({ ...s, data: { users: mergedUsers, queue: queue.queue || [], log: log.entries || [], logTotal: log.total || 0, userCount: users.count || 0 }, configTokens: (config.admin_tokens || []).join(', '), loading: false }));
    } catch (e) {
      setAdmin(s => ({ ...s, error: e.message, loading: false }));
    }
  }

  async function toggleAdminStep(token, stepId) {
    const current = admin.data?.users?.find(u => u.token === token);
    const completed = new Set(current?.adminCompleted || []);
    if (completed.has(stepId)) completed.delete(stepId); else completed.add(stepId);
    await API.saveWizard({ ...current, token, adminCompleted: [...completed] });
    try { await API.notifyAdminTask({ token, step_id: stepId, action: completed.has(stepId) ? 'done' : 'undone' }); } catch {}
    await loadAdminData();
  }

  async function saveConfig() {
    const tokens = admin.configTokens.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    await API.saveAdminConfig(admin.session, tokens);
    await loadAdminData();
  }

  async function logoutAdmin() {
    try { await API.adminAuthLogout(admin.session); } catch {}
    sessionStorage.removeItem('adminSession');
    setAdmin(s => ({ ...s, session: '', data: null }));
  }


  function submitLogin() {
    const token = normalizeToken(login.tokenChars.join(''));
    const found = directoryUsers.find(u => normalizeToken(u.token) === token);
    if (!token || token.length < 2) {
      setLogin(s => ({ ...s, error: 'Enter a valid 2–3 character token.' }));
      return;
    }
    if (!found) {
      setLogin(s => ({ ...s, error: 'Token not recognised. Check with IT.' }));
      return;
    }
    sessionStorage.setItem('portalUserToken', token);
    setCurrentUser({ token, name: found.name || '', email: found.email || '' });
    setOtp(s => ({ ...s, token }));
  }

  function logoutUser() {
    sessionStorage.removeItem('portalUserToken');
    setCurrentUser(null);
    setWizardUser(emptyWizardUser());
    setOpenStep(null);
    setView('otp');
    setOtp({ panel: 'claim', message: '', position: 1, waitEstimate: 0, queueDepth: 0, otpValue: '———', activeRemaining: CONFIG.CLAIM_EXPIRY_SEC, otpRemaining: CONFIG.OTP_DISPLAY_SEC, token: '' });
    setLogin({ tokenChars: ['', '', ''], error: '' });
  }

  const sharedSidebar = (
    <div className="side-stack">
      <div className="card side-card">
        <div className="side-card-title">How this works</div>
        <div className="notes-list">
          <div className="small">Claim the OTP slot first, then trigger the RTA OTP only when the portal tells you to.</div>
          <div className="small">The wizard is shared and server-backed, so credentials and reminder dates follow the user token across devices.</div>
          <div className="small">Admins can monitor onboarding progress and complete the admin-owned steps.</div>
        </div>
      </div>
      <div className="card side-card">
        <div className="side-card-title">Quick links</div>
        <div className="quick-links">
          <a className="quick-link" href="https://direct.rta.ae"><span>RTA Automation Portal</span><small>Portal</small></a>
          <a className="quick-link" href="https://srvterminal.init-db.lan"><span>Terminal Server</span><small>UAE-only workaround</small></a>
          <a className="quick-link" href="https://ettisal.rta.ae/vendors"><span>Ivanti VPN</span><small>ettisal.rta.ae</small></a>
        </div>
      </div>
    </div>
  );

  if (!currentUser) {
    return <LoginGate login={login} setLogin={setLogin} submitLogin={submitLogin} />;
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-left"><Logo /><span className="topbar-title">OTP Portal</span></div>
        <div className="topbar-right">
          <span className="nav-pill active">{currentUser.token}</span>
          {['otp', 'wizard', 'help', 'admin'].map(v => (
            <span key={v} className={`nav-pill ${view === v ? 'active' : ''}`} onClick={() => {
              setView(v);
              if (v === 'admin' && admin.session && !admin.data) loadAdminData();
            }}>{v === 'otp' ? 'OTP' : v === 'wizard' ? 'RTA Wizard' : v === 'help' ? 'Help' : 'Admin'}</span>
          ))}
          <button className="btn btn-secondary" onClick={logoutUser}>Logout</button>
          {admin.session && view === 'admin' && <button className="btn btn-secondary" onClick={logoutAdmin}>Admin logout</button>}
        </div>
      </header>
      <main className="app-shell">
        {view === 'otp' && <OtpView otp={otp} claimOtp={claimOtp} retryOtp={retryOtp} resetClaim={resetClaim} sidebar={sharedSidebar} currentUser={currentUser} />}
        {view === 'wizard' && <WizardView user={wizardUser} saveWizard={saveWizard} wizardStatus={wizardStatus} openStep={openStep} setOpenStep={setOpenStep} doneCount={doneCount} progressPct={progressPct} nextStep={nextStep} toggleStep={toggleStep} />}
        {view === 'help' && <HelpView faqOpen={faqOpen} setFaqOpen={setFaqOpen} />}
        {view === 'admin' && <AdminView admin={admin} setAdmin={setAdmin} doAdminAuth={doAdminAuth} loadAdminData={loadAdminData} toggleAdminStep={toggleAdminStep} pendingAdminTasks={pendingAdminTasks} saveConfig={saveConfig} />}
      </main>
    </>
  );
}

function LoginGate({ login, setLogin, submitLogin }) {
  const inputRefs = React.useRef([]);
  const token = login.tokenChars.join('');
  const disabled = token.trim().length < 2;

  function onChar(i, value) {
    const v = (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-1);
    const next = [...login.tokenChars];
    next[i] = v;
    setLogin(s => ({ ...s, tokenChars: next, error: '' }));
    if (v && i < 2) requestAnimationFrame(() => inputRefs.current[i + 1]?.focus());
  }

  function onKeyDown(i, e) {
    if (e.key === 'Backspace' && !login.tokenChars[i] && i > 0) {
      requestAnimationFrame(() => inputRefs.current[i - 1]?.focus());
      return;
    }
    if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault();
      inputRefs.current[i - 1]?.focus();
      return;
    }
    if (e.key === 'ArrowRight' && i < 2) {
      e.preventDefault();
      inputRefs.current[i + 1]?.focus();
      return;
    }
    if (e.key === 'Enter' && !disabled) {
      e.preventDefault();
      submitLogin();
    }
  }

  function onPaste(e) {
    e.preventDefault();
    const paste = (e.clipboardData.getData('text') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
    const next = ['', '', ''];
    for (let i = 0; i < paste.length; i++) next[i] = paste[i];
    setLogin(s => ({ ...s, tokenChars: next, error: '' }));
    requestAnimationFrame(() => inputRefs.current[Math.min(paste.length, 2)]?.focus());
  }

  return (
    <div className="auth-wrap">
      <div className="card main-panel">
        <div className="eyebrow">// User login</div>
        <h1 className="h1">Enter your token</h1>
        <div className="sub">Use your 2–3 character INIT token to enter the portal. The token is validated against the loaded users list.</div>
        <div className="token-wrap">
          {[0,1,2].map(i => (
            <input
              key={i}
              ref={el => (inputRefs.current[i] = el)}
              className="token-char mono"
              value={login.tokenChars[i]}
              onChange={e => onChar(i, e.target.value)}
              onKeyDown={e => onKeyDown(i, e)}
              onPaste={onPaste}
              placeholder="_"
              maxLength={1}
              autoComplete="off"
              spellCheck="false"
            />
          ))}
        </div>
        <div className="token-hint">2 or 3 characters · letters and digits only</div>
        {login.error && <div className="error-box" style={{ marginBottom: 12 }}>{login.error}</div>}
        <button className="btn btn-primary" disabled={disabled} onClick={submitLogin}>Go</button>
      </div>
    </div>
  );
}

function OtpView({ otp, claimOtp, retryOtp, resetClaim, sidebar, currentUser }) {
  const ringValue = otp.panel === 'otp' ? otp.otpRemaining : otp.activeRemaining;
  const ringTotal = otp.panel === 'otp' ? CONFIG.OTP_DISPLAY_SEC : CONFIG.CLAIM_EXPIRY_SEC;
  const offset = CONFIG.RING_CIRCUMFERENCE * (1 - ringValue / ringTotal);
  const fmt = secs => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2,'0')}`;

  return (
    <div className="user-grid">
      <div>
        {otp.panel === 'claim' && (
          <div className="card claim-card">
            <div className="eyebrow">// Shared OTP relay</div>
            <h1 className="h1">Request your OTP</h1>
            <div className="sub">You are signed in as <strong>{currentUser.token}</strong>{currentUser.name ? ` — ${currentUser.name}` : ''}. Click below to claim your slot.</div>
            <div className="token-hint">Logged-in token · {currentUser.token}</div>
            <button className="btn btn-primary" onClick={claimOtp}>Claim my slot →</button>
            <div className="footer-note">Never share your OTP with anyone — not even IT. Especially not IT.</div>
          </div>
        )}

        {otp.panel !== 'claim' && (
          <div className="card status-card">
            {otp.panel === 'active' && (
              <>
                <span className="queue-badge">You have the slot</span>
                <h2 className="status-title">Go trigger your OTP now</h2>
                <div className="sub">Open the platform and request the SMS code. It will appear on this screen within seconds.</div>
              </>
            )}
            {otp.panel === 'waiting' && (
              <>
                <span className="queue-badge warn">Position #{otp.position} in queue</span>
                <h2 className="status-title">Hang tight — almost your turn</h2>
                <div className="sub">Someone is ahead of you. Do not trigger your OTP yet. Wait until this page tells you to.</div>
              </>
            )}
            {otp.panel === 'otp' && (
              <>
                <span className="queue-badge success">OTP received</span>
                <h2 className="status-title">Your one-time password</h2>
                <div className="sub">Use it now — it expires on the platform, not just here.</div>
                <div className="otp-box"><div className="otp-label">One-Time Password</div><div className="otp-code">{otp.otpValue}</div></div>
              </>
            )}
            {otp.panel === 'expired' && (
              <>
                <span className="queue-badge warn">Slot reclaimed</span>
                <h2 className="status-title">Slot reclaimed — no hard feelings</h2>
                <div className="sub">90 seconds passed without an OTP arriving. Claim your slot first, then trigger the OTP in that order.</div>
                <button className="btn btn-primary" onClick={resetClaim}>Try again</button>
              </>
            )}
            {otp.panel === 'error' && (
              <>
                <span className="queue-badge warn">Error</span>
                <h2 className="status-title">Something went wrong</h2>
                <div className="sub">{otp.message || 'Please try again.'}</div>
                <button className="btn btn-danger" onClick={resetClaim}>Try again</button>
              </>
            )}

            {(otp.panel === 'active' || otp.panel === 'otp') && (
              <div className="ring-wrap">
                <svg width="116" height="116" viewBox="0 0 116 116">
                  <circle className="ring-track" cx="58" cy="58" r="42" />
                  <circle className={`ring-fill ${otp.panel === 'otp' ? 'success' : ''} ${otp.panel === 'otp' && otp.otpRemaining < 60 ? 'warn' : ''}`} cx="58" cy="58" r="42" strokeDasharray={CONFIG.RING_CIRCUMFERENCE} strokeDashoffset={offset} />
                </svg>
                <div className="ring-text">{fmt(ringValue)}</div>
              </div>
            )}

            {otp.panel === 'waiting' && (
              <div>
                <div className="sub" style={{ textAlign: 'center', marginTop: 14 }}><span className="mono">Position {otp.position}</span> · <span className="mono">Est. wait {otp.waitEstimate}s</span></div>
                <div className="queue-room">
                  {Array.from({ length: otp.queueDepth || otp.position }, (_, idx) => idx + 1).map(n => (
                    <div key={n} className={`queue-row ${n === 1 ? 'active' : ''} ${n === otp.position ? 'you' : ''}`}>
                      <div className={`dot ${n === 1 ? 'active' : ''}`}>{n}</div>
                      <div className="sub" style={{ margin: 0 }}>{n === 1 ? 'getting OTP now…' : n === otp.position ? 'you' : 'waiting'}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(otp.panel === 'active' || otp.panel === 'waiting') && (
              <div className="status-list">
                <div className="status-step"><div className="dot done">✓</div><div>Slot claimed successfully</div></div>
                <div className="status-step"><div className={`dot ${otp.panel === 'active' ? 'active' : ''}`}>2</div><div>{otp.panel === 'active' ? 'Trigger the OTP on the RTA platform now' : 'Wait for the green light before touching the RTA page'}</div></div>
                <div className="status-step"><div className="dot">3</div><div>The OTP appears here automatically</div></div>
              </div>
            )}

            {otp.panel === 'otp' && <button className="btn btn-outline" style={{ marginTop: 16 }} onClick={retryOtp}>↻ Send again</button>}
          </div>
        )}
      </div>
      {sidebar}
    </div>
  );
}

function WizardView({ user, saveWizard, wizardStatus, openStep, setOpenStep, doneCount, progressPct, nextStep, toggleStep }) {
  return (
    <div className="wide-layout">
      <div className="card main-panel">
        <div className="hero-row">
          <div>
            <div className="eyebrow">// RTA onboarding dashboard</div>
            <h1 className="h1">RTA Access Wizard</h1>
            <div className="sub">Your token record is server-backed so reminders and progress persist across devices.</div>
          </div>
          <div className="hero-meta">
            <span className="pill primary">{doneCount} / {STEPS.length} done</span>
            {nextStep && <span className="pill warn">Up next: {nextStep.title}</span>}
          </div>
        </div>

        <div className="card progress-card" style={{ boxShadow: 'none' }}>
          <div className="eyebrow">// Progress</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <div><strong>{progressPct}% complete</strong><div className="small">User and admin-owned steps are counted together.</div></div>
            {wizardStatus.message && <div className={wizardStatus.message.includes('failed') ? 'error-box' : 'success-box'}>{wizardStatus.message}</div>}
          </div>
          <div className="progress-bar"><div className="progress-fill" style={{ width: `${progressPct}%` }} /></div>
        </div>

        <div className="step-grid">
          {STEPS.map(step => {
            const done = getVisibleDone(user, step);
            const unlocked = isUnlocked(user, step);
            const isNext = nextStep?.id === step.id;
            const open = openStep === step.id;
            return (
              <div key={step.id} className={`step-card ${step.owner === 'admin' ? 'admin' : ''} ${done ? 'done' : ''} ${isNext ? 'next' : ''} ${!unlocked ? 'locked' : ''}`} style={done && step.owner === 'admin' ? { opacity: 0.68, background: RS.neutral100, borderColor: RS.neutral300 } : undefined}>
                <div className={`rail ${done ? 'done' : isNext ? 'next' : ''}`}>{done ? '✓' : step.icon}</div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
                    <div>
                      <h3 className="step-title">{step.title}</h3>
                      <div className="step-summary">{step.summary}</div>
                    </div>
                    <div className="step-tags">
                      <span className={`pill ${step.owner === 'admin' ? 'warn' : 'primary'}`}>{step.owner === 'admin' ? 'Admin' : 'You'}</span>
                      <span className="pill">{step.time}</span>
                      {!unlocked && <span className="pill">Locked</span>}
                    </div>
                  </div>
                  <div className="step-actions">
                    {step.owner === 'user' ? (
                      <button className={`step-check ${done ? 'done' : ''}`} onClick={() => toggleStep(step)} disabled={!unlocked}>{done ? '✓' : '☐'}</button>
                    ) : (
                      <span className={`pill ${done ? 'success' : 'warn'}`}>{done ? 'Completed by admin' : 'Waiting for admin'}</span>
                    )}
                    <button className="btn btn-secondary" onClick={() => setOpenStep(open ? null : step.id)}>{open ? 'Hide guide' : '📖 View guide'}</button>
                    {isNext && !done && <span className="pill primary">← Up next</span>}
                  </div>
                  {open && <Guide step={step} user={user} />}
                </div>
                <div />
              </div>
            );
          })}
        </div>
      </div>

      <div className="side-panel">
        <div className="card side-card">
          <div className="side-card-title">Your credentials</div>
          <div className="form-grid">
            <div className="field"><label>Display name</label><input value={user.display_name || ''} onChange={e => saveWizard({ display_name: e.target.value })} placeholder="e.g. Sara" /></div>
            <div className="field"><label>IITS username</label><input value={user.iits_username || ''} onChange={e => saveWizard({ iits_username: e.target.value })} placeholder="IITS_…" /></div>
            <div className="field"><label>ADM username</label><input value={user.adm_username || ''} onChange={e => saveWizard({ adm_username: e.target.value })} placeholder="ADM_…" /></div>
          </div>
        </div>

        <div className="card side-card">
          <div className="side-card-title">Password expiry</div>
          <CountdownEntry label="IITS Password" date={user.iits_pw_date} onDateChange={d => saveWizard({ iits_pw_date: d })} onReset={() => saveWizard({ iits_pw_date: new Date().toISOString() })} />
          <CountdownEntry label="ADM Password" date={user.adm_pw_date} onDateChange={d => saveWizard({ adm_pw_date: d })} onReset={() => saveWizard({ adm_pw_date: new Date().toISOString() })} />
          <div className="small" style={{ marginTop: 10 }}>Passwords expire every 90 days. No reminders from RTA.</div>
        </div>

        <div className="card side-card">
          <div className="side-card-title">VPN expiry</div>
          <CountdownEntry label="VPN Access" date={user.vpn_date} onDateChange={d => saveWizard({ vpn_date: d })} onReset={() => saveWizard({ vpn_date: new Date().toISOString() })} />
          <div className="small" style={{ marginTop: 10 }}>VPN, PAM, and SFTP access all expire after 90 days.</div>
        </div>

        <div className="card side-card">
          <div className="side-card-title">Quick links</div>
          <div className="quick-links">
            <a className="quick-link" href="https://direct.rta.ae"><span>RTA Automation Portal</span><small>Main portal</small></a>
            <a className="quick-link" href="https://srvterminal.init-db.lan"><span>Terminal Server</span><small>Outside UAE</small></a>
            <a className="quick-link" href="https://ettisal.rta.ae/vendors"><span>Ivanti VPN</span><small>Install/test</small></a>
          </div>
        </div>

        <div className="card side-card">
          <div className="side-card-title">Good to know</div>
          <div className="notes-list">
            <div className="small">Full onboarding usually takes 2–3 weeks.</div>
            <div className="small">Test servers: VPN → Jump Server (RDP) → target.</div>
            <div className="small">File transfer: VPN → WinSCP → SFTP → target server.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Guide({ step }) {
  return (
    <div className="guide-panel">
      {step.details.map((block, idx) => {
        if (block.type === 'info') return <div key={idx} className="guide-block"><div className="inline-info">{block.text}</div></div>;
        if (block.type === 'warn') return <div key={idx} className="guide-block"><div className="inline-note">{block.text}</div></div>;
        if (block.type === 'list') return <div key={idx} className="guide-block"><div className="guide-label">{block.title}</div><ul>{block.items.map((item, i) => <li key={i}>{item}</li>)}</ul></div>;
        if (block.type === 'links') return <div key={idx} className="guide-block"><div className="guide-label">{block.title}</div><ul>{block.items.map((item, i) => <li key={i}><a href={item.href}>{item.label}</a></li>)}</ul></div>;
        if (block.type === 'kv') return <div key={idx} className="guide-block"><div className="guide-label">{block.title}</div>{block.items.map((item, i) => <div className="kv" key={i}><div className="kv-key">{item[0]}</div><div>{item[1]}</div></div>)}</div>;
        return null;
      })}
    </div>
  );
}

function CountdownEntry({ label, date, onDateChange, onReset }) {
  const days = daysLeft(date);
  return (
    <div className="side-entry">
      <div className="side-entry-head">
        <div>
          <div className="side-entry-title">{label}</div>
          <div className="small">Last set: {fmtShortDate(date)}</div>
        </div>
        <div className={`countdown ${countdownTone(days)}`}>{days == null ? '—' : days <= 0 ? 'Expired' : `${days}d`}</div>
      </div>
      <div className="date-row">
        <input type="date" value={toDateInputValue(date)} onChange={e => onDateChange(fromDateInputValue(e.target.value))} />
        <button className="btn btn-secondary" onClick={onReset}>↻ Reset</button>
      </div>
    </div>
  );
}

function HelpView({ faqOpen, setFaqOpen } = {}) {
  const [manifest, setManifest] = useState(null);
  const [docHtml, setDocHtml] = useState({});
  const [docOpen, setDocOpen] = useState({});
  const [helpError, setHelpError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadHelpDocs() {
      try {
        setHelpError('');
        const manifestRes = await fetch('/help/manifest.json', { cache: 'no-store' });
        if (!manifestRes.ok) throw new Error(`manifest ${manifestRes.status}`);
        const manifestJson = await manifestRes.json();
        if (cancelled) return;
        setManifest(manifestJson);

        const loaded = {};
        await Promise.all(
          (manifestJson.docs || []).map(async (doc) => {
            const res = await fetch(doc.htmlPath, { cache: 'no-store' });
            if (!res.ok) throw new Error(`doc ${doc.slug} ${res.status}`);
            loaded[doc.slug] = await res.text();
          })
        );

        if (!cancelled) setDocHtml(loaded);
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load help docs', err);
          setHelpError('Documentation could not be loaded right now.');
        }
      }
    }

    loadHelpDocs();
    return () => { cancelled = true; };
  }, []);

  const grouped = {};
  for (const doc of manifest?.docs || []) {
    if (!grouped[doc.section]) grouped[doc.section] = [];
    grouped[doc.section].push(doc);
  }

  return (
    <div className="help-grid">
      <div className="card main-panel">
        <div className="eyebrow">// Documentation</div>
        <h1 className="h1">Help & Docs</h1>
        <div className="sub">Documentation is loaded from the repository build output and updates when the help docs are rebuilt.</div>

        {helpError && <div className="error-box" style={{ marginTop: 16 }}>{helpError}</div>}

        {!manifest && !helpError && (
          <div className="card progress-card" style={{ boxShadow: 'none', marginTop: 16 }}>
            <div className="small">Loading documentation…</div>
          </div>
        )}

        {Object.entries(grouped).map(([section, items]) => (
          <div key={section}>
            <div className="help-section">{section}</div>
            <div className="faq-stack">
              {items.map((doc) => {
                const open = !!docOpen[doc.slug];
                return (
                  <div className="faq" key={doc.slug}>
                    <div className="faq-q" onClick={() => setDocOpen(s => ({ ...s, [doc.slug]: !s[doc.slug] }))}>
                      <span>{doc.title}</span>
                      <span>{open ? '▴' : '▾'}</span>
                    </div>
                    {open && (
                      <div className="faq-a" style={{ display: 'block' }}>
                        <div dangerouslySetInnerHTML={{ __html: docHtml[doc.slug] || '<p>Loading…</p>' }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="side-panel" style={{ alignSelf: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card side-card" style={{ marginBottom: 0 }}>
            <div className="side-card-title" style={{ marginBottom: 0 }}>Contacts</div>
          </div>
          <div className="card side-card" style={{ marginBottom: 0 }}>
            <strong>Jathin</strong>
            <div className="small">RTA account creation, IAM username, ADM notification</div>
          </div>
          <div className="card side-card" style={{ marginBottom: 0 }}>
            <strong>Amer Darwich</strong>
            <div className="small">ADM account, PAM onboard list, OTP token assignment</div>
          </div>
          <div className="card side-card" style={{ marginBottom: 0 }}>
            <strong>Christian Schilling</strong>
            <div className="small">Admin oversight and escalation</div>
          </div>
          <div className="card side-card" style={{ marginBottom: 0 }}>
            <strong>RTA IT Support</strong>
            <div className="small">VPN access grant and access issues via the RTA Automation Portal → IT Help Desk</div>
          </div>
        </div>
      </div>
    </div>
  );
}


function completedStepsList(user) {
  return STEPS.filter(step => getVisibleDone(user, step));
}

function AdminView({ admin, setAdmin, doAdminAuth, loadAdminData, toggleAdminStep, pendingAdminTasks, saveConfig }) {
  const [adminTab, setAdminTab] = useState('wizard');
  const [logStatus, setLogStatus] = useState('all');
  const [logEvent, setLogEvent] = useState('');
  const [logSearch, setLogSearch] = useState('');
  const [wizardTokenSearch, setWizardTokenSearch] = useState('');
  const [wizardEnv, setWizardEnv] = useState('all');
  const [wizardProgress, setWizardProgress] = useState('all');
  const [showAdminTokenConfig, setShowAdminTokenConfig] = useState(false);

  useEffect(() => {
    if (admin.session && !admin.data) loadAdminData();
  }, [admin.session]);

  if (!admin.session) {
    return (
      <div className="auth-wrap">
        <div className="card main-panel" style={{ minWidth: 0, overflow: "hidden", width: "100%" }}>
          <div className="eyebrow">// Admin access</div>
          <h1 className="h1">{admin.mode === 'setup' ? 'Set admin credential' : 'Admin login'}</h1>
          <div className="sub">Use a password or 4-digit PIN. This is shared for portal admins.</div>
          <div className="form-grid" style={{ marginTop: 18 }}>
            {admin.mode === 'setup' && admin.configured && <div className="field"><label>Current credential</label><input type="password" value={admin.current} onChange={e => setAdmin(s => ({ ...s, current: e.target.value }))} /></div>}
            <div className="field"><label>{admin.mode === 'setup' ? 'New credential' : 'Credential'}</label><input type="password" value={admin.credential} onChange={e => setAdmin(s => ({ ...s, credential: e.target.value }))} /></div>
            {admin.mode === 'setup' && <div className="field"><label>Confirm credential</label><input type="password" value={admin.confirm} onChange={e => setAdmin(s => ({ ...s, confirm: e.target.value }))} /></div>}
            {admin.error && <div className="error-box">{admin.error}</div>}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn btn-primary" disabled={admin.loading} onClick={doAdminAuth}>{admin.loading ? 'Working…' : admin.mode === 'setup' ? 'Save credential' : 'Login'}</button>
              <button className="btn btn-secondary" onClick={() => setAdmin(s => ({ ...s, mode: s.mode === 'setup' ? 'login' : 'setup', error: '' }))}>{admin.mode === 'setup' ? 'Use login' : 'Change credential'}</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const users = admin.data?.users || [];
  const queue = admin.data?.queue || [];
  const log = admin.data?.log || [];
  const eventOptions = [...new Set(log.map(entry => entry.event).filter(Boolean))].sort();

  const filteredLog = log.filter(entry => {
    if (logStatus !== 'all' && (entry.status || 'info') !== logStatus) return false;
    if (logEvent && entry.event !== logEvent) return false;
    if (logSearch.trim()) {
      const q = logSearch.trim().toLowerCase();
      const hay = `${entry.token || ''} ${entry.event || ''} ${entry.detail || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const filteredUsers = users.filter(user => {
    const tokenNeedle = normalizeToken(wizardTokenSearch);
    if (tokenNeedle) {
      if (normalizeToken(user.token || '') !== tokenNeedle) return false;
    }
    if (wizardEnv === 'test' && !(user.test_env || '').trim()) return false;
    if (wizardEnv === 'prod' && !(user.prod_env || '').trim()) return false;

    const doneCount = allDone(user).length;
    if (wizardProgress === 'not-started' && doneCount !== 0) return false;
    if (wizardProgress === 'in-progress' && !(doneCount > 0 && doneCount < STEPS.length)) return false;
    if (wizardProgress === 'completed' && doneCount !== STEPS.length) return false;

    return true;
  });

  function renderCompletedSteps(user) {
    const done = completedStepsList(user);
    if (done.length === 0) return <div className="small">No completed steps yet</div>;
    return (
      <div>
        {done.map(step => (
          <div key={step.id} className="small" style={{ marginBottom: 4 }}>✓ {step.title}</div>
        ))}
      </div>
    );
  }

  return (
    <div className="admin-layout">
      <div className="admin-top">
        <div className="card stat-card"><div className="stat-label">Wizard users</div><div className="stat-value">{users.length}</div></div>
        <div className="card stat-card"><div className="stat-label">Pending admin tasks</div><div className="stat-value">{pendingAdminTasks.length}</div></div>
        <div className="card stat-card"><div className="stat-label">Queue depth</div><div className="stat-value">{queue.length}</div></div>
        <div className="card stat-card"><div className="stat-label">Audit entries</div><div className="stat-value">{admin.data?.logTotal || 0}</div></div>
      </div>

      <div className="wide-layout" style={{ gridTemplateColumns: "minmax(0, 1fr)", alignItems: "start", gap: 16 }}>
        <div className="card main-panel">
          <div className="hero-row">
            <div>
              <div className="eyebrow">// Admin dashboard</div>
              <h1 className="h1">{adminTab === 'wizard' ? 'RTA Wizard Progress' : 'OTP Log'}</h1>
              <div className="sub">{adminTab === 'wizard' ? 'Users, credentials, progress, and next admin-owned step in one view.' : 'Filter and search the relay log by token, category, and status.'}</div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'nowrap' }}>
              <div className="admin-tabbar" style={{ display: 'flex', flexDirection: 'row', gap: 8, flexWrap: 'nowrap', alignItems: 'center' }}>
                <button className="btn" style={{ width: 'auto', whiteSpace: 'nowrap', background: adminTab === 'wizard' ? RS.primary800 : RS.neutralWhite, color: adminTab === 'wizard' ? RS.neutralWhite : RS.neutral900, border: adminTab === 'wizard' ? 'none' : `1px solid ${RS.neutral300}` }} onClick={() => setAdminTab('wizard')}>RTA Wizard</button>
                <button className="btn" style={{ width: 'auto', whiteSpace: 'nowrap', background: adminTab === 'otp-log' ? RS.primary800 : RS.neutralWhite, color: adminTab === 'otp-log' ? RS.neutralWhite : RS.neutral900, border: adminTab === 'otp-log' ? 'none' : `1px solid ${RS.neutral300}` }} onClick={() => setAdminTab('otp-log')}>OTP Log</button>
              </div>
              {adminTab === 'wizard' && <button className="btn btn-secondary" style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={() => exportWizardProgressPdf(users)}>Export PDF</button>}
              <button className="btn btn-secondary" style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={() => loadAdminData()}>Refresh</button>
              <button className="btn btn-secondary" style={{ width: 46, minWidth: 46, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, lineHeight: 1 }} aria-label="Admin token settings" title="Admin token settings" onClick={() => setShowAdminTokenConfig(true)}>⚙</button>
            </div>
          </div>

          {adminTab === 'wizard' && (
            <>
              <div className="card progress-card" style={{ boxShadow: 'none', marginBottom: 14, padding: '14px 16px' }}>
                <div className="hero-row" style={{ marginBottom: 10, paddingBottom: 10 }}>
                  <div>
                    <div className="side-card-title" style={{ marginBottom: 0 }}>Wizard Progress <span className="small" style={{ fontWeight: 400 }}>(current view)</span></div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <input value={wizardTokenSearch} onChange={e => setWizardTokenSearch(e.target.value)} placeholder="token or username..." style={{ flex: '0 1 180px', minWidth: 180, height: 32, border: '1px solid var(--border)', borderRadius: 4, padding: '0 10px', background: 'var(--surface)', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }} />
                  <div style={{ width: 1, height: 22, background: 'var(--border)' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="small mono" style={{ textTransform: 'uppercase', letterSpacing: '.08em' }}>ENV</span>
                    {[
                      ['all', 'ALL'],
                      ['test', 'TEST'],
                      ['prod', 'PROD'],
                    ].map(([value, label]) => (
                      <button key={value} style={filterChipStyle(value, wizardEnv === value)} onClick={() => setWizardEnv(value)}>{label}</button>
                    ))}
                  </div>
                  <div style={{ width: 1, height: 22, background: 'var(--border)' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="small mono" style={{ textTransform: 'uppercase', letterSpacing: '.08em' }}>Progress</span>
                    <select value={wizardProgress} onChange={e => setWizardProgress(e.target.value)} style={{ minWidth: 165, height: 32, border: '1px solid var(--border)', borderRadius: 4, padding: '0 10px', background: 'var(--surface)', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                      <option value="all">All progress</option>
                      <option value="not-started">Not started</option>
                      <option value="in-progress">In progress</option>
                      <option value="completed">Completed</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="card progress-card" style={{ boxShadow: 'none', marginBottom: 14, padding: '14px 16px' }}>
                <div className="hero-row" style={{ marginBottom: 10, paddingBottom: 10 }}>
                  <div>
                    <div className="side-card-title" style={{ marginBottom: 0 }}>Pending Admin Tasks <span className="small" style={{ fontWeight: 400 }}>(quick list)</span></div>
                  </div>
                </div>
                {pendingAdminTasks.length === 0 ? (
                  <div className="small">No pending admin tasks right now.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {pendingAdminTasks.slice().sort((a, b) => (a.user.token || '').localeCompare(b.user.token || '')).map(({ user, step }) => {
                      const done = getVisibleDone(user, step);
                      return (
                        <div key={`${user.token}-${step.id}`} style={{ display: 'grid', gridTemplateColumns: '90px minmax(0, 1fr) auto', gap: 10, alignItems: 'center', padding: '10px 12px', border: `1px solid ${RS.neutral200}`, borderRadius: 8, background: RS.neutralWhite }}>
                          <div className="mono"><strong>{user.token}</strong></div>
                          <div>
                            <div style={{ fontWeight: 700 }}>{step.adminLabel || step.title}</div>
                            <div className="small">{user.display_name || user.name || '—'}</div>
                          </div>
                          <button
                            className="btn btn-secondary"
                            style={{ width: 'auto', whiteSpace: 'nowrap' }}
                            onClick={() => toggleAdminStep(user.token, step.id)}
                          >
                            Mark complete
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div style={{ width: '100%', overflowX: 'hidden', paddingBottom: 4 }}>

                <table className="admin-table" style={{ width: '100%', tableLayout: 'fixed' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '4%', whiteSpace: 'nowrap' }}>Token</th>
                      <th style={{ width: '6%', whiteSpace: 'nowrap' }}>IITS</th>
                      <th style={{ width: '6%', whiteSpace: 'nowrap' }}>ADM</th>
                      <th style={{ width: '12%', whiteSpace: 'nowrap' }}>Test ENV</th>
                      <th style={{ width: '12%', whiteSpace: 'nowrap' }}>Prod ENV</th>
                      <th style={{ width: '12%', whiteSpace: 'nowrap' }}>Progress</th>
                      <th style={{ width: '8%', whiteSpace: 'nowrap' }}>Activity</th>
                      <th style={{ width: '24%', whiteSpace: 'nowrap' }}>Completed Steps</th>
                      <th style={{ width: '18%', whiteSpace: 'nowrap' }}>Admin Task</th>
                    </tr>
                  </thead>
                  <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr><td colSpan="9" className="small" style={{ padding: '16px' }}>No matching wizard users.</td></tr>
                  ) : filteredUsers.slice().sort((a,b) => a.token.localeCompare(b.token)).map(u => {
                    const pct = Math.round((allDone(u).length / STEPS.length) * 100);
                    return (
                      <tr key={u.token}>
                        <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><strong>{u.token}</strong></td>
                        <td className="mono" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.iits_username || '—'}</td>
                        <td className="mono" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.adm_username || '—'}</td>
                        <td title={u.test_env || '—'} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.test_env || '—'}</td>
                        <td title={u.prod_env || '—'} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.prod_env || '—'}</td>
                        <td style={{ whiteSpace: 'nowrap', overflow: 'hidden' }}>
                          <div className="progress-bar"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
                          <div className="small" style={{ marginTop: 6 }}>{pct}%</div>
                        </td>
                        <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmtShortDate(u.updated_at || u.lastActive)}</td>
                        <td title={renderCompletedSteps(u)} style={{ verticalAlign: 'top', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{renderCompletedSteps(u)}</td>
                        <td style={{ verticalAlign: 'top' }}>
                          {STEPS.filter(s => s.owner === 'admin' && isUnlocked(u, s)).length === 0 ? (
                            <div className="small">No admin task</div>
                          ) : STEPS.filter(s => s.owner === 'admin' && isUnlocked(u, s)).map(s => {
                            const done = getVisibleDone(u, s);
                            return (
                              <button
                                key={s.id}
                                onClick={() => toggleAdminStep(u.token, s.id)}
                                style={{
                                  display: 'block', width: '100%', marginBottom: 4, padding: '4px 8px',
                                  fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
                                  borderRadius: 4, cursor: 'pointer', textAlign: 'left', opacity: done ? 0.55 : 1,
                                  background: done ? RS.neutral100 : '#f0f9ff',
                                  border: done ? `1px solid ${RS.neutral300}` : '1px solid #93c5fd',
                                  color: done ? RS.neutral700 : '#1e40af',
                                }}
                              >
                                {done ? '✓ ' : '○ '}{s.adminLabel || s.title}
                              </button>
                            );
                          })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                </table>
              </div>
            </>
          )}

          {adminTab === 'otp-log' && (
            <>
              <div className="card progress-card" style={{ boxShadow: 'none', marginBottom: 14, padding: '14px 16px' }}>
                <div className="hero-row" style={{ marginBottom: 10, paddingBottom: 10 }}>
                  <div>
                    <div className="side-card-title" style={{ marginBottom: 0 }}>Audit Log <span className="small" style={{ fontWeight: 400 }}>(newest first)</span></div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="small mono" style={{ textTransform: 'uppercase', letterSpacing: '.08em' }}>Status</span>
                    {['all', 'info', 'warn', 'error'].map(status => (
                      <button
                        key={status}
                        style={filterChipStyle(status, logStatus === status)}
                        onClick={() => setLogStatus(status)}
                      >
                        {status.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <div style={{ width: 1, height: 22, background: 'var(--border)' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="small mono" style={{ textTransform: 'uppercase', letterSpacing: '.08em' }}>Event</span>
                    <select value={logEvent} onChange={e => setLogEvent(e.target.value)} style={{ minWidth: 165, height: 32, border: '1px solid var(--border)', borderRadius: 4, padding: '0 10px', background: 'var(--surface)', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                      <option value="">All events</option>
                      {eventOptions.map(ev => <option key={ev} value={ev}>{ev}</option>)}
                    </select>
                  </div>
                  <div style={{ width: 1, height: 22, background: 'var(--border)' }} />
                  <input value={logSearch} onChange={e => setLogSearch(e.target.value)} placeholder="token or detail..." style={{ flex: '0 1 180px', minWidth: 180, height: 32, border: '1px solid var(--border)', borderRadius: 4, padding: '0 10px', background: 'var(--surface)', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }} />
                </div>
              </div>

              <div className="card progress-card" style={{ boxShadow: 'none', marginBottom: 14 }}>
                <div className="eyebrow">// Live queue</div>
                {queue.length === 0 ? <div className="small">Nobody is in the queue right now.</div> : queue.map((q, i) => <div className="queue-row" key={i}><div className="dot active">{q.position || i+1}</div><div><strong>{q.token}</strong><div className="small">{q.name || q.email || ''}</div></div></div>)}
              </div>

              <table className="admin-table">
                <thead>
                  <tr><th>Time</th><th>Event</th><th>Token</th><th>Detail</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {filteredLog.length === 0 ? (
                    <tr><td colSpan="5" className="small" style={{ padding: '16px' }}>No matching audit entries.</td></tr>
                  ) : (
                    filteredLog.map((entry, i) => (
                      <tr key={i}>
                        <td className="mono">{fmtDubaiDateTime(entry.ts)}</td>
                        <td><strong>{entry.event}</strong></td>
                        <td className="mono">{entry.token || '—'}</td>
                        <td>{entry.detail || '—'}</td>
                        <td><span style={statusPillStyle(entry.status || 'info')}>{entry.status || 'info'}</span></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>

        {showAdminTokenConfig && (
          <div onClick={() => setShowAdminTokenConfig(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 1000 }}>
            <div className="card side-card" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, margin: 0 }}>
              <div className="side-card-title">Admin token config</div>
              <div className="field"><label>Admin tokens</label><input value={admin.configTokens} onChange={e => setAdmin(s => ({ ...s, configTokens: e.target.value }))} /></div>
              <div className="small" style={{ marginTop: 10 }}>Seeded for Jathin, Amer, and Christian, but editable from the portal.</div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="btn btn-secondary" style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={() => setShowAdminTokenConfig(false)}>Close</button>
                <button className="btn btn-primary" style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={() => { saveConfig(); setShowAdminTokenConfig(false); }}>Save config</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
