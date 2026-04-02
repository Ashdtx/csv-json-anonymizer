const state = {
  rows: [],
  columns: [],
  config: {},
  anonRows: [],
  stats: {},
  mappings: {},
};

const defaults = {
  placeholders: { name: '[NAME]', email: '[EMAIL]', phone: '[PHONE]', id: '[ID]', address: '[ADDRESS]', username: '[USERNAME]' },
  emptyThreshold: 0.9,
};

const el = (id) => document.getElementById(id);

const patterns = {
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  phone: /\+?\d[\d\s().-]{7,}\d/g,
  id: /\b\d{8,}\b/g,
  username: /\b@[a-z0-9_]{2,}\b/gi,
};

const nameHints = ['name', 'fullname', 'first', 'last', 'customer', 'employee', 'person'];
const sensitiveHints = {
  email: ['email', 'e-mail'],
  phone: ['phone', 'mobile', 'tel'],
  id: ['id', 'passport', 'national', 'employee', 'customer_no', 'ssn'],
  address: ['address', 'street', 'city', 'zip', 'postcode'],
  username: ['username', 'user', 'login', 'handle'],
};

function saveConfig() {
  localStorage.setItem('anonToolConfig', JSON.stringify(state.config));
}

function loadConfig() {
  try {
    const parsed = JSON.parse(localStorage.getItem('anonToolConfig') || '{}');
    state.config = parsed;
  } catch { state.config = {}; }
}

function inferType(values) {
  const v = values.find((x) => x !== null && x !== undefined && `${x}`.trim() !== '');
  if (!v) return 'empty';
  if (!isNaN(Number(v))) return 'number';
  if (!isNaN(Date.parse(v))) return 'date';
  return 'text';
}

function getColumnStats(col) {
  const vals = state.rows.map((r) => r[col]);
  const empties = vals.filter((v) => v === '' || v === null || v === undefined).length;
  const distinct = new Set(vals.map((v) => `${v ?? ''}`)).size;
  const samples = [...new Set(vals.filter((v) => v !== '' && v != null).slice(0, 8).map(String))].slice(0, 5);
  return {
    type: inferType(vals),
    empties,
    emptyRatio: state.rows.length ? empties / state.rows.length : 0,
    distinct,
    constant: distinct <= 1,
    samples,
  };
}

function detectSensitivity(col, samples) {
  const lower = col.toLowerCase();
  const sampleText = samples.join(' | ');
  if (nameHints.some((h) => lower.includes(h))) return 'name';
  for (const [k, hints] of Object.entries(sensitiveHints)) if (hints.some((h) => lower.includes(h))) return k;
  if (patterns.email.test(sampleText)) return 'email';
  if (patterns.phone.test(sampleText)) return 'phone';
  if (patterns.id.test(sampleText)) return 'id';
  return null;
}

function suggestColumns() {
  const out = [];
  state.columns.forEach((c) => {
    const s = getColumnStats(c);
    const sens = detectSensitivity(c, s.samples);
    const tags = [];
    if (s.emptyRatio === 1) tags.push('empty');
    else if (s.emptyRatio >= defaults.emptyThreshold) tags.push('mostly empty');
    if (s.constant) tags.push('constant');
    if (/debug|tmp|temp|export|meta/i.test(c)) tags.push('technical');
    if (sens) tags.push(`possible ${sens}`);
    out.push({ col: c, stats: s, sensitivity: sens, tags });
    if (!state.config[c]) state.config[c] = { action: sens ? 'anonymize' : 'keep', mode: 'replace-sensitive', placeholder: sens ? defaults.placeholders[sens] || '[REDACTED]' : '[REDACTED]' };
  });
  return out;
}

function renderColumnList(suggestions) {
  const q = el('columnSearch').value?.toLowerCase() || '';
  el('columnList').innerHTML = suggestions.filter((x) => x.col.toLowerCase().includes(q)).map((x) => {
    const badges = x.tags.map((t) => `<span class="badge ${t.includes('possible') ? 'risk' : ''}">${t}</span>`).join('');
    return `<div><strong>${x.col}</strong> (${x.stats.type}) ${badges}<br/><small>empty: ${x.stats.empties}/${state.rows.length}, distinct: ${x.stats.distinct}, samples: ${x.stats.samples.join(', ') || '-'}</small></div><hr/>`;
  }).join('');
}

