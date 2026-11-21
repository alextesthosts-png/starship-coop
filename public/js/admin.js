// Vanguard Wing admin panel.
import { render as renderMarkup, inline as inlineMarkup, escapeHtml as esc } from '/shared/markup.js';

const $ = (id) => document.getElementById(id);
let doc = null;          // working copy of the site content
let savedJson = '';      // last saved version, to detect unsaved changes
let me = null;

// ---------------- api ----------------
async function api(method, path, body) {
  const res = await fetch(`/api/admin/${path}`, {
    method, credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-vw-admin': '1' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401 && path !== 'login') { showLogin('Your session ended. Please sign in again.'); throw new Error('unauthorized'); }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}
function toast(text) {
  const t = $('toast'); t.textContent = text; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------------- login ----------------
function showLogin(msg = '') {
  $('app').classList.add('hidden'); $('login').classList.remove('hidden');
  $('login-err').textContent = msg; $('l-pass').value = ''; $('l-pass').focus();
}
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-err').textContent = '';
  try {
    await api('POST', 'login', { user: $('l-user').value.trim(), password: $('l-pass').value });
    await openApp();
  } catch (err) { $('login-err').textContent = err.message; }
});
$('btn-logout').onclick = async () => {
  if (isDirty() && !confirm('You have unsaved changes. Log out anyway?')) return;
  try { await api('POST', 'logout'); } catch {}
  savedJson = JSON.stringify(doc); showLogin();
};

async function openApp() {
  me = await api('GET', 'me');
  doc = await api('GET', 'content');
  savedJson = JSON.stringify(doc);
  window.VW = { api, toast, esc, getDoc: () => doc, changed, fillBindings, me };
  window.dispatchEvent(new Event('vw-ready'));
  $('login').classList.add('hidden'); $('app').classList.remove('hidden');
  $('pw-user').value = me.user || 'admin';
  renderAll();
  refreshStats();
}

// ---------------- binding ----------------
const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
function setPath(o, p, v) { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v; }
function isDirty() { return doc && JSON.stringify(doc) !== savedJson; }
function updateStatus(text, cls = '') {
  const dirty = isDirty();
  $('btn-save').disabled = !dirty;
  const st = $('save-status');
  st.className = `status ${cls || (dirty ? 'dirty' : '')}`;
  st.textContent = text || (dirty ? 'Unsaved changes' : (doc?.updatedAt ? `Saved ${new Date(doc.updatedAt).toLocaleString()}` : 'All changes saved'));
}
function changed() { updateStatus(); renderPreviews(); }

document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-bind]');
  if (!el || !doc) return;
  const v = el.type === 'checkbox' ? el.checked : el.value;
  setPath(doc, el.dataset.bind, v);
  // keep twin inputs (colour picker + hex box) in sync
  document.querySelectorAll(`[data-bind="${el.dataset.bind}"]`).forEach((o) => { if (o !== el && o.type !== 'checkbox' && /^#[0-9a-f]{6}$/i.test(v)) o.value = v; });
  changed();
});
function fillBindings() {
  document.querySelectorAll('[data-bind]').forEach((el) => {
    const v = getPath(doc, el.dataset.bind);
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
  });
}

// ---------------- navigation ----------------
$('side').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-page]'); if (!b) return;
  document.querySelectorAll('#side button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('hidden', p.id !== `p-${b.dataset.page}`));
  if (b.dataset.page === 'history') renderRevisions();
  window.dispatchEvent(new CustomEvent('vw-page', { detail: b.dataset.page }));
  window.scrollTo(0, 0);
});

// ---------------- render ----------------
function renderAll() { fillBindings(); renderSections(); renderReleases(); renderDefaultTab(); renderSwatches(); renderPreviews(); updateStatus(); }
function renderPreviews() {
  const a = doc.announcement;
  $('announce-preview').innerHTML = a.text ? `<div class="announce ${esc(a.style)}">${renderMarkup(a.text)}</div>${a.enabled ? '' : '<p class="hint">Hidden: switch it on to show it on the site.</p>'}` : '<p class="hint">Nothing to show yet.</p>';
  document.documentElement.style.setProperty('--cyan', doc.settings.accent);
}
function renderDefaultTab() {
  const opts = [['rooms', 'Open Wings'], ['howto', 'How to Play'], ['changelog', 'Changelog'], ...doc.sections.map((s) => [s.id, s.title])];
  $('default-tab').innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  $('default-tab').value = doc.settings.defaultTab;
}
function renderSwatches() {
  const cols = ['#6fd6ff', '#7dff8a', '#ffb347', '#ff6be0', '#ff5a4a', '#b18cff', '#ffd36a', '#ffffff'];
  $('swatches').innerHTML = cols.map((c) => `<button type="button" title="${c}" style="background:${c}" data-c="${c}"></button>`).join('');
  $('swatches').onclick = (e) => {
    const c = e.target.dataset.c; if (!c) return;
    doc.settings.accent = c; fillBindings(); changed();
  };
}

