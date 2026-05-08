// --- window controls ---
const winMin = document.getElementById('win-min');
const winMax = document.getElementById('win-max');
const winClose = document.getElementById('win-close');

winMin.addEventListener('click', () => { winMin.blur(); window.api.window.minimize(); });
winMax.addEventListener('click', () => { winMax.blur(); window.api.window.maximizeToggle(); });
winClose.addEventListener('click', () => { winClose.blur(); window.api.window.close(); });

window.api.window.onStateChange(({ maximized }) => {
  document.body.classList.toggle('maximized', maximized);
});

// --- nav ---
const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view');

navItems.forEach((item) => {
  item.addEventListener('click', () => {
    const target = item.dataset.view;
    navItems.forEach((n) => n.classList.toggle('active', n === item));
    views.forEach((v) => v.classList.toggle('active', v.id === `view-${target}`));
    if (target === 'history') loadHistory();
  });
});

// --- watermark form ---
const state = {
  inputPaths: [],
  outputDir: null,
  copies: 1,
  recipientNames: [''],
  zip: false,
};

const addFilesBtn = document.getElementById('add-files');
const addFolderBtn = document.getElementById('add-folder');
const clearSourcesBtn = document.getElementById('clear-sources');
const sourceListEl = document.getElementById('source-list');
const pickOutputBtn = document.getElementById('pick-output');
const copiesInput = document.getElementById('copies');
const copiesDec = document.getElementById('copies-dec');
const copiesInc = document.getElementById('copies-inc');
const zipToggle = document.getElementById('zip-toggle');
const recipientsEl = document.getElementById('recipients');
const generateBtn = document.getElementById('generate');

function setPickerLabel(btn, value) {
  const span = btn.querySelector('.picker-label');
  if (value) {
    span.textContent = value;
    btn.classList.add('filled');
  } else {
    span.textContent = span.dataset.empty;
    btn.classList.remove('filled');
  }
}

function basename(p) {
  if (!p) return '';
  const m = p.match(/[^\\/]+$/);
  return m ? m[0] : p;
}

function renderSourceList() {
  if (state.inputPaths.length === 0) {
    sourceListEl.innerHTML = '<div class="source-empty">No tracks selected</div>';
    clearSourcesBtn.hidden = true;
    return;
  }
  clearSourcesBtn.hidden = false;
  sourceListEl.innerHTML = state.inputPaths
    .map(
      (p, i) => `
      <div class="source-item" data-index="${i}">
        <svg class="source-ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        <span class="source-name" title="${escape(p)}">${escape(basename(p))}</span>
        <button class="source-remove" type="button" data-remove="${i}" aria-label="Remove">×</button>
      </div>
    `
    )
    .join('');
  sourceListEl.querySelectorAll('.source-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.remove, 10);
      state.inputPaths.splice(idx, 1);
      renderSourceList();
      refreshGenerate();
    });
  });
}

function addInputs(paths) {
  if (!paths || paths.length === 0) return;
  for (const p of paths) {
    if (!state.inputPaths.includes(p)) state.inputPaths.push(p);
  }
  renderSourceList();
  refreshGenerate();
}

addFilesBtn.addEventListener('click', async () => {
  addFilesBtn.blur();
  addInputs(await window.api.pickInputFiles());
});

addFolderBtn.addEventListener('click', async () => {
  addFolderBtn.blur();
  addInputs(await window.api.pickInputFolder());
});

clearSourcesBtn.addEventListener('click', () => {
  clearSourcesBtn.blur();
  state.inputPaths = [];
  renderSourceList();
  refreshGenerate();
});

zipToggle.addEventListener('change', () => {
  state.zip = zipToggle.checked;
});

pickOutputBtn.addEventListener('click', async () => {
  const p = await window.api.pickOutputDir();
  if (p) {
    state.outputDir = p;
    setPickerLabel(pickOutputBtn, p);
    refreshGenerate();
  }
});

function setCopies(n) {
  n = Math.max(0, Math.min(50, n | 0));
  state.copies = n;
  copiesInput.value = n;
  while (state.recipientNames.length < n) state.recipientNames.push('');
  state.recipientNames.length = n;
  renderRecipients();
  refreshGenerate();
}

copiesInput.addEventListener('input', () => setCopies(parseInt(copiesInput.value, 10) || 1));
copiesDec.addEventListener('click', () => { copiesDec.blur(); setCopies(state.copies - 1); });
copiesInc.addEventListener('click', () => { copiesInc.blur(); setCopies(state.copies + 1); });

const addRecipientBtn = document.getElementById('add-recipient');
addRecipientBtn.addEventListener('click', () => {
  addRecipientBtn.blur();
  setCopies(state.copies + 1);
  const inputs = recipientsEl.querySelectorAll('.recipient-input');
  if (inputs.length > 0) inputs[inputs.length - 1].focus();
});