function renderSuggestions(suggestions) {
  el('suggestions').innerHTML = suggestions.filter((x) => x.tags.length).map((x) => `<div><strong>${x.col}</strong>: ${x.tags.join(', ')}</div>`).join('') || '<div>No removal suggestions.</div>';
  el('sensitivityPanel').innerHTML = suggestions.filter((x) => x.sensitivity).map((x) => `<div><strong>${x.col}</strong>: likely ${x.sensitivity}</div>`).join('') || '<div>No obvious sensitive columns detected.</div>';
}

function renderPreviewTable(rows, tableId) {
  const cols = state.columns;
  const header = `<tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>`;
  const body = rows.map((r) => `<tr>${cols.map((c) => `<td>${r[c] ?? ''}</td>`).join('')}</tr>`).join('');
  el(tableId).innerHTML = header + body;
}

function renderRules() {
  el('rulesTable').innerHTML = state.columns.map((c) => {
    const cfg = state.config[c] || { action: 'keep', mode: 'replace-sensitive', placeholder: '[REDACTED]' };
    return `<div class="rule-row">
      <div><strong>${c}</strong></div>
      <select data-col="${c}" data-k="action">
        <option ${cfg.action==='keep'?'selected':''}>keep</option>
        <option ${cfg.action==='remove'?'selected':''}>remove</option>
        <option ${cfg.action==='clear'?'selected':''}>clear</option>
        <option ${cfg.action==='mask'?'selected':''}>mask</option>
        <option ${cfg.action==='anonymize'?'selected':''}>anonymize</option>
      </select>
      <select data-col="${c}" data-k="mode">
        <option value="replace-sensitive" ${cfg.mode==='replace-sensitive'?'selected':''}>replace-sensitive</option>
        <option value="replace-all" ${cfg.mode==='replace-all'?'selected':''}>replace-all</option>
        <option value="custom-regex" ${cfg.mode==='custom-regex'?'selected':''}>custom-regex</option>
      </select>
      <input data-col="${c}" data-k="placeholder" value="${cfg.placeholder || '[REDACTED]'}" placeholder="placeholder or regex=>value" />
    </div>`;
  }).join('');
}

function mask(v) {
  const s = String(v ?? '');
  if (s.length <= 4) return '*'.repeat(s.length);
  return `${s.slice(0, 2)}${'*'.repeat(Math.max(2, s.length - 4))}${s.slice(-2)}`;
}

function consistentToken(kind, value) {
  const key = `${kind}:${value}`;
  if (!state.mappings[key]) {
    const n = Object.keys(state.mappings).filter((k) => k.startsWith(`${kind}:`)).length + 1;
    state.mappings[key] = `[${kind.toUpperCase()}_${n}]`;
  }
  return state.mappings[key];
}

function anonymizeText(v, placeholder, col) {
  let txt = String(v ?? '');
  const replacements = [
    ['email', patterns.email],
    ['phone', patterns.phone],
    ['id', patterns.id],
    ['username', patterns.username],
  ];
  replacements.forEach(([kind, re]) => {
    txt = txt.replace(re, (m) => el('consistentTokens').checked ? consistentToken(kind, m) : defaults.placeholders[kind]);
  });
  if (nameHints.some((h) => col.toLowerCase().includes(h)) && txt.trim()) {
    txt = el('consistentTokens').checked ? consistentToken('name', txt) : (placeholder || defaults.placeholders.name);
  }
  return txt;
}