// ----- custom sections -----
const slugify = (t) => (t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'section') + '-' + Math.random().toString(36).slice(2, 6);
function renderSections() {
  const box = $('sections-list');
  if (!doc.sections.length) { box.innerHTML = '<div class="card empty">No custom sections yet.</div>'; renderDefaultTab(); return; }
  box.innerHTML = doc.sections.map((s, i) => `
    <div class="item-card" data-i="${i}">
      <div class="item-head">
        <input class="grow" data-f="title" value="${esc(s.title)}" maxlength="40" placeholder="Tab title" />
        <label class="switch" style="margin:0"><input type="checkbox" data-f="visible" ${s.visible ? 'checked' : ''} /> <span>Visible</span></label>
        <button class="mini" data-act="up" ${i === 0 ? 'disabled' : ''} title="Move left">↑</button>
        <button class="mini" data-act="down" ${i === doc.sections.length - 1 ? 'disabled' : ''} title="Move right">↓</button>
        <button class="mini danger" data-act="del">Delete</button>
      </div>
      <div class="two-col">
        <label class="fld"><span>Content</span><textarea data-f="body" rows="9" maxlength="10000" placeholder="Write here. Use - for bullet points, ## for a heading.">${esc(s.body)}</textarea></label>
        <div><div class="fld"><span>Preview</span></div><div class="preview md">${renderMarkup(s.body) || '<span class="hint">Preview appears here.</span>'}</div></div>
      </div>
      <div class="fmt-help">Formatting: <code>**bold**</code> <code>*italic*</code> <code>[link](https://…)</code> <code>- list item</code> <code>## Heading</code></div>
    </div>`).join('');
  renderDefaultTab();
}
$('sections-list').addEventListener('input', (e) => {
  const card = e.target.closest('.item-card'); if (!card) return;
  const s = doc.sections[+card.dataset.i]; const f = e.target.dataset.f; if (!f) return;
  s[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (f === 'body') card.querySelector('.preview').innerHTML = renderMarkup(s.body) || '<span class="hint">Preview appears here.</span>';
  if (f === 'title') renderDefaultTab();
  e.stopPropagation(); changed();
});
$('sections-list').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const i = +b.closest('.item-card').dataset.i;
  if (b.dataset.act === 'del') { if (!confirm(`Delete the section "${doc.sections[i].title}"?`)) return; doc.sections.splice(i, 1); }
  if (b.dataset.act === 'up' && i > 0) [doc.sections[i - 1], doc.sections[i]] = [doc.sections[i], doc.sections[i - 1]];
  if (b.dataset.act === 'down' && i < doc.sections.length - 1) [doc.sections[i + 1], doc.sections[i]] = [doc.sections[i], doc.sections[i + 1]];
  renderSections(); changed();
});
$('btn-add-section').onclick = () => {
  if (doc.sections.length >= 12) return toast('Up to 12 sections.');
  doc.sections.push({ id: slugify('section'), title: 'New section', body: '', visible: true });
  renderSections(); changed();
  $('sections-list').lastElementChild.querySelector('input').select();
};

