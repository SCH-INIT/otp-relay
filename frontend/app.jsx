<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RTA Wizard Guide</title>
  <style>
    :root {
      --bg: #f6f8fb;
      --surface: #ffffff;
      --surface-soft: #f1f5f9;
      --text: #0f172a;
      --muted: #64748b;
      --border: #dbe3ee;
      --primary: #1d4ed8;
      --primary-dark: #1e3a8a;
      --primary-soft: #eff6ff;
      --warn-soft: #fff7ed;
      --warn-border: #fed7aa;
      --shadow: 0 22px 60px rgba(15, 23, 42, .16);
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: radial-gradient(circle at top left, #e0edff 0, transparent 34rem), var(--bg);
      color: var(--text);
    }
    a { color: var(--primary); }
    .shell {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 280px minmax(0, 1fr);
      gap: 18px;
      padding: 18px;
    }
    .sidebar,
    .main {
      background: rgba(255,255,255,.92);
      border: 1px solid var(--border);
      border-radius: 22px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .sidebar {
      position: sticky;
      top: 18px;
      height: calc(100vh - 36px);
      display: flex;
      flex-direction: column;
    }
    .side-head {
      padding: 18px;
      border-bottom: 1px solid var(--border);
    }
    .eyebrow {
      color: var(--primary-dark);
      font-family: var(--mono);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    h1 {
      margin: 6px 0 8px;
      font-size: 24px;
      line-height: 1.15;
    }
    .sub {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }
    .step-list {
      padding: 10px;
      overflow: auto;
    }
    .step-button {
      width: 100%;
      text-align: left;
      border: 1px solid transparent;
      background: transparent;
      color: var(--text);
      border-radius: 14px;
      padding: 11px 12px;
      cursor: pointer;
      display: grid;
      grid-template-columns: 26px minmax(0, 1fr);
      gap: 10px;
      align-items: start;
    }
    .step-button:hover { background: var(--surface-soft); }
    .step-button.active {
      background: var(--primary-soft);
      border-color: #bfdbfe;
      color: var(--primary-dark);
    }
    .step-num {
      width: 24px;
      height: 24px;
      border-radius: 999px;
      display: grid;
      place-items: center;
      background: var(--surface-soft);
      border: 1px solid var(--border);
      font-size: 11px;
      font-weight: 800;
      font-family: var(--mono);
    }
    .step-button.active .step-num {
      background: var(--primary);
      color: white;
      border-color: var(--primary);
    }
    .step-title {
      display: block;
      font-size: 13px;
      font-weight: 800;
      line-height: 1.25;
    }
    .step-owner {
      display: block;
      color: var(--muted);
      font-size: 11px;
      margin-top: 3px;
    }
    .main {
      min-width: 0;
      display: flex;
      flex-direction: column;
      max-height: calc(100vh - 36px);
    }
    .main-head {
      padding: 22px 24px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: flex-start;
    }
    .main-title {
      margin: 5px 0 8px;
      font-size: 30px;
      line-height: 1.12;
    }
    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .btn {
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      border-radius: 999px;
      padding: 10px 14px;
      font-weight: 800;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }
    .btn.primary {
      background: var(--primary);
      border-color: var(--primary);
      color: white;
    }
    .btn:disabled { opacity: .5; cursor: not-allowed; }
    .tabs {
      display: flex;
      gap: 8px;
      padding: 14px 24px;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
      align-items: center;
    }
    .tab {
      border: 1px solid var(--border);
      background: var(--surface-soft);
      color: #334155;
      border-radius: 999px;
      padding: 9px 13px;
      font-family: var(--mono);
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .05em;
      cursor: pointer;
    }
    .tab.active {
      background: var(--primary-dark);
      border-color: var(--primary-dark);
      color: white;
    }
    .content {
      padding: 24px;
      overflow: auto;
      line-height: 1.62;
      min-height: 280px;
    }
    .content h1,
    .content h2,
    .content h3 {
      line-height: 1.18;
      margin: 18px 0 10px;
    }
    .content h1 { font-size: 26px; }
    .content h2 { font-size: 21px; }
    .content h3 { font-size: 17px; }
    .content p,
    .content ul,
    .content ol { margin: 0 0 14px; }
    .content li { margin: 6px 0; }
    .content img {
      display: block;
      max-width: 100%;
      height: auto;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: var(--surface-soft);
      box-shadow: 0 10px 32px rgba(15, 23, 42, .12);
      margin: 14px 0 18px;
    }
    .content table {
      width: 100%;
      border-collapse: collapse;
      margin: 14px 0;
    }
    .content th,
    .content td {
      border: 1px solid var(--border);
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
    }
    .content code {
      font-family: var(--mono);
      background: var(--surface-soft);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1px 5px;
    }
    .info {
      background: var(--primary-soft);
      border: 1px solid #bfdbfe;
      border-radius: 16px;
      padding: 14px 16px;
      color: #1e3a8a;
    }
    .warn {
      background: var(--warn-soft);
      border: 1px solid var(--warn-border);
      border-radius: 16px;
      padding: 14px 16px;
      color: #9a3412;
    }
    .footer {
      padding: 16px 24px;
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: var(--surface);
    }
    .count {
      color: var(--muted);
      font-family: var(--mono);
      font-weight: 800;
      font-size: 12px;
    }
    .hidden { display: none !important; }
    @media (max-width: 900px) {
      .shell { grid-template-columns: 1fr; padding: 10px; }
      .sidebar { position: relative; top: 0; height: auto; max-height: 42vh; }
      .main { max-height: none; }
      .main-head { flex-direction: column; }
      .actions { justify-content: flex-start; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="side-head">
        <div class="eyebrow">// RTA wizard guide</div>
        <h1>Pop-out Guide</h1>
        <div class="sub">Move this browser window to another monitor while keeping the portal open.</div>
      </div>
      <div id="stepList" class="step-list"></div>
    </aside>

    <main class="main">
      <div class="main-head">
        <div>
          <div class="eyebrow" id="ownerLabel">// Step</div>
          <h2 class="main-title" id="stepTitle">Loading guide…</h2>
          <div class="sub" id="stepSummary">Loading /help/wizard-guide.json</div>
        </div>
        <div class="actions">
          <button class="btn primary" type="button" onclick="window.close()">Close</button>
        </div>
      </div>
      <div id="tabs" class="tabs"></div>
      <div id="content" class="content"><div class="info">Loading guide content…</div></div>
      <div class="footer">
        <button class="btn" type="button" id="prevBtn">← Back</button>
        <div class="count" id="pageCount">—</div>
        <button class="btn primary" type="button" id="nextBtn">Next →</button>
      </div>
    </main>
  </div>

  <script>
    const STEPS = [
      { id: 'form', title: 'Submit the RTA Access Form', owner: 'You', time: '10 min', summary: 'Fill the yellow boxes in the RTA access form and send the completed file to Jathin.' },
      { id: 'account_creation', title: 'RTA Account Creation', owner: 'Admin', time: 'Wait', summary: 'Jathin applies for the RTA account and informs you when the IITS username is created.' },
      { id: 'save_iits', title: 'Save Your IITS Username', owner: 'You', time: '1 min', summary: 'Record the IITS username exactly as provided.' },
      { id: 'adm_request', title: 'Request ADM Account & PAM Onboarding', owner: 'Admin', time: 'Wait', summary: 'Jathin/Amer coordinate ADM account and PAM onboarding approval.' },
      { id: 'save_adm', title: 'Save Your ADM Username', owner: 'You', time: '1 min', summary: 'Record the ADM username once it is shared with you.' },
      { id: 'password_reset', title: 'Reset RTA Passwords', owner: 'You', time: '10 min', summary: 'Reset the password using the RTA IAM page and OTP Relay.' },
      { id: 'oracle_auth', title: 'Configure Oracle Authenticator', owner: 'You', time: '10 min', summary: 'Register Oracle Authenticator immediately after password reset.' },
      { id: 'vpn_request', title: 'Request VPN / PAM / SFTP Access', owner: 'You', time: '15 min', summary: 'Submit the RTA VPN access request with RDP, PAM, and SSH/SFTP services.' },
      { id: 'email_support', title: 'Email RTA IT Support', owner: 'You', time: '5 min', summary: 'After the VPN request is approved and closed, ask RTA IT support to grant access.' },
      { id: 'install_vpn', title: 'Install Ivanti and Test Access', owner: 'You', time: '20 min', summary: 'Install Ivanti Secure Access Client and test VPN access.' }
    ];

    const params = new URLSearchParams(window.location.search);
    let guide = { steps: {} };
    let activeStepId = params.get('step') || 'form';
    let activePage = Math.max(0, Number(params.get('page') || 0) || 0);

    const stepListEl = document.getElementById('stepList');
    const tabsEl = document.getElementById('tabs');
    const contentEl = document.getElementById('content');
    const stepTitleEl = document.getElementById('stepTitle');
    const stepSummaryEl = document.getElementById('stepSummary');
    const ownerLabelEl = document.getElementById('ownerLabel');
    const pageCountEl = document.getElementById('pageCount');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');

    function escapeHtml(value) {
      return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }

    function currentStep() {
      return STEPS.find(step => step.id === activeStepId) || STEPS[0];
    }

    function pagesForStep(step) {
      const generated = guide && guide.steps && guide.steps[step.id];
      const pages = [{ type: 'summary', title: 'Overview', html: '<div class="info">' + escapeHtml(step.summary) + '</div>' }];
      if (generated && Array.isArray(generated.pages) && generated.pages.length) {
        return pages.concat(generated.pages.map(page => ({ type: 'html', title: page.title || 'Guide', html: page.html || '' })));
      }
      return pages.concat([{ type: 'empty', title: 'Guide', html: '<div class="warn">No generated guide content was found for this step. Run the Help Docs workflow or build <code>/help/wizard-guide.json</code>.</div>' }]);
    }

    function updateUrl() {
      const next = new URL(window.location.href);
      next.searchParams.set('step', activeStepId);
      next.searchParams.set('page', String(activePage));
      window.history.replaceState(null, '', next.toString());
    }

    function setStep(stepId, page = 0) {
      activeStepId = stepId;
      activePage = Math.max(0, page);
      render();
    }

    function setPage(page) {
      const pages = pagesForStep(currentStep());
      activePage = Math.max(0, Math.min(page, pages.length - 1));
      render();
    }

    function renderStepList() {
      stepListEl.innerHTML = STEPS.map((step, idx) => `
        <button class="step-button ${step.id === activeStepId ? 'active' : ''}" type="button" data-step="${escapeHtml(step.id)}">
          <span class="step-num">${idx + 1}</span>
          <span>
            <span class="step-title">${escapeHtml(step.title)}</span>
            <span class="step-owner">${escapeHtml(step.owner)} · ${escapeHtml(step.time)}</span>
          </span>
        </button>
      `).join('');
    }

    function render() {
      const step = currentStep();
      const pages = pagesForStep(step);
      if (activePage >= pages.length) activePage = pages.length - 1;
      const page = pages[activePage] || pages[0];

      stepTitleEl.textContent = step.title;
      stepSummaryEl.textContent = step.summary;
      ownerLabelEl.textContent = '// ' + step.owner + ' · ' + step.time;
      renderStepList();

      tabsEl.innerHTML = pages.map((p, idx) => `
        <button class="tab ${idx === activePage ? 'active' : ''}" type="button" data-page="${idx}">${escapeHtml(idx === 0 ? 'Overview' : (p.title || ('Page ' + (idx + 1))))}</button>
      `).join('');

      contentEl.innerHTML = page.html || '<div class="warn">This guide page is empty.</div>';
      pageCountEl.textContent = `${activePage + 1} / ${pages.length}`;
      prevBtn.disabled = activePage <= 0;
      const isLastPage = activePage >= pages.length - 1;
      nextBtn.disabled = activePage >= pages.length - 1;
      nextBtn.sytle.visibility = activePage >= pages.length  - 1 ? 'hidden' : 'visible';
      updateUrl();
    }

    function openLinksInNewTabs(event) {
      const link = event.target.closest && event.target.closest('a');
      if (!link || !link.href) return;
      event.preventDefault();
      window.open(link.href, '_blank', 'noopener,noreferrer');
    }

    async function loadGuide() {
      try {
        contentEl.innerHTML = '<div class="info">Loading guide content…</div>';
        const res = await fetch('/help/wizard-guide.json', { cache: 'no-cache' });
        if (!res.ok) throw new Error('/help/wizard-guide.json returned ' + res.status);
        guide = await res.json();
      } catch (err) {
        guide = { steps: {} };
        contentEl.innerHTML = '<div class="warn">Could not load <code>/help/wizard-guide.json</code>. The step list still works, but generated guide content is unavailable.<br><br>' + escapeHtml(err.message || err) + '</div>';
      }
      render();
    }

    stepListEl.addEventListener('click', event => {
      const button = event.target.closest('[data-step]');
      if (!button) return;
      setStep(button.getAttribute('data-step'), 0);
    });
    tabsEl.addEventListener('click', event => {
      const button = event.target.closest('[data-page]');
      if (!button) return;
      setPage(Number(button.getAttribute('data-page')) || 0);
    });
    contentEl.addEventListener('click', openLinksInNewTabs);
    prevBtn.addEventListener('click', () => setPage(activePage - 1));
    nextBtn.addEventListener('click', () => setPage(activePage + 1));
    window.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft') setPage(activePage - 1);
      if (event.key === 'ArrowRight') setPage(activePage + 1);
    });

    loadGuide();
  </script>
</body>
</html>