function transformCell(col, value) {
  const cfg = state.config[col] || { action: 'keep' };
  if (cfg.action === 'keep') return value;
  if (cfg.action === 'clear') return '';
  if (cfg.action === 'mask') return mask(value);
  if (cfg.action === 'anonymize') {
    if (cfg.mode === 'replace-all') return cfg.placeholder || '[REDACTED]';
    if (cfg.mode === 'custom-regex') {
      const [raw, rep] = (cfg.placeholder || '').split('=>');
      try { return String(value ?? '').replace(new RegExp(raw, 'gi'), rep || '[REDACTED]'); } catch { return String(value ?? ''); }
    }
    return anonymizeText(value, cfg.placeholder, col);
  }
  return value;
}

function transformRows(rows) {
  const keepStructure = el('preserveStructure').checked;
  return rows.map((r) => {
    const out = {};
    state.columns.forEach((c) => {
      const cfg = state.config[c] || { action: 'keep' };
      if (cfg.action === 'remove' && !keepStructure) return;
      out[c] = cfg.action === 'remove' ? '' : transformCell(c, r[c]);
    });
    return out;
  });
}

function changedCount(before, after) {
  let rowsChanged = 0, cellsChanged = 0;
  before.forEach((r, i) => {
    let rowChanged = false;
    for (const c of Object.keys(after[i] || {})) {
      if (`${r[c] ?? ''}` !== `${after[i][c] ?? ''}`) { rowChanged = true; cellsChanged++; }
    }
    if (rowChanged) rowsChanged++;
  });
  return { rowsChanged, cellsChanged };
}

function renderBeforeAfter() {
  const sample = state.rows.slice(0, 30);
  const transformed = transformRows(sample);
  renderPreviewTable(sample, 'beforeTable');
  renderPreviewTable(transformed, 'afterTable');
  const c = changedCount(sample, transformed);
  el('previewStats').textContent = `Sample rows: ${sample.length}. Changed rows: ${c.rowsChanged}. Changed cells: ${c.cellsChanged}.`;
  highlightDiff('beforeTable', 'afterTable');
}

function highlightDiff(beforeId, afterId) {
  const b = el(beforeId), a = el(afterId);
  for (let r = 1; r < a.rows.length; r++) {
    for (let c = 0; c < a.rows[r].cells.length; c++) {
      if ((b.rows[r]?.cells[c]?.textContent || '') !== (a.rows[r]?.cells[c]?.textContent || '')) {
        a.rows[r].cells[c].classList.add('changed');
      }
    }
  }
}

async function applyAllRows() {
  const total = state.rows.length;
  state.anonRows = [];
  state.stats = { emails: 0, phones: 0, ids: 0 };
  el('globalProgress').classList.remove('hidden');
  for (let i = 0; i < total; i += 1000) {
    const chunk = state.rows.slice(i, i + 1000);
    const out = transformRows(chunk);
    out.forEach((r) => {
      const str = JSON.stringify(r);
      if ((str.match(/\[EMAIL(_\d+)?\]|\[EMAIL\]/g) || []).length) state.stats.emails += (str.match(/\[EMAIL(_\d+)?\]|\[EMAIL\]/g) || []).length;
      if ((str.match(/\[PHONE(_\d+)?\]|\[PHONE\]/g) || []).length) state.stats.phones += (str.match(/\[PHONE(_\d+)?\]|\[PHONE\]/g) || []).length;
      if ((str.match(/\[ID(_\d+)?\]|\[ID\]/g) || []).length) state.stats.ids += (str.match(/\[ID(_\d+)?\]|\[ID\]/g) || []).length;
    });
    state.anonRows.push(...out);
    const pct = Math.round(Math.min(100, ((i + chunk.length) / total) * 100));
    el('globalBar').style.width = `${pct}%`;
    el('globalLabel').textContent = `Applying ${pct}% (${Math.min(i + chunk.length, total)}/${total})`;
    await new Promise((r) => setTimeout(r, 0));
  }

  const removed = state.columns.filter((c) => state.config[c]?.action === 'remove' && !el('preserveStructure').checked);
  const cleared = state.columns.filter((c) => ['clear', 'remove'].includes(state.config[c]?.action) && el('preserveStructure').checked);
  const anonymized = state.columns.filter((c) => state.config[c]?.action === 'anonymize' || state.config[c]?.action === 'mask');
  const cc = changedCount(state.rows, state.anonRows);
  el('applySummary').innerHTML = `Rows processed: ${total}<br/>Columns removed: ${removed.join(', ') || '-'}<br/>Columns cleared: ${cleared.join(', ') || '-'}<br/>Columns anonymized/masked: ${anonymized.join(', ') || '-'}<br/>Emails replaced: ${state.stats.emails}, Phones replaced: ${state.stats.phones}, IDs replaced: ${state.stats.ids}<br/>Rows changed: ${cc.rowsChanged}`;
  el('downloadCsv').disabled = false;
  el('downloadJson').disabled = false;
  el('globalLabel').textContent = 'Done';
}