// ----- changelog -----
function today() { return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
function nextVersion() {
  const v = doc.changelog[0]?.version || 'v1.0';
  const m = v.match(/^(v?)(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? `${m[1]}${m[2]}.${+m[3] + 1}` : 'v1.0';
}
function renderReleases() {
  const box = $('releases');
  if (!doc.changelog.length) { box.innerHTML = '<div class="card empty">No releases yet.</div>'; return; }
  box.innerHTML = doc.changelog.map((r, i) => `
    <div class="item-card" data-i="${i}">
      <div class="item-head">
        <input class="ver" data-f="version" value="${esc(r.version)}" maxlength="24" placeholder="v1.5" />
        <input class="dt" data-f="date" value="${esc(r.date)}" maxlength="40" placeholder="Date" />
        <input class="grow" data-f="title" value="${esc(r.title)}" maxlength="100" placeholder="Optional headline" />
        <label class="switch" style="margin:0"><input type="checkbox" data-f="latest" ${r.latest ? 'checked' : ''} /> <span>“Latest” tag</span></label>
        <button class="mini" data-act="up" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button>
        <button class="mini" data-act="down" ${i === doc.changelog.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
        <button class="mini danger" data-act="del">Delete</button>
      </div>
      <div class="two-col">
        <label class="fld"><span>Notes — one bullet per line</span><textarea data-f="items" rows="${Math.min(12, Math.max(4, r.items.length + 2))}" maxlength="20000">${esc(r.items.join('\n'))}</textarea></label>
        <div><div class="fld"><span>Preview</span></div><div class="preview">${previewRelease(r)}</div></div>
      </div>
    </div>`).join('');
}
function previewRelease(r) {
  return `<b>${esc(r.version)}</b> <span class="hint">${esc(r.date)}</span>${r.latest ? ' <span class="tag new">Latest</span>' : ''}${r.title ? ` — ${inlineMarkup(r.title)}` : ''}<ul>${r.items.map((t) => `<li>${inlineMarkup(t)}</li>`).join('')}</ul>`;
}
$('releases').addEventListener('input', (e) => {
  const card = e.target.closest('.item-card'); if (!card) return;
  const r = doc.changelog[+card.dataset.i]; const f = e.target.dataset.f; if (!f) return;
  if (f === 'items') r.items = e.target.value.split('\n').map((x) => x.replace(/^\s*[-•]\s*/, '').trim()).filter(Boolean);
  else if (f === 'latest') {
    r.latest = e.target.checked;
    if (r.latest) doc.changelog.forEach((o) => { if (o !== r) o.latest = false; });
    renderReleases(); changed(); e.stopPropagation(); return;
  } else r[f] = e.target.value;
  card.querySelector('.preview').innerHTML = previewRelease(r);
  e.stopPropagation(); changed();
});
$('releases').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const i = +b.closest('.item-card').dataset.i; const L = doc.changelog;
  if (b.dataset.act === 'del') { if (!confirm(`Delete release ${L[i].version}?`)) return; L.splice(i, 1); }
  if (b.dataset.act === 'up' && i > 0) [L[i - 1], L[i]] = [L[i], L[i - 1]];
  if (b.dataset.act === 'down' && i < L.length - 1) [L[i + 1], L[i]] = [L[i], L[i + 1]];
  renderReleases(); changed();
});
$('btn-add-release').onclick = () => {
  doc.changelog.forEach((r) => { r.latest = false; });
  doc.changelog.unshift({ id: slugify('release'), version: nextVersion(), date: today(), title: '', latest: true, items: [] });
  renderReleases(); changed();
  $('releases').querySelector('textarea').focus();
};

// ----- history -----
async function renderRevisions() {
  const box = $('revisions'); box.innerHTML = '<div class="hint">Loading…</div>';
  try {
    const list = await api('GET', 'revisions');
    box.innerHTML = list.length ? list.map((r) => {
      const when = new Date(r.savedAt.replace(/T(\d+)-(\d+)-(\d+)-(\d+)Z/, 'T$1:$2:$3.$4Z'));
      return `<div class="rev"><span class="grow">Version replaced on <b>${esc(isNaN(when) ? r.savedAt : when.toLocaleString())}</b>${r.updatedBy ? ` · last edited by ${esc(r.updatedBy)}` : ' · original content'} · ${r.releases} releases</span>
        <button class="mini" data-rev="${esc(r.id)}">Restore</button></div>`;
    }).join('') : '<div class="empty">No history yet. It fills up as you save.</div>';
  } catch (e) { box.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}
$('revisions').addEventListener('click', async (e) => {
  const id = e.target.dataset.rev; if (!id) return;
  if (isDirty() && !confirm('You have unsaved changes; restoring will discard them. Continue?')) return;
  if (!confirm('Make this version live again?')) return;
  try { doc = await api('POST', 'revisions/restore', { id }); savedJson = JSON.stringify(doc); renderAll(); renderRevisions(); toast('Version restored and live.'); }
  catch (err) { toast(err.message); }
});
$('btn-export').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
  a.download = `vanguard-wing-content-${new Date().toISOString().slice(0, 10)}.json`; a.click();
};

// ----- account -----
$('pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('pw-msg');
  if ($('pw-new').value !== $('pw-new2').value) { msg.textContent = 'The new passwords don’t match.'; return; }
  try {
    await api('POST', 'password', { current: $('pw-cur').value, next: $('pw-new').value });
    msg.textContent = 'Password changed. Other sessions were signed out.';
    e.target.reset();
  } catch (err) { msg.textContent = err.message; }
});

// ----- save -----
async function save() {
  if (!isDirty()) return;
  updateStatus('Saving…');
  try {
    doc = await api('PUT', 'content', doc);
    savedJson = JSON.stringify(doc);
    renderAll(); toast('Saved: the site is updated.'); window.dispatchEvent(new Event('vw-saved'));
  } catch (e) { updateStatus(`Save failed: ${e.message}`, 'err'); }
}
$('btn-save').onclick = save;
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } });
window.addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

async function refreshStats() {
  try {
    const s = await api('GET', 'stats');
    $('stats').innerHTML = `<b>${s.players}</b> pilots online<br><b>${s.rooms}</b> wings · <b>${s.playing}</b> in flight`;
  } catch {}
  setTimeout(refreshStats, 15000);
}

// ---------------- boot ----------------
(async () => {
  try {
    const m = await (await fetch('/api/admin/me', { credentials: 'same-origin' })).json();
    if (!m.configured) { showLogin('Admin is not set up yet: set the ADMIN_PASSWORD variable on the server.'); return; }
    if (m.authed) await openApp(); else showLogin();
  } catch { showLogin('Could not reach the server.'); }
})();