function renderRecipients() {
  recipientsEl.innerHTML = '';
  state.recipientNames.forEach((name, i) => {
    const row = document.createElement('div');
    row.className = 'recipient-row';
    row.dataset.index = String(i);
    row.innerHTML = `
      <span class="recipient-num">${i + 1}</span>
      <input type="text" class="recipient-input" placeholder="Recipient name" value="${escape(name)}" />
      <span class="recipient-status" data-status="idle"></span>
      <button class="recipient-remove" type="button" aria-label="Remove recipient">×</button>
    `;
    const input = row.querySelector('input');
    input.addEventListener('input', () => {
      state.recipientNames[i] = input.value;
      refreshGenerate();
    });
    row.querySelector('.recipient-remove').addEventListener('click', (e) => {
      e.currentTarget.blur();
      removeRecipient(i);
    });
    recipientsEl.appendChild(row);
  });
}

function removeRecipient(index) {
  state.recipientNames.splice(index, 1);
  state.copies = state.recipientNames.length;
  copiesInput.value = state.copies;
  renderRecipients();
  refreshGenerate();
}

function escape(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function refreshGenerate() {
  const ready =
    state.inputPaths.length > 0 &&
    state.outputDir &&
    state.recipientNames.length > 0 &&
    state.recipientNames.every((n) => n.trim().length > 0);
  generateBtn.disabled = !ready;
  if (state.inputPaths.length > 0 && state.recipientNames.length > 0) {
    const total = state.inputPaths.length * state.recipientNames.length;
    generateBtn.textContent = `Generate ${total} watermark${total === 1 ? '' : 's'}`;
  } else {
    generateBtn.textContent = 'Generate watermarks';
  }
}

window.api.onProgress((p) => {
  const row = recipientsEl.querySelector(`.recipient-row[data-index="${p.index}"]`);
  if (!row) return;
  const status = row.querySelector('.recipient-status');
  row.classList.remove('running', 'done', 'error', 'zipping');
  if (p.status === 'running') {
    row.classList.add('running');
    status.dataset.status = 'running';
    if (p.currentTrack) {
      status.textContent = `${p.tracksDone}/${p.tracksTotal}  ·  ${p.currentTrack}`;
    } else {
      status.textContent = `Watermarking 0/${p.tracksTotal}…`;
    }
  } else if (p.status === 'zipping') {
    row.classList.add('zipping');
    status.dataset.status = 'zipping';
    status.textContent = 'Bundling…';
  } else if (p.status === 'done') {
    row.classList.add('done');
    status.dataset.status = 'done';
    const tag = p.zipPath ? '.zip' : `${p.tracksTotal} track${p.tracksTotal === 1 ? '' : 's'}`;
    status.textContent = `${tag}  ·  ${p.id.slice(0, 8)}…`;
  } else if (p.status === 'error') {
    row.classList.add('error');
    status.dataset.status = 'error';
    status.textContent = p.error || 'failed';
  }
});

generateBtn.addEventListener('click', async () => {
  generateBtn.disabled = true;
  const originalLabel = generateBtn.textContent;
  generateBtn.textContent = 'Generating…';
  recipientsEl.querySelectorAll('input').forEach((i) => (i.disabled = true));
  try {
    await window.api.generate({
      inputPaths: state.inputPaths.slice(),
      outputDir: state.outputDir,
      recipients: state.recipientNames.map((n) => n.trim()),
      zip: state.zip,
    });
  } catch (err) {
    alert(err.message || String(err));
  } finally {
    refreshGenerate();
    recipientsEl.querySelectorAll('input').forEach((i) => (i.disabled = false));
  }
});

setCopies(1);
renderSourceList();

// --- scan ---
const scanState = { filePath: null };
const pickScanBtn = document.getElementById('pick-scan');
const scanBtn = document.getElementById('scan-btn');
const scanResultCard = document.getElementById('scan-result-card');

pickScanBtn.addEventListener('click', async () => {
  const p = await window.api.pickScanFile();
  if (p) {
    scanState.filePath = p;
    setPickerLabel(pickScanBtn, basename(p));
    scanBtn.disabled = false;
  }
});

function fmtDate(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const ICONS = {
  hit: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l5 5L20 7.5"/></svg>`,
  none: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  orphan: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v5"/><circle cx="12" cy="17" r="0.6" fill="currentColor"/></svg>`,
};

function renderScanResult(result) {
  scanResultCard.hidden = false;
  if (!result.found) {
    scanResultCard.className = 'card scan-result none';
    scanResultCard.innerHTML = `
      <div class="result-headline">
        <span class="result-icon none">${ICONS.none}</span>
        <div>
          <div class="result-title">No watermark detected</div>
          <div class="result-sub muted">This track was either never watermarked by you, or has been re-encoded too aggressively to recover the message.</div>
        </div>
      </div>
    `;
    return;
  }
  if (!result.record) {
    scanResultCard.className = 'card scan-result orphan';
    scanResultCard.innerHTML = `
      <div class="result-headline">
        <span class="result-icon orphan">${ICONS.orphan}</span>
        <div>
          <div class="result-title">Watermark found, no record</div>
          <div class="result-sub muted">A valid watermark was extracted, but its ID isn't in your local database. Likely a copy from a different machine, or this DB was cleared.</div>
          <div class="result-id">${result.messageId}</div>
        </div>
      </div>
    `;
    return;
  }
  const r = result.record;
  const all = result.allRecords || [r];
  const isBatch = all.length > 1;
  const matched = result.matchedByFilename;
  scanResultCard.className = 'card scan-result hit';

  let trackBlock = '';
  if (isBatch) {
    const otherTracks = all.filter((x) => x !== r);
    trackBlock = `
      <dt>${matched ? 'Identified track' : 'Likely track'}</dt>
      <dd>
        ${escape(r.outputName)}
        ${matched ? '' : '<span class="muted small"> · file renamed; matched by ID only</span>'}
      </dd>
      <dt>Other tracks in this delivery</dt>
      <dd>
        <ul class="result-tracks">
          ${otherTracks.map((x) => `<li>${escape(x.outputName)}</li>`).join('')}
        </ul>
      </dd>
    `;
  } else {
    trackBlock = `
      <dt>Source track</dt><dd>${escape(r.sourceTrackName)}</dd>
      <dt>Output file</dt><dd>${escape(r.outputName)}</dd>
    `;
  }

  scanResultCard.innerHTML = `
    <div class="result-headline">
      <span class="result-icon hit">${ICONS.hit}</span>
      <div class="result-headline-text">
        <div class="result-title">Recipient identified</div>
        <div class="result-recipient">${escape(r.recipient)}</div>
      </div>
    </div>
    <dl class="result-grid">
      ${trackBlock}
      <dt>Sent</dt><dd>${fmtDate(r.createdAt)}</dd>
      <dt>Watermark ID</dt><dd class="mono">${r.id}</dd>
    </dl>
  `;
}

// --- history ---
const historyList = document.getElementById('history-list');
const historySearch = document.getElementById('history-search');
const historyCount = document.getElementById('history-count');
let historyCache = [];

function renderHistory() {
  const q = historySearch.value.trim().toLowerCase();
  const rows = q
    ? historyCache.filter(
        (r) =>
          r.recipient.toLowerCase().includes(q) ||
          (r.sourceTrackName || '').toLowerCase().includes(q)
      )
    : historyCache;

  historyCount.textContent = `${rows.length} ${rows.length === 1 ? 'copy' : 'copies'}${q ? ` of ${historyCache.length}` : ''}`;

  if (rows.length === 0) {
    historyList.innerHTML = `<div class="history-empty muted">${historyCache.length === 0 ? 'No watermarks yet. Generate some on the Watermark tab.' : 'No matches.'}</div>`;
    return;
  }

  historyList.innerHTML = rows
    .map(
      (r) => `
      <div class="history-row" data-output="${escape(r.outputPath)}">
        <div class="history-main">
          <div class="history-recipient">${escape(r.recipient)}</div>
          <div class="history-meta">
            <span>${escape(r.sourceTrackName || '')}</span>
            <span class="dot">·</span>
            <span>${fmtDate(r.createdAt)}</span>
          </div>
        </div>
        <code class="history-id">${r.id.slice(0, 8)}…${r.id.slice(-4)}</code>
      </div>
    `
    )
    .join('');

  historyList.querySelectorAll('.history-row').forEach((row) => {
    row.addEventListener('click', () => {
      const out = row.dataset.output;
      if (out) window.api.reveal(out);
    });
  });
}

async function loadHistory() {
  historyCache = await window.api.history();
  renderHistory();
}

historySearch.addEventListener('input', renderHistory);

scanBtn.addEventListener('click', async () => {
  if (!scanState.filePath) return;
  scanBtn.disabled = true;
  scanBtn.textContent = 'Scanning…';
  scanResultCard.hidden = true;
  try {
    const result = await window.api.scan(scanState.filePath);
    renderScanResult(result);
  } catch (err) {
    scanResultCard.hidden = false;
    scanResultCard.className = 'card scan-result none';
    scanResultCard.innerHTML = `
      <div class="result-headline">
        <span class="result-icon none">✕</span>
        <div>
          <div class="result-title">Scan failed</div>
          <div class="result-sub muted">${escape(err.message || String(err))}</div>
        </div>
      </div>
    `;
  } finally {
    scanBtn.textContent = 'Scan';
    scanBtn.disabled = false;
  }
});