function download(content, filename, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function attachRuleListeners() {
  el('rulesTable').addEventListener('change', (e) => {
    const t = e.target;
    const c = t.getAttribute('data-col');
    const k = t.getAttribute('data-k');
    if (!c || !k) return;
    state.config[c] = state.config[c] || {};
    state.config[c][k] = t.value;
    saveConfig();
  });
}

function showSteps() {
  ['reviewStep', 'rulesStep', 'previewStep', 'applyStep'].forEach((id) => el(id).classList.remove('hidden'));
}

function parseJSON(text) {
  const parsed = JSON.parse(text);

  if (Array.isArray(parsed)) return parsed;

  if (parsed && typeof parsed === 'object') {
    const candidateKeys = ['data', 'rows', 'items', 'records', 'result', 'results'];
    for (const key of candidateKeys) {
      if (Array.isArray(parsed[key])) return parsed[key];
    }
    return [parsed];
  }

  throw new Error('JSON must be an array, an object, or an object containing data/rows/items/records/result/results array');
}

el('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    el('globalProgress').classList.remove('hidden');
    el('globalBar').style.width = '10%';
    el('globalLabel').textContent = 'Parsing file...';

    if (ext === 'json') {
      const text = await file.text();
      state.rows = parseJSON(text);
    } else {
      const text = await file.text();
      state.rows = Papa.parse(text, { header: true, skipEmptyLines: true, worker: true }).data;
    }

    if (!state.rows.length) throw new Error('No rows found in the uploaded file');

    state.columns = Array.from(new Set(state.rows.flatMap((r) => Object.keys(r))));
    const suggestions = suggestColumns();
    saveConfig();
    el('summary').textContent = `Loaded ${file.name}. Rows: ${state.rows.length}. Columns: ${state.columns.length}.`;
    renderColumnList(suggestions);
    renderSuggestions(suggestions);
    renderPreviewTable(state.rows.slice(0, 30), 'previewTable');
    renderRules();
    showSteps();
    el('globalBar').style.width = '100%';
    el('globalLabel').textContent = 'Ready';
  } catch (err) {
    console.error(err);
    el('summary').textContent = `Could not parse ${file.name}: ${err?.message || err}`;
    el('globalBar').style.width = '100%';
    el('globalLabel').textContent = 'Parse error';
  }
});

el('columnSearch').addEventListener('input', () => renderColumnList(suggestColumns()));
el('runPreview').addEventListener('click', renderBeforeAfter);
el('applyAll').addEventListener('click', applyAllRows);
el('downloadCsv').addEventListener('click', () => {
  const csv = Papa.unparse(state.anonRows);
  download(csv, 'anonymized.csv', 'text/csv;charset=utf-8');
});
el('downloadJson').addEventListener('click', () => download(JSON.stringify(state.anonRows, null, 2), 'anonymized.json', 'application/json'));
el('resetConfig').addEventListener('click', () => {
  state.config = {};
  suggestColumns();
  renderRules();
  saveConfig();
});
el('exportConfig').addEventListener('click', () => download(JSON.stringify(state.config, null, 2), 'anonymizer-config.json', 'application/json'));
el('importConfig').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  state.config = JSON.parse(await f.text());
  saveConfig();
  renderRules();
});
el('importConfig').parentElement.addEventListener('click', () => el('importConfig').click());

loadConfig();
attachRuleListeners();