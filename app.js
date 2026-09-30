(function () {
'use strict';

// ====================================================================
// Basics
// ====================================================================
const CFG = window.PORTAL_CONFIG || {};
if (CFG.SUPABASE_URL) CFG.SUPABASE_URL = String(CFG.SUPABASE_URL).trim().replace(/\/(rest|auth|storage)\/v1\/?.*$/, '').replace(/\/+$/, '');
if (CFG.SUPABASE_ANON_KEY) CFG.SUPABASE_ANON_KEY = String(CFG.SUPABASE_ANON_KEY).replace(/\s+/g, '');
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const app = $('#app');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt1 = n => (n == null || isNaN(n)) ? '—' : (Math.round(n * 10) / 10).toFixed(1);
const fmtInt = n => (n == null || isNaN(n)) ? '—' : String(Math.round(n * 10) / 10);
const money = n => (n == null || n === '' || isNaN(n)) ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
const ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* ignore */ } }
};
const DEFAULT_COLLEGES = ['Arts and Sciences', 'Business', 'Engineering', 'Law', 'Pharmacy and Health Sciences'];
const DECISIONS = [
  ['', '— undecided —'], ['fund', 'Fund in full'], ['partial', 'Fund partially'],
  ['fund_micro', 'Fund as micro-grant'], ['hold', 'Hold / waitlist'], ['decline', 'Decline']
];
const FUNDED = new Set(['fund', 'partial', 'fund_micro']);

const S = {
  api: null, demo: false, me: null, settings: {}, proposals: [], padmin: {}, reviews: [], profiles: [],
  loaded: false, leaveHook: null, fundSort: 'mean', scoreSort: 'mean'
};

const demoAllowed = () => CFG.ALLOW_DEMO !== false;
const isDemo = () => demoAllowed() && /[?&]demo\b/.test(location.search);
const MGMT_KEY = isDemo() ? 'aigp-mgmt-demo' : 'aigp-mgmt';
const configured = () => !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase);
const isAdmin = () => !!(S.me && S.me.role === 'admin');
const colleges = () => (Array.isArray(S.settings.colleges) && S.settings.colleges.length) ? S.settings.colleges : DEFAULT_COLLEGES;
const reviewsOpen = () => S.settings.reviews_open !== false;
const R = () => (S.settings.rubric && Array.isArray(S.settings.rubric.criteria) && S.settings.rubric.criteria.length) ? S.settings.rubric : window.DEFAULT_RUBRIC;
const threshold = () => Number(S.settings.threshold == null ? 31 : S.settings.threshold);
const thrIncludesBonus = () => S.settings.threshold_includes_bonus !== false;
const budgetCap = () => Number(S.settings.budget_cap == null ? 35000 : S.settings.budget_cap);
const disagreeSD = () => Number(S.settings.disagreement_sd == null ? 1 : S.settings.disagreement_sd);
const go = path => { location.hash = '#/' + path; };

// ====================================================================
// UI helpers
// ====================================================================
function toast(msg, kind) {
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 2600);
}

function modal({ title, body, ok = 'OK', cancel = 'Cancel', danger = false, onOk, wide = false }) {
  return new Promise(resolve => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="${wide ? 'max-width:680px' : ''}">
      <div class="mh"><h3>${esc(title)}</h3></div>
      <div class="mb">${body || ''}<div class="err" data-err></div></div>
      <div class="mf">${cancel ? `<button class="btn" data-x>${esc(cancel)}</button>` : ''}
      ${ok ? `<button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(ok)}</button>` : ''}</div></div>`;
    document.body.appendChild(bg);
    const close = v => { bg.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') close(false); };
    document.addEventListener('keydown', onKey);
    bg.addEventListener('click', async e => {
      if (e.target === bg || e.target.closest('[data-x]')) return close(false);
      if (e.target.closest('[data-copy]')) {
        const txt = $(e.target.closest('[data-copy]').dataset.copy, bg).textContent;
        copyText(txt);
      }
      if (e.target.closest('[data-ok]')) {
        const btn = e.target.closest('[data-ok]');
        if (onOk) {
          btn.disabled = true;
          try {
            const r = await onOk(bg);
            if (r === false) { btn.disabled = false; return; }
            close(r === undefined ? true : r);
          } catch (err) { $('[data-err]', bg).textContent = err.message || String(err); btn.disabled = false; }
        } else close(true);
      }
    });
    const first = $('input,textarea,select', bg);
    if (first) setTimeout(() => first.focus(), 30);
  });
}
const confirmBox = (title, text, ok = 'Confirm', danger = false) => modal({ title, body: `<p style="margin:0">${text}</p>`, ok, danger });

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('Copied to clipboard', 'ok'); }
  catch (e) { toast('Copy failed — select the text and copy it manually.', 'bad'); }
}

function genPassword() {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const buf = new Uint32Array(12); crypto.getRandomValues(buf);
  let s = ''; buf.forEach((v, i) => { s += a[v % a.length]; if (i === 3 || i === 7) s += '-'; });
  return s;
}

function download(filename, text, type = 'text/csv') {
  const blob = new Blob([text], { type: type + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function csv(rows) {
  return '﻿' + rows.map(r => r.map(v => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
}
const stamp = () => new Date().toISOString().slice(0, 10);
const timeStr = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dateStr = iso => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
function deadlineStr() {
  const d = S.settings.review_deadline;
  if (!d) return '';
  const dt = new Date(d + 'T12:00:00');
  return isNaN(dt) ? String(d) : dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
const tierChip = t => `<span class="tier ${t === 'midi' ? 'midi' : 'micro'}">${t === 'midi' ? 'Midi' : 'Micro'}</span>`;

// ====================================================================
// Scoring maths
// ====================================================================
const maxBase = () => R().criteria.reduce((a, c) => a + 4 * Number(c.weight || 0), 0);
const maxBonus = () => R().bonuses.reduce((a, b) => a + Number(b.points || 0), 0);
const isNum = v => typeof v === 'number' && !isNaN(v);
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const sd = a => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); };

function calc(r) {
  const rb = R(); let base = 0, scored = 0, bonus = 0;
  rb.criteria.forEach(c => { const v = r && r.scores && r.scores[c.key]; if (isNum(v)) { base += v * Number(c.weight); scored++; } });
  rb.bonuses.forEach(b => { const v = r && r.scores && r.scores[b.key]; if (v) bonus += Number(b.points); });
  return { base, bonus, total: base + bonus, scored, complete: scored === rb.criteria.length };
}

function stats(pid) {
  const rs = S.reviews.filter(r => r.proposal_id === pid);
  const subs = rs.filter(r => r.status === 'submitted');
  const totals = subs.map(r => calc(r).total), bases = subs.map(r => calc(r).base);
  const crit = {};
  R().criteria.concat(R().bonuses).forEach(c => {
    const vals = subs.map(r => (r.scores || {})[c.key]).filter(isNum);
    crit[c.key] = { vals, mean: mean(vals), sd: sd(vals) };
  });
  const gate = R().criteria.find(c => c.gate);
  const compVals = gate ? crit[gate.key].vals : [];
  const compMean = gate ? crit[gate.key].mean : null;
  const m = mean(totals), mb = mean(bases);
  const forThr = thrIncludesBonus() ? m : mb;
  let status = 'pending';
  if (subs.length) status = (compMean === 0) ? 'gate' : (forThr >= threshold() ? 'above' : 'below');
  const disagreements = R().criteria.filter(c => crit[c.key].sd != null && crit[c.key].sd >= disagreeSD());
  return {
    rs, subs, drafts: rs.filter(r => r.status === 'draft'), recused: rs.filter(r => r.status === 'recused'),
    n: subs.length, totals, mean: m, sd: sd(totals), min: totals.length ? Math.min(...totals) : null,
    max: totals.length ? Math.max(...totals) : null, meanBase: mb, crit, compZeroAny: compVals.some(v => v === 0),
    compMean, status, forThr, disagreements
  };
}
function statusBadge(st) {
  if (st.status === 'above') return '<span class="badge b-ok">Above threshold</span>';
  if (st.status === 'gate') return '<span class="badge b-bad">Competency mean = 0</span>';
  if (st.status === 'below') return '<span class="badge b-plain">Below threshold</span>';
  return '<span class="badge b-warn">Awaiting reviews</span>';
}
const coordReviews = () => S.settings.coordinator_reviews !== false;
const isReviewing = p => !!p.active && (p.role !== 'admin' || coordReviews());
const members = () => S.profiles.filter(isReviewing);
const released = () => S.proposals.filter(p => p.released).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
const myReview = pid => S.reviews.find(r => r.proposal_id === pid && r.reviewer_id === S.me.id);

// ====================================================================
// Data
// ====================================================================
async function loadAll() {
  const [settings, proposals, reviews] = await Promise.all([S.api.getSettings(), S.api.listProposals(), S.api.listReviews()]);
  S.settings = settings || {}; S.proposals = proposals; S.reviews = reviews;
  if (isAdmin()) {
    const [pa, profs] = await Promise.all([S.api.listProposalAdmin(), S.api.listProfiles()]);
    S.padmin = {}; pa.forEach(x => { S.padmin[x.proposal_id] = x; });
    S.profiles = profs;
  }
  S.loaded = true;
}
const pa = pid => S.padmin[pid] || { proposal_id: pid, college: '', requested: 0, decision: '', awarded: null, notes: '' };

// ====================================================================
// Top bar
// ====================================================================
function topbar() {
  const parts = parse();
  const area = parts[0] === 'manage' ? 'Grants Management' : parts[0] === 'review' ? 'Proposal Review' : 'Grants Portal';
  const signedIn = S.me && parts[0] === 'review';
  $('#topbar').innerHTML = `
    <a class="brand" href="#/">
      <span class="brand-mark"><svg width="18" height="18" viewBox="0 0 32 32"><path d="M8 24l8-16 8 16" stroke="#e0b04a" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <span style="min-width:0"><div class="brand-name">${esc(CFG.PROGRAM_NAME || 'Innovations with AI')}</div><div class="brand-sub">${esc(area)}</div></span>
    </a>
    <span class="spacer"></span>
    ${S.demo ? '<span class="demo-flag" title="Sample data stored only in this browser">Demo</span>' : ''}
    ${signedIn ? `<div class="userchip"><span class="who">${esc(S.me.display_name || S.me.email)}${isAdmin() ? ' · Coordinator' : ''}</span>
      <button class="btn sm" data-top="pw">Password</button><button class="btn sm" data-top="out">Sign out</button></div>` : ''}
    ${parts[0] === 'manage' && ss.get(MGMT_KEY) === '1' ? '<button class="btn sm" data-top="lock">Lock</button>' : ''}`;
  $('#topbar').onclick = async e => {
    const b = e.target.closest('[data-top]'); if (!b) return;
    if (b.dataset.top === 'out') { await S.api.signOut(); S.me = null; S.loaded = false; go(''); }
    if (b.dataset.top === 'pw') changeOwnPassword();
    if (b.dataset.top === 'lock') { ss.del(MGMT_KEY); go(''); }
  };
}

function changeOwnPassword() {
  modal({
    title: 'Change your password',
    body: `<div class="stack"><div><label class="f">New password (8+ characters)</label><input class="input" type="password" id="np1" autocomplete="new-password"></div>
           <div><label class="f">Confirm</label><input class="input" type="password" id="np2" autocomplete="new-password"></div></div>`,
    ok: 'Change password',
    onOk: async bg => {
      const a = $('#np1', bg).value, b = $('#np2', bg).value;
      if (a.length < 8) throw new Error('Use at least 8 characters.');
      if (a !== b) throw new Error('The passwords do not match.');
      await S.api.changeOwnPassword(a); toast('Password changed', 'ok');
    }
  });
}

// ====================================================================
// Router
// ====================================================================
function parse() { return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean); }

let rendering = 0;
async function render() {
  const my = ++rendering;
  if (S.leaveHook) { const f = S.leaveHook; S.leaveHook = null; try { await f(); } catch (e) { /* ignore */ } }
  if (my !== rendering) return;
  const parts = parse();
  document.body.style.overflow = '';
  topbar();
  try {
    if (!parts.length) return viewLanding();
    if (parts[0] === 'manage') return viewManage();
    if (parts[0] === 'review') {
      if (!S.api || !S.me) return go('');
      if (!S.loaded) { app.innerHTML = '<div class="empty">Loading…</div>'; await loadAll(); if (my !== rendering) return; }
      if (parts[1] === 'p' && parts[2]) return viewScore(parts[2]);
      if (isAdmin()) {
        if (parts[1] === 'admin' && parts[2] === 'proposal' && parts[3]) return viewDetail(parts[3]);
        if (parts[1] === 'admin') return viewAdmin(parts[2] || 'scores');
        return go('review/admin/scores');
      }
      return viewQueue();
    }
    viewLanding();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="wrap"><div class="card pad"><h3>Something went wrong</h3><p class="muted">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Reload</button></div></div>`;
  }
}
async function refresh() { S.loaded = false; await render(); toast('Refreshed'); }

// ====================================================================
// Landing (portal)
// ====================================================================
function viewLanding() {
  const reviewCard = !S.api ? `
      <div class="notice">${!window.PORTAL_CONFIG ? '<strong>config.js did not load.</strong> It is missing from the same folder as index.html, misnamed, or has a typo (a missing quote or comma).'
        : !(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) ? 'The review platform is not connected yet: <code>SUPABASE_URL</code> and/or <code>SUPABASE_ANON_KEY</code> are blank in <code>config.js</code>.'
        : '<strong>The Supabase library could not be loaded</strong> (cdn.jsdelivr.net may be blocked on this network). Try another network or browser.'}</div>
      ${demoAllowed() ? '<a class="btn gold" href="?demo#/">Explore the demo</a>' : ''}`
    : S.me ? `
      <p>Signed in as <strong>${esc(S.me.display_name || S.me.email)}</strong>.</p>
      <div class="row"><a class="btn primary" href="#/review">Continue to reviews →</a><button class="btn ghost" data-act="signout">Sign out</button></div>`
    : `<form id="loginForm" autocomplete="on">
        <div><label class="f" for="lemail">Email</label><input class="input" id="lemail" type="email" autocomplete="username" required></div>
        <div><label class="f" for="lpw">Password</label><input class="input" id="lpw" type="password" autocomplete="current-password" required></div>
        <div class="err" id="lerr"></div>
        <button class="btn primary" type="submit">Sign in to review</button>
        ${S.demo ? `<div class="small muted">Demo logins (password <code>demo</code>):
          <div class="row" style="margin-top:6px;gap:6px"><button type="button" class="btn sm" data-demo="coordinator@demo">Coordinator</button>
          <button type="button" class="btn sm" data-demo="business@demo">Reviewer (Business)</button>
          <button type="button" class="btn sm" data-demo="pharmacy@demo">Reviewer (Pharmacy)</button></div></div>` : ''}
      </form>`;
  const unlocked = ss.get(MGMT_KEY) === '1';
  app.innerHTML = `<div class="wrap">
    <section class="hero">
      <div class="eyebrow">${esc(CFG.INSTITUTION || '')}</div>
      <h1 style="margin-top:8px">${esc(CFG.PROGRAM_NAME || 'Innovations with AI')} Grants Portal</h1>
      <p>${esc(CFG.PROGRAM_SUBTITLE || '')}</p>
    </section>
    <div class="portal-cards">
      <div class="card pcard">
        <div class="ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>
        <h2>Proposal Review</h2>
        <p>For the review committee. Read de-identified proposals and score them against the published rubric. Sign in with the email and password the coordinator sent you.</p>
        ${reviewCard}
      </div>
      <div class="card pcard mg">
        <div class="ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M8 15h3"/></svg></div>
        <h2>Grants Management</h2>
        <p>For the initiative coordinator. Awardee tracking, conditions of award, stipends and reporting. <span class="badge b-gold">In development</span></p>
        ${unlocked ? '<a class="btn gold" href="#/manage">Open grants management →</a>' : `
        <form id="mgmtForm">
          <div><label class="f" for="mpw">Management password</label><input class="input" id="mpw" type="password" autocomplete="off" required></div>
          <div class="err" id="merr"></div>
          <button class="btn gold" type="submit" ${S.api ? '' : 'disabled'}>Unlock</button>
          ${S.demo ? '<div class="small muted">Demo password: <code>demo</code></div>' : ''}
        </form>`}
      </div>
    </div>
    <div class="foot">
      Questions? <a href="mailto:${esc(CFG.CONTACT_EMAIL || '')}">${esc(CFG.CONTACT_EMAIL || '')}</a>
      ${S.demo ? ' · You are in the demo (sample data, stored only in this browser). <a href="' + location.pathname + '#/">Leave demo</a> · <button class="linkbtn" data-act="resetdemo">Reset demo data</button>'
        : S.api ? '' : ''}
    </div>
  </div>`;

  const lf = $('#loginForm');
  if (lf) lf.onsubmit = async e => {
    e.preventDefault();
    const btn = $('button[type=submit]', lf); btn.disabled = true; $('#lerr').textContent = '';
    try {
      S.me = await S.api.signIn($('#lemail').value, $('#lpw').value);
      S.loaded = false; go('review');
    } catch (err) { $('#lerr').textContent = err.message; }
    btn.disabled = false;
  };
  const mf = $('#mgmtForm');
  if (mf) mf.onsubmit = async e => {
    e.preventDefault(); $('#merr').textContent = '';
    try {
      if (await S.api.checkMgmtPassword($('#mpw').value)) { ss.set(MGMT_KEY, '1'); go('manage'); }
      else $('#merr').textContent = 'Incorrect password.';
    } catch (err) { $('#merr').textContent = err.message; }
  };
  app.onclick = async e => {
    const d = e.target.closest('[data-demo]');
    if (d) { $('#lemail').value = d.dataset.demo; $('#lpw').value = 'demo'; lf.requestSubmit(); }
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'signout') { await S.api.signOut(); S.me = null; S.loaded = false; render(); }
    if (a.dataset.act === 'resetdemo') { S.api.reset(); S.me = null; S.loaded = false; ss.del(MGMT_KEY); toast('Demo data reset'); render(); }
  };
  app.onchange = app.oninput = null;
}

// ====================================================================
// Grants Management (placeholder)
// ====================================================================
function viewManage() {
  if (ss.get(MGMT_KEY) !== '1') return go('');
  const mods = [
    ['Awardee roster', 'Funded projects, leads and co-leads, tier, college, and award amount, carried over from the review platform.'],
    ['Conditions of award', 'Per-awardee checklist: AI training series, pre/post assessment, Lightning Talks, Community of Practice, AI Ambassador.'],
    ['Budget & stipends', 'Non-stipend spending against budget; stipend release in early summer 2027 on completion of conditions.'],
    ['Assessment data', 'Pre/post Domain 1 results and additional-domain instruments for each project.'],
    ['Reports & repository', 'Final reports, revised syllabi and assignments, and deposit to the institutional repository.'],
    ['Donor impact report', 'Roll-up of students reached, proficiency gains and testimonials for the June 2027 report.']
  ];
  app.innerHTML = `<div class="wrap">
    <div class="pagehead"><div><div class="eyebrow">Placeholder</div><h1>Grants Management</h1>
      <p>This side of the portal is reserved for post-award management. Planned modules:</p></div></div>
    <div class="mods">${mods.map(m => `<div class="card mod"><h3>${esc(m[0])}</h3><p>${esc(m[1])}</p></div>`).join('')}</div>
  </div>`;
  app.onclick = app.onchange = app.oninput = null;
}

// ====================================================================
// Reviewer queue (also the coordinator's "My reviews" tab)
// ====================================================================
function queueHTML() {
  const list = released();
  const mine = list.map(p => ({ p, r: myReview(p.id) }));
  const nSub = mine.filter(x => x.r && x.r.status === 'submitted').length;
  const nRec = mine.filter(x => x.r && x.r.status === 'recused').length;
  const nDraft = mine.filter(x => x.r && x.r.status === 'draft').length;
  const todo = list.length - nRec;
  const pct = todo ? Math.round(100 * nSub / todo) : 0;
  const dl = deadlineStr();
  return `
    ${!reviewsOpen() ? '<div class="notice" style="margin-bottom:16px">Reviewing is currently <strong>closed</strong>. You can read proposals and your submitted scores, but not change them.</div>' : ''}
    <div class="kpis">
      <div class="kpi hl"><div class="v num">${nSub} <span class="muted" style="font-size:16px">of ${todo}</span></div><div class="l">Reviews submitted</div><div class="bar"><i style="width:${pct}%"></i></div></div>
      <div class="kpi"><div class="v num">${nDraft}</div><div class="l">In progress (drafts)</div></div>
      <div class="kpi"><div class="v num">${nRec}</div><div class="l">Recused (conflict of interest)</div></div>
      ${dl ? `<div class="kpi"><div class="v" style="font-size:18px;padding-top:4px">${esc(dl)}</div><div class="l">Reviews due</div></div>` : ''}
    </div>
    ${list.length ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Code</th><th>Proposal</th><th>Tier</th><th>Status</th><th class="r">Your score</th><th></th></tr></thead>
      <tbody>${mine.map(({ p, r }) => {
        const c = r ? calc(r) : null;
        const st = !r ? '<span class="badge b-plain">Not started</span>'
          : r.status === 'submitted' ? '<span class="badge b-ok">Submitted</span>'
          : r.status === 'recused' ? '<span class="badge b-plain">Recused</span>'
          : `<span class="badge b-draft">Draft · ${c.scored}/${R().criteria.length}</span>`;
        return `<tr class="click" data-open="${p.id}"><td class="num"><strong>${esc(p.code)}</strong></td><td>${esc(p.title)}</td><td>${tierChip(p.tier)}</td><td>${st}</td>
          <td class="r num">${r && r.status !== 'recused' && c.scored ? `<strong>${fmtInt(c.total)}</strong> <span class="muted">/ ${maxBase() + maxBonus()}</span>` : '<span class="muted">—</span>'}</td>
          <td class="r"><span class="btn sm">${!r || r.status === 'draft' ? (reviewsOpen() ? 'Score' : 'View') : 'View'} →</span></td></tr>`;
      }).join('')}</tbody></table></div>` : '<div class="card empty">No proposals have been released for review yet.</div>'}
    <div class="card pad" style="margin-top:20px">
      <h3 style="margin-bottom:8px">How scoring works</h3>
      <ul class="small" style="margin:0;padding-left:18px;color:var(--ink-2)">
        <li>Eight criteria are scored 0–4 and multiplied by their weight (max ${maxBase()}); up to ${maxBonus()} bonus points are available (max ${maxBase() + maxBonus()} total).</li>
        <li>Your scores are saved automatically as a draft. Nobody but the coordinator sees them, and other reviewers never do.</li>
        <li>When you <strong>submit</strong> a review it is locked. Ask the coordinator if you need to reopen it.</li>
        <li>If you can identify an author or have a personal or professional stake in a proposal, <strong>recuse yourself</strong> from it (RFP §9).</li>
        <li>Proposals are de-identified. Please don't try to identify authors or discuss proposals outside the committee.</li>
      </ul>
    </div>`;
}
function viewQueue() {
  app.innerHTML = `<div class="wrap">
    <div class="pagehead"><div><div class="eyebrow">Review committee</div><h1>Your review queue</h1>
    <p>${esc(S.me.display_name)}${S.me.unit ? ' · ' + esc(S.me.unit) : ''}</p></div>
    <button class="btn" data-act="refresh">Refresh</button></div>
    ${queueHTML()}</div>`;
  app.onclick = e => {
    const o = e.target.closest('[data-open]'); if (o) return go('review/p/' + o.dataset.open);
    if (e.target.closest('[data-act=refresh]')) refresh();
  };
  app.onchange = app.oninput = null;
}

// ====================================================================
// Scoring view
// ====================================================================
async function viewScore(pid) {
  const p = S.proposals.find(x => x.id === pid);
  if (!p || (!p.released && !isAdmin())) { app.innerHTML = '<div class="wrap"><div class="card empty">That proposal isn’t available.</div></div>'; return; }
  const existing = myReview(pid);
  const cur = existing ? JSON.parse(JSON.stringify(existing)) : {
    proposal_id: pid, reviewer_id: S.me.id, scores: {}, comments: {}, overall_comment: '', status: 'draft', coi_note: ''
  };
  cur.scores = cur.scores || {}; cur.comments = cur.comments || {};
  const rb = R();
  const list = released();
  const idx = list.findIndex(x => x.id === pid);
  const prev = idx > 0 ? list[idx - 1] : null, next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
  const back = isAdmin() ? (coordReviews() ? 'review/admin/mine' : 'review/admin/scores') : 'review';
  const canEdit = () => cur.status === 'draft' && (reviewsOpen() || isAdmin());
  const canUnrecuse = () => cur.status === 'recused' && (reviewsOpen() || isAdmin());

  // ---- saving ----
  let saveTimer = null, chain = Promise.resolve(true), dirty = false;
  const setSave = t => { const el = $('#saveState'); if (el) el.textContent = t; };
  function persist(statusOverride) {
    chain = chain.then(async () => {
      try {
        const body = JSON.parse(JSON.stringify(cur));
        if (statusOverride) body.status = statusOverride;
        const saved = await S.api.saveReview(body);
        cur.id = saved.id; cur.status = saved.status; cur.submitted_at = saved.submitted_at;
        const i = S.reviews.findIndex(r => r.id === saved.id);
        if (i >= 0) S.reviews[i] = saved; else S.reviews.push(saved);
        dirty = false; setSave('Saved ' + timeStr());
        return true;
      } catch (e) { setSave('Not saved'); toast(e.message, 'bad'); return false; }
    });
    return chain;
  }
  function schedule() {
    dirty = true; setSave('Saving…');
    clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveTimer = null; persist(); }, 700);
  }
  S.leaveHook = async () => { window.onbeforeunload = null; if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; await persist(); } else await chain; };
  window.onbeforeunload = () => (dirty ? true : undefined);

  // ---- rendering ----
  const levelsHTML = c => `<div class="levels">${rb.levels.map(l => {
    const on = cur.scores[c.key] === l.v;
    return `<button type="button" class="lvl ${on ? 'on' : ''} ${on && l.v === 0 ? 'zero' : ''}" data-lvl="${l.v}" data-key="${c.key}" ${canEdit() ? '' : 'disabled'} aria-pressed="${on}">
      <span class="lv-top"><span class="lv-n">${l.v}</span><span class="lv-l">${esc(l.label)}</span></span>
      <span class="lv-d">${esc((c.desc || {})[l.v] || '')}</span></button>`;
  }).join('')}</div>`;
  const critHTML = c => {
    const v = cur.scores[c.key];
    const cm = cur.comments[c.key] || '';
    return `<div class="crit ${isNum(v) ? 'done' : ''}" id="crit-${c.key}">
      <div class="crit-h"><h3>${esc(c.name)}</h3><div class="crit-meta"><span class="sec" title="Proposal section">§ ${esc(c.section || '')}</span><span class="wt" title="Weight">×${c.weight}</span></div></div>
      ${c.guidance ? `<div class="guid">${esc(c.guidance)}</div>` : ''}
      ${c.tiered ? `<div class="tierline">This is a <strong>${p.tier === 'midi' ? 'Midi' : 'Micro'}-Grant</strong> proposal: use the ${p.tier === 'midi' ? 'Midi' : 'Micro'} thresholds.</div>` : ''}
      ${levelsHTML(c)}
      <div class="crit-foot"><span class="small muted" data-cs="${c.key}">${isNum(v) ? `${v} × ${c.weight} = <strong>${v * c.weight}</strong> of ${4 * c.weight}` : 'Not yet scored'}</span>
        ${canEdit() || cm ? `<button type="button" class="linkbtn small" data-tcmt="${c.key}">${cm ? 'Comment' : '+ Add comment'}</button>` : ''}</div>
      <div class="cmt ${cm ? '' : 'hidden'}" id="cmt-${c.key}"><textarea class="input" rows="2" data-cmt="${c.key}" placeholder="Optional comment on this criterion" ${canEdit() ? '' : 'readonly'}>${esc(cm)}</textarea></div>
    </div>`;
  };
  const bonusHTML = () => `<div class="crit" id="bonusbox"><div class="crit-h"><h3>Bonus points</h3><span class="pts">up to +${maxBonus()}</span></div>
    ${rb.bonuses.map(b => `<label class="bonus-row check" style="display:flex">
      <input type="checkbox" data-bonus="${b.key}" ${cur.scores[b.key] ? 'checked' : ''} ${canEdit() ? '' : 'disabled'}>
      <span style="flex:1">${esc(b.name)} <span class="sec">§ ${esc(b.section || '')}</span></span><span class="pts">+${b.points}</span></label>`).join('')}
  </div>`;
  const footHTML = () => {
    const c = calc(cur);
    return `<div><div class="total-big num">${fmtInt(c.total)} <small>/ ${maxBase() + maxBonus()}</small></div>
      <div class="tiny muted num">Weighted ${fmtInt(c.base)}/${maxBase()} + bonus ${c.bonus} · ${c.scored} of ${rb.criteria.length} criteria scored</div></div>
      <span style="flex:1"></span><span class="savestate" id="saveState">${cur.id ? '' : 'Not started'}</span>
      ${canEdit() ? `<button class="btn primary" data-act="submit">Submit final review</button>` : ''}`;
  };
  function bodyHTML() {
    if (cur.status === 'recused') {
      return `<div class="lockbar recused"><strong>You recused yourself from this proposal.</strong>${cur.coi_note ? `<div class="small" style="margin-top:4px">Note: ${esc(cur.coi_note)}</div>` : ''}
        ${canUnrecuse() ? '<div style="margin-top:8px"><button class="btn sm" data-act="unrecuse">Undo recusal</button></div>' : ''}</div>`;
    }
    let top = '';
    if (cur.status === 'submitted') top = `<div class="lockbar"><strong>Submitted</strong>${cur.submitted_at ? ' on ' + esc(dateStr(cur.submitted_at)) : ''}. This review is locked; contact the coordinator to reopen it.</div>`;
    else if (!canEdit()) top = '<div class="lockbar closed">Reviewing is closed. Your draft is shown read-only.</div>';
    else top = `<div class="coi-box row between"><span>Conflict of interest? If you can identify an author or have a stake in this proposal, recuse yourself.</span><button class="btn sm" data-act="recuse">Recuse myself</button></div>`;
    return top + rb.criteria.map(critHTML).join('') + bonusHTML() + `
      <div class="crit"><div class="crit-h"><h3>Overall comments</h3></div>
      <textarea class="input" rows="4" data-overall placeholder="Strengths, weaknesses, and suggestions (optional)" ${canEdit() ? '' : 'readonly'} style="margin-top:8px">${esc(cur.overall_comment || '')}</textarea></div>`;
  }
  function paint() {
    $('#rubBody').innerHTML = bodyHTML();
    $('#rubFoot').innerHTML = cur.status === 'recused' ? '<span class="muted small">Recused — not scored.</span>' : footHTML();
  }
  function refreshCrit(key) {
    const c = rb.criteria.find(x => x.key === key); if (!c) return;
    const el = $('#crit-' + key); const v = cur.scores[key];
    el.classList.toggle('done', isNum(v)); el.classList.remove('needs');
    $$('.lvl', el).forEach(b => { const on = Number(b.dataset.lvl) === v; b.classList.toggle('on', on); b.classList.toggle('zero', on && v === 0); b.setAttribute('aria-pressed', on); });
    $(`[data-cs="${key}"]`, el).innerHTML = isNum(v) ? `${v} × ${c.weight} = <strong>${v * c.weight}</strong> of ${4 * c.weight}` : 'Not yet scored';
  }
  function refreshFoot() { const s = $('#saveState') ? $('#saveState').textContent : ''; $('#rubFoot').innerHTML = footHTML(); setSave(s); }

  document.body.style.overflow = window.innerWidth > 980 ? 'hidden' : '';
  app.innerHTML = `<div class="score-shell">
    <section class="pdf-pane"><div class="pbar"><span>${esc(p.code)} · ${esc(p.pdf_name || 'proposal.pdf')}</span><span style="flex:1"></span><a id="pdfOpen" href="#" target="_blank" rel="noopener" class="hidden">Open PDF ↗</a></div>
      <div class="pdf-empty" id="pdfSlot">Loading PDF…</div></section>
    <section class="rub-pane">
      <div class="rub-head">
        <div class="row between"><a href="#/${back}" class="small">← ${isAdmin() ? (coordReviews() ? 'My reviews' : 'Scores') : 'Review queue'}</a>
          <div class="row" style="gap:6px">${prev ? `<a class="btn sm" href="#/review/p/${prev.id}">← ${esc(prev.code)}</a>` : ''}${next ? `<a class="btn sm" href="#/review/p/${next.id}">${esc(next.code)} →</a>` : ''}</div></div>
        <div class="row" style="margin-top:8px;gap:8px"><h2 class="num">${esc(p.code)}</h2>${tierChip(p.tier)}</div>
        <div class="muted small" style="margin-top:2px">${esc(p.title)}</div>
      </div>
      <div class="rub-body" id="rubBody"></div>
      <div class="rub-foot" id="rubFoot"></div>
    </section></div>`;
  paint();

  S.api.pdfUrl(p).then(url => {
    const slot = $('#pdfSlot'); if (!slot) return;
    if (!url) { slot.textContent = 'No PDF has been uploaded for this proposal.'; return; }
    const f = document.createElement('iframe'); f.src = url + '#view=FitH'; f.title = 'Proposal PDF';
    slot.replaceWith(f);
    const o = $('#pdfOpen'); o.href = url; o.classList.remove('hidden');
  }).catch(e => { const slot = $('#pdfSlot'); if (slot) slot.textContent = 'Could not load the PDF: ' + e.message; });

  app.onclick = async e => {
    const lv = e.target.closest('[data-lvl]');
    if (lv && canEdit()) {
      const k = lv.dataset.key, v = Number(lv.dataset.lvl);
      cur.scores[k] = cur.scores[k] === v ? undefined : v;
      if (cur.scores[k] === undefined) delete cur.scores[k];
      refreshCrit(k); refreshFoot(); schedule(); return;
    }
    const tc = e.target.closest('[data-tcmt]');
    if (tc) { const box = $('#cmt-' + tc.dataset.tcmt); box.classList.toggle('hidden'); if (!box.classList.contains('hidden')) $('textarea', box).focus(); return; }
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'submit') {
      const missing = rb.criteria.filter(c => !isNum(cur.scores[c.key]));
      if (missing.length) {
        missing.forEach(c => $('#crit-' + c.key).classList.add('needs'));
        $('#crit-' + missing[0].key).scrollIntoView({ behavior: 'smooth', block: 'center' });
        toast(`Score all criteria before submitting (${missing.length} left).`, 'bad'); return;
      }
      const c = calc(cur);
      const ok = await confirmBox('Submit final review?', `Your total for <strong>${esc(p.code)}</strong> is <strong>${fmtInt(c.total)} / ${maxBase() + maxBonus()}</strong>. Once submitted, the review is locked unless the coordinator reopens it.`, 'Submit review');
      if (!ok) return;
      clearTimeout(saveTimer); saveTimer = null;
      if (await persist('submitted')) { toast('Review submitted', 'ok'); paint(); }
    }
    if (a.dataset.act === 'recuse') {
      const ok = await modal({
        title: 'Recuse yourself from ' + p.code + '?',
        body: `<p style="margin-top:0">You will not score this proposal, and it won't count toward its average. Any scores you've entered are kept but ignored.</p>
          <label class="f">Brief reason (visible only to the coordinator)</label><textarea class="input" id="coiNote" rows="3"></textarea>`,
        ok: 'Recuse', onOk: bg => { cur.coi_note = $('#coiNote', bg).value.trim(); }
      });
      if (!ok) return;
      clearTimeout(saveTimer); saveTimer = null;
      if (await persist('recused')) { toast('Recused'); paint(); }
    }
    if (a.dataset.act === 'unrecuse') {
      cur.coi_note = '';
      if (await persist('draft')) paint();
    }
  };
  app.oninput = e => {
    if (!canEdit()) return;
    const t = e.target;
    if (t.dataset.cmt) { if (t.value) cur.comments[t.dataset.cmt] = t.value; else delete cur.comments[t.dataset.cmt]; schedule(); }
    if (t.hasAttribute('data-overall')) { cur.overall_comment = t.value; schedule(); }
  };
  app.onchange = e => {
    const t = e.target;
    if (t.dataset.bonus && canEdit()) {
      const b = rb.bonuses.find(x => x.key === t.dataset.bonus);
      if (t.checked) cur.scores[b.key] = Number(b.points); else delete cur.scores[b.key];
      refreshFoot(); schedule();
    }
  };
}

// ====================================================================
// Coordinator shell
// ====================================================================
const TABS = [['scores', 'Scores'], ['proposals', 'Proposals'], ['reviewers', 'Reviewers'], ['funding', 'Funding planner'], ['mine', 'My reviews'], ['settings', 'Settings']];
function adminShell(tab, inner, extraHead = '') {
  const counts = { proposals: S.proposals.length, reviewers: members().length };
  return `<div class="wrap">
    <div class="pagehead"><div><div class="eyebrow">Coordinator</div><h1>Proposal Review</h1>
    <p>${released().length} of ${S.proposals.length} proposals released · ${members().length} active reviewers · reviewing ${reviewsOpen() ? '<span class="badge b-ok">open</span>' : '<span class="badge b-plain">closed</span>'}${deadlineStr() ? ' · due ' + esc(deadlineStr()) : ''}</p></div>
    <div class="row noprint">${extraHead}<button class="btn" data-act="refresh">Refresh</button></div></div>
    <nav class="tabs">${TABS.filter(([k]) => k !== 'mine' || coordReviews()).map(([k, l]) => `<a class="tab ${k === tab ? 'on' : ''}" href="#/review/admin/${k}">${l}${counts[k] != null ? `<span class="count">${counts[k]}</span>` : ''}</a>`).join('')}</nav>
    ${inner}</div>`;
}
function viewAdmin(tab) {
  const views = { scores: tabScores, proposals: tabProposals, reviewers: tabReviewers, funding: tabFunding, mine: tabMine, settings: tabSettings };
  (tab === 'mine' && !coordReviews() ? tabScores : (views[tab] || tabScores))();
}
function commonClicks(e) {
  if (e.target.closest('[data-act=refresh]')) { refresh(); return true; }
  return false;
}

// ---------------- Scores ----------------
function reviewerCols() {
  const ids = new Set(S.reviews.map(r => r.reviewer_id));
  return S.profiles.filter(p => isReviewing(p) || ids.has(p.id))
    .sort((a, b) => (a.role === 'admin') - (b.role === 'admin') || (a.unit || '').localeCompare(b.unit || '') || a.display_name.localeCompare(b.display_name));
}
const shortName = p => { const parts = (p.display_name || p.email).split(/\s+/); return parts.length > 1 ? parts[0][0] + '. ' + parts[parts.length - 1] : parts[0]; };
function cellFor(pid, uid) {
  const r = S.reviews.find(x => x.proposal_id === pid && x.reviewer_id === uid);
  if (!r) return '<span class="cell-none">—</span>';
  if (r.status === 'recused') return '<span class="cell-coi" title="Recused (conflict of interest)">COI</span>';
  const c = calc(r);
  if (r.status === 'draft') return c.scored ? `<span class="cell-draft num" title="Draft — not counted">${fmtInt(c.total)}</span>` : '<span class="cell-draft" title="Opened, not scored">·</span>';
  return `<span class="cell-sub num">${fmtInt(c.total)}</span>`;
}
function sortedProposals(list, mode) {
  const withSt = list.map(p => ({ p, st: stats(p.id) }));
  if (mode === 'code') withSt.sort((a, b) => a.p.code.localeCompare(b.p.code, undefined, { numeric: true }));
  else withSt.sort((a, b) => (b.st.mean == null ? -1 : b.st.mean) - (a.st.mean == null ? -1 : a.st.mean) || a.p.code.localeCompare(b.p.code, undefined, { numeric: true }));
  return withSt;
}
function tabScores() {
  const cols = reviewerCols();
  const rel = released();
  const act = members();
  let expected = 0, subCount = 0, draftCount = 0;
  rel.forEach(p => {
    const rs = S.reviews.filter(r => r.proposal_id === p.id);
    const rec = rs.filter(r => r.status === 'recused' && act.some(m => m.id === r.reviewer_id)).length;
    expected += act.length - rec;
    subCount += rs.filter(r => r.status === 'submitted').length;
    draftCount += rs.filter(r => r.status === 'draft').length;
  });
  const rows = sortedProposals(S.proposals, S.scoreSort);
  const above = rows.filter(x => x.st.status === 'above');
  const inner = `
    <div class="kpis">
      <div class="kpi hl"><div class="v num">${subCount} <span class="muted" style="font-size:16px">of ${expected}</span></div><div class="l">Reviews submitted</div><div class="bar"><i style="width:${expected ? Math.round(100 * subCount / expected) : 0}%"></i></div></div>
      <div class="kpi"><div class="v num">${draftCount}</div><div class="l">Drafts in progress</div></div>
      <div class="kpi"><div class="v num">${above.length}</div><div class="l">At or above threshold (≥ ${threshold()}${thrIncludesBonus() ? '' : ', excl. bonus'})</div></div>
      <div class="kpi"><div class="v num">${money(above.reduce((a, x) => a + Number(pa(x.p.id).requested || 0), 0))}</div><div class="l">Requested by those proposals · cap ${money(budgetCap())}</div></div>
    </div>
    <div class="row between noprint" style="margin-bottom:10px">
      <div class="row small"><label class="f" style="margin:0">Sort</label>
        <select class="input sm" data-scoresort style="width:auto"><option value="mean" ${S.scoreSort === 'mean' ? 'selected' : ''}>Mean score (high → low)</option><option value="code" ${S.scoreSort === 'code' ? 'selected' : ''}>Proposal code</option></select></div>
      <div class="row"><button class="btn sm" data-act="exp-long">Export all scores (CSV)</button><button class="btn sm" data-act="exp-sum">Export summary (CSV)</button><button class="btn sm" data-act="print">Print</button></div>
    </div>
    ${S.proposals.length ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Code</th><th>Proposal</th>${cols.map(c => `<th class="c" title="${esc(c.display_name)} — ${esc(c.unit || '')}">${esc(shortName(c))}<div class="unit-l">${esc(c.unit || (c.role === 'admin' ? 'Coordinator' : ''))}</div></th>`).join('')}
        <th class="c">n</th><th class="c mean-col">Mean</th><th class="c">SD</th><th class="c">Range</th><th style="min-width:150px">Status</th></tr></thead>
      <tbody>${rows.map(({ p, st }) => `<tr class="click ${st.status === 'below' || st.status === 'gate' ? 'below' : ''}" data-detail="${p.id}">
        <td class="num"><strong>${esc(p.code)}</strong>${p.released ? '' : '<div class="tiny muted">unreleased</div>'}</td>
        <td style="min-width:200px;max-width:300px"><div>${esc(p.title)}</div><div class="row tiny muted" style="gap:6px;margin-top:2px">${tierChip(p.tier)} ${esc(pa(p.id).college || '')}</div></td>
        ${cols.map(c => `<td class="c">${cellFor(p.id, c.id)}</td>`).join('')}
        <td class="c num">${st.n}</td>
        <td class="c mean-col">${st.n ? `<span class="meanpill num">${fmt1(st.mean)}</span>` : '<span class="muted">—</span>'}</td>
        <td class="c num ${st.sd != null && st.sd >= 5 ? 'hot' : ''}">${fmt1(st.sd)}</td>
        <td class="c num small">${st.n ? `${fmtInt(st.min)}–${fmtInt(st.max)}` : '—'}</td>
        <td>${statusBadge(st)}${st.compZeroAny && st.status !== 'gate' ? '<div style="margin-top:3px"><span class="badge b-warn" title="At least one reviewer scored Competency 0">⚠ Competency 0</span></div>' : ''}
          ${st.disagreements.length ? `<div style="margin-top:3px"><span class="badge b-gold" title="${esc(st.disagreements.map(c => c.name).join('; '))}">${st.disagreements.length} split criteri${st.disagreements.length === 1 ? 'on' : 'a'}</span></div>` : ''}</td>
      </tr>`).join('')}</tbody></table></div>
      <p class="small muted" style="margin-top:10px">Bold = submitted · <span class="cell-draft">italic</span> = draft (not counted) · <span class="cell-coi">COI</span> = recused · — = not started. Mean, SD (sample) and range use submitted reviews only. SD cells of 5+ points are highlighted; "split criteria" have a reviewer SD ≥ ${disagreeSD()} on the 0–4 scale. Max ${maxBase() + maxBonus()}.</p>`
      : '<div class="card empty">No proposals yet. Upload them on the Proposals tab.</div>'}`;
  app.innerHTML = adminShell('scores', inner);
  app.onclick = e => {
    if (commonClicks(e)) return;
    const d = e.target.closest('[data-detail]'); if (d) return go('review/admin/proposal/' + d.dataset.detail);
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'exp-long') exportLong();
    if (a.dataset.act === 'exp-sum') exportSummary();
    if (a.dataset.act === 'print') window.print();
  };
  app.onchange = e => { if (e.target.dataset.scoresort !== undefined) { S.scoreSort = e.target.value; tabScores(); } };
  app.oninput = null;
}

// ---------------- Proposal detail ----------------
function viewDetail(pid) {
  const p = S.proposals.find(x => x.id === pid);
  if (!p) { app.innerHTML = adminShell('scores', '<div class="card empty">Proposal not found.</div>'); return; }
  const st = stats(pid);
  const a = pa(pid);
  const cols = reviewerCols().filter(c => isReviewing(c) || S.reviews.some(r => r.proposal_id === pid && r.reviewer_id === c.id));
  const rb = R();
  const rv = uid => S.reviews.find(r => r.proposal_id === pid && r.reviewer_id === uid);
  const order = sortedProposals(S.proposals, S.scoreSort).map(x => x.p);
  const i = order.findIndex(x => x.id === pid);
  const prev = order[i - 1], next = order[i + 1];
  const cellScore = (r, key) => {
    if (!r || r.status === 'recused') return '<span class="cell-none">·</span>';
    const v = (r.scores || {})[key];
    if (!isNum(v)) return '<span class="cell-none">—</span>';
    return r.status === 'draft' ? `<span class="cell-draft num">${v}</span>` : `<span class="cell-sub num">${v}</span>`;
  };
  const statusCell = c => {
    const r = rv(c.id);
    if (!r) return `<span class="badge b-plain">Not started</span><div style="margin-top:4px"><button class="btn sm" data-rv="coi" data-uid="${c.id}">Mark COI</button></div>`;
    if (r.status === 'submitted') return `<span class="badge b-ok">Submitted</span><div style="margin-top:4px"><button class="btn sm" data-rv="reopen" data-id="${r.id}">Reopen</button></div>`;
    if (r.status === 'recused') return `<span class="badge b-plain" title="${esc(r.coi_note || '')}">Recused</span><div style="margin-top:4px"><button class="btn sm" data-rv="uncoi" data-id="${r.id}">Clear COI</button></div>`;
    return `<span class="badge b-draft">Draft</span><div style="margin-top:4px"><button class="btn sm" data-rv="coi" data-uid="${c.id}">Mark COI</button></div>`;
  };
  const table = `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th style="min-width:260px">Criterion</th><th class="c">Wt</th>${cols.map(c => `<th class="c" title="${esc(c.display_name)}">${esc(shortName(c))}<div class="unit-l">${esc(c.unit || '')}</div></th>`).join('')}<th class="c mean-col">Mean</th><th class="c">SD</th></tr></thead>
    <tbody>
    ${rb.criteria.map(c => { const s = st.crit[c.key]; const hot = s.sd != null && s.sd >= disagreeSD();
      return `<tr><td>${esc(c.name)}${c.gate ? ' <span class="badge b-navy" title="A mean of 0 here makes the proposal ineligible">gate</span>' : ''}</td><td class="c num">×${c.weight}</td>
      ${cols.map(u => `<td class="c ${hot ? 'hot' : ''}">${cellScore(rv(u.id), c.key)}</td>`).join('')}
      <td class="c mean-col num"><strong>${fmt1(s.mean)}</strong></td><td class="c num ${hot ? 'hot' : ''}">${fmt1(s.sd)}</td></tr>`; }).join('')}
    ${rb.bonuses.map(b => { const s = st.crit[b.key]; const bvals = st.subs.map(r => (r.scores || {})[b.key] ? Number(b.points) : 0);
      return `<tr><td><span class="pts">+${b.points}</span> ${esc(b.name)}</td><td class="c muted">bonus</td>
      ${cols.map(u => { const r = rv(u.id); if (!r || r.status === 'recused') return '<td class="c"><span class="cell-none">·</span></td>'; const v = (r.scores || {})[b.key]; return `<td class="c ${r.status === 'draft' ? 'cell-draft' : ''}">${v ? '+' + b.points : '<span class="cell-none">0</span>'}</td>`; }).join('')}
      <td class="c mean-col num">${fmt1(mean(bvals))}</td><td class="c num">${fmt1(sd(bvals))}</td></tr>`; }).join('')}
    <tr><td><strong>Weighted total</strong> <span class="muted small">(max ${maxBase() + maxBonus()})</span></td><td></td>
      ${cols.map(u => { const r = rv(u.id); if (!r || r.status === 'recused') return '<td class="c"><span class="cell-none">·</span></td>'; const c = calc(r); return `<td class="c">${r.status === 'draft' ? `<span class="cell-draft num">${fmtInt(c.total)}</span>` : `<strong class="num">${fmtInt(c.total)}</strong>`}</td>`; }).join('')}
      <td class="c mean-col"><span class="meanpill num">${fmt1(st.mean)}</span></td><td class="c num"><strong>${fmt1(st.sd)}</strong></td></tr>
    <tr class="noprint"><td class="muted small">Review status</td><td></td>${cols.map(c => `<td class="c">${statusCell(c)}</td>`).join('')}<td class="mean-col"></td><td></td></tr>
    </tbody></table></div>`;
  const comments = cols.map(c => {
    const r = rv(c.id); if (!r) return '';
    const items = rb.criteria.filter(k => (r.comments || {})[k.key]).map(k => `<li><strong>${esc(k.name)}:</strong> ${esc(r.comments[k.key])}</li>`).join('');
    if (!items && !r.overall_comment && !r.coi_note) return '';
    return `<div class="cmt-block"><div class="who">${esc(c.display_name)} <span class="muted small">· ${esc(c.unit || '')} · ${r.status}</span></div>
      ${r.coi_note ? `<div class="small"><em>COI note:</em> ${esc(r.coi_note)}</div>` : ''}
      ${r.overall_comment ? `<p style="margin:6px 0 0">${esc(r.overall_comment)}</p>` : ''}${items ? `<ul>${items}</ul>` : ''}</div>`;
  }).join('');
  const inner = `
    <div class="row between noprint" style="margin-bottom:14px"><a href="#/review/admin/scores">← All scores</a>
      <div class="row" style="gap:6px">${prev ? `<a class="btn sm" href="#/review/admin/proposal/${prev.id}">← ${esc(prev.code)}</a>` : ''}${next ? `<a class="btn sm" href="#/review/admin/proposal/${next.id}">${esc(next.code)} →</a>` : ''}</div></div>
    <div class="row" style="gap:10px;margin-bottom:4px"><h2 class="num">${esc(p.code)}</h2>${tierChip(p.tier)}${statusBadge(st)}${p.released ? '' : '<span class="badge b-warn">Not released</span>'}</div>
    <div style="font-size:16px;margin-bottom:4px">${esc(p.title)}</div>
    <div class="muted small" style="margin-bottom:18px">${esc(a.college || 'College not set')} · requested ${money(a.requested)} · <button class="linkbtn" data-act="pdf">Open PDF ↗</button></div>
    <div class="kpis" style="grid-template-columns:minmax(220px,1fr) minmax(260px,1.4fr)">
        <div class="kpi hl"><div class="l">Mean total (submitted)</div><div class="v num">${fmt1(st.mean)} <span class="muted" style="font-size:15px">/ ${maxBase() + maxBonus()}</span></div>
          <div class="small muted num" style="margin-top:4px">SD ${fmt1(st.sd)} · range ${st.n ? fmtInt(st.min) + '–' + fmtInt(st.max) : '—'} · n = ${st.n}${st.drafts.length ? ` · ${st.drafts.length} draft` : ''}${st.recused.length ? ` · ${st.recused.length} recused` : ''}</div>
          <div class="small muted num">Mean excluding bonus: ${fmt1(st.meanBase)} / ${maxBase()}</div></div>
        <div class="kpi small">
          <div><strong>Threshold:</strong> ${thrIncludesBonus() ? 'mean total' : 'mean excluding bonus'} ≥ ${threshold()}, and Competency mean &gt; 0.</div>
          ${st.compZeroAny ? '<div style="margin-top:6px" class="badge b-warn">⚠ At least one reviewer scored Competency 0</div>' : ''}
          ${st.disagreements.length ? `<div style="margin-top:8px"><strong>Split criteria</strong> (SD ≥ ${disagreeSD()}):<ul style="margin:4px 0 0;padding-left:18px">${st.disagreements.map(c => `<li>${esc(c.name)} (SD ${fmt1(st.crit[c.key].sd)})</li>`).join('')}</ul></div>` : ''}
        </div>
    </div>
    ${table}
    <div class="detail-grid" style="margin-top:18px">
      <div class="card pad"><h3 style="margin-bottom:8px">Reviewer comments</h3>${comments || '<p class="muted small" style="margin:0">No comments yet.</p>'}</div>
      <div class="card pad"><label class="f">Coordinator notes (private)</label><textarea class="input" rows="6" data-notes>${esc(a.notes || '')}</textarea></div>
    </div>`;
  app.innerHTML = adminShell('scores', inner);
  app.onclick = async e => {
    if (commonClicks(e)) return;
    const b = e.target.closest('[data-rv]');
    if (b) {
      try {
        if (b.dataset.rv === 'reopen') { if (!await confirmBox('Reopen review?', 'The reviewer will be able to edit and resubmit it. It will not count toward the mean until resubmitted.', 'Reopen')) return; await S.api.adminUpdateReview(b.dataset.id, { status: 'draft' }); }
        if (b.dataset.rv === 'uncoi') await S.api.adminUpdateReview(b.dataset.id, { status: 'draft', coi_note: '' });
        if (b.dataset.rv === 'coi') {
          const ok = await modal({ title: 'Mark reviewer as recused?', body: '<label class="f">Reason (optional)</label><textarea class="input" id="cn" rows="2"></textarea>', ok: 'Mark recused',
            onOk: async bg => { await S.api.adminUpsertReview({ proposal_id: pid, reviewer_id: b.dataset.uid, status: 'recused', coi_note: $('#cn', bg).value.trim() }); } });
          if (!ok) return;
        }
        S.reviews = await S.api.listReviews(); viewDetail(pid); toast('Updated', 'ok');
      } catch (err) { toast(err.message, 'bad'); }
      return;
    }
    if (e.target.closest('[data-act=pdf]')) { const w = window.open('', '_blank'); try { const u = await S.api.pdfUrl(p); if (u) w.location = u; else { w.close(); toast('No PDF uploaded.', 'bad'); } } catch (err) { w.close(); toast(err.message, 'bad'); } }
  };
  app.onchange = async e => {
    if (e.target.hasAttribute('data-notes')) {
      try { await S.api.updateProposalAdmin(pid, { notes: e.target.value }); S.padmin[pid] = { ...pa(pid), notes: e.target.value }; toast('Notes saved', 'ok'); }
      catch (err) { toast(err.message, 'bad'); }
    }
  };
  app.oninput = null;
}

// ---------------- Proposals ----------------
let staged = [];
function nextCode(offset = 0) {
  const nums = S.proposals.map(p => parseInt(String(p.code).replace(/\D+/g, ''), 10)).filter(n => !isNaN(n));
  staged.forEach(s => { const n = parseInt(String(s.code).replace(/\D+/g, ''), 10); if (!isNaN(n)) nums.push(n); });
  const n = (nums.length ? Math.max(...nums) : 0) + 1 + offset;
  return 'P-' + String(n).padStart(2, '0');
}
const collegeOptions = sel => ['<option value="">—</option>'].concat(colleges().map(c => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`))
  .concat(sel && !colleges().includes(sel) ? [`<option selected>${esc(sel)}</option>`] : []).join('');

function tabProposals() {
  const rows = S.proposals.slice().sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const inner = `
    <div class="card pad" style="margin-bottom:20px">
      <div class="row between"><h3>Upload de-identified proposals</h3><span class="small muted">PDF only · you can drop several at once</span></div>
      <p class="small muted" style="margin:6px 0 12px">Before uploading, check that the cover sheet is removed and names, departments and identifying course numbers are gone. Reviewers see the code, title, tier and PDF only; college and requested amount stay with you.</p>
      <div class="drop" id="drop"><strong>Drop PDFs here</strong> or click to choose files<input type="file" id="fileIn" accept="application/pdf,.pdf" multiple class="hidden"></div>
      ${staged.length ? `<div class="tbl-wrap" style="margin-top:14px"><table class="tbl staged">
        <thead><tr><th>File</th><th>Code</th><th>Short title (de-identified)</th><th>Tier</th><th>College (hidden)</th><th>Requested $</th><th>Release now</th><th></th></tr></thead>
        <tbody>${staged.map((s, i) => `<tr>
          <td class="small" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s.file.name)}">${esc(s.file.name)}</td>
          <td><input class="input sm" style="width:80px" data-st="code" data-i="${i}" value="${esc(s.code)}"></td>
          <td><input class="input sm" style="min-width:220px" data-st="title" data-i="${i}" value="${esc(s.title)}"></td>
          <td><select class="input sm" data-st="tier" data-i="${i}"><option value="micro" ${s.tier === 'micro' ? 'selected' : ''}>Micro</option><option value="midi" ${s.tier === 'midi' ? 'selected' : ''}>Midi</option></select></td>
          <td><select class="input sm" data-st="college" data-i="${i}">${collegeOptions(s.college)}</select></td>
          <td><input class="input sm num" style="width:90px" type="number" min="0" step="50" data-st="requested" data-i="${i}" value="${esc(s.requested)}"></td>
          <td class="c"><input type="checkbox" data-st="released" data-i="${i}" ${s.released ? 'checked' : ''}></td>
          <td><button class="btn sm ghost" data-unstage="${i}" title="Remove">✕</button></td></tr>`).join('')}</tbody></table></div>
        <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn" data-act="clearstage">Clear</button><button class="btn primary" data-act="upload">Upload ${staged.length} proposal${staged.length === 1 ? '' : 's'}</button></div>` : ''}
    </div>
    <div class="row between" style="margin-bottom:10px"><h3>All proposals</h3>
      <div class="row"><button class="btn sm" data-act="relall">Release all</button><button class="btn sm" data-act="unrelall">Unrelease all</button></div></div>
    ${rows.length ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Code</th><th>Short title</th><th>Tier</th><th>College <span title="Hidden from reviewers">🔒</span></th><th>Requested <span title="Hidden from reviewers">🔒</span></th><th class="c">Released</th><th>PDF</th><th class="c">Reviews</th><th></th></tr></thead>
      <tbody>${rows.map(p => { const st = stats(p.id); const A = pa(p.id); return `<tr>
        <td><input class="input sm" style="width:80px" data-pf="code" data-id="${p.id}" value="${esc(p.code)}"></td>
        <td><input class="input sm" style="min-width:240px" data-pf="title" data-id="${p.id}" value="${esc(p.title)}"></td>
        <td><select class="input sm" data-pf="tier" data-id="${p.id}"><option value="micro" ${p.tier === 'micro' ? 'selected' : ''}>Micro</option><option value="midi" ${p.tier === 'midi' ? 'selected' : ''}>Midi</option></select></td>
        <td><select class="input sm" data-af="college" data-id="${p.id}">${collegeOptions(A.college)}</select></td>
        <td><input class="input sm num" style="width:90px" type="number" min="0" step="50" data-af="requested" data-id="${p.id}" value="${esc(A.requested || 0)}"></td>
        <td class="c"><label class="switch"><input type="checkbox" data-pf="released" data-id="${p.id}" ${p.released ? 'checked' : ''}><span></span></label></td>
        <td class="small">${p.pdf_path ? `<button class="linkbtn" data-view="${p.id}">View</button> · ` : '<span class="badge b-warn">none</span> '}<button class="linkbtn" data-replace="${p.id}">${p.pdf_path ? 'Replace' : 'Upload'}</button></td>
        <td class="c num small">${st.n}${st.drafts.length ? ` <span class="muted">+${st.drafts.length}d</span>` : ''}</td>
        <td class="r"><button class="btn sm danger" data-del="${p.id}">Delete</button></td></tr>`; }).join('')}</tbody></table></div>`
      : '<div class="card empty">No proposals yet.</div>'}
    <input type="file" id="replaceIn" accept="application/pdf,.pdf" class="hidden">`;
  app.innerHTML = adminShell('proposals', inner);

  const drop = $('#drop'), fileIn = $('#fileIn');
  const addFiles = files => {
    const pdfs = Array.from(files).filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (pdfs.length < files.length) toast('Only PDF files were added.', 'bad');
    pdfs.forEach(f => {
      staged.push({ file: f, code: nextCode(), title: f.name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim(), tier: /midi/i.test(f.name) ? 'midi' : 'micro', college: '', requested: '', released: false });
    });
    tabProposals();
  };
  drop.onclick = () => fileIn.click();
  fileIn.onchange = () => addFiles(fileIn.files);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); };

  let replaceTarget = null;
  $('#replaceIn').onchange = async ev => {
    const f = ev.target.files[0]; if (!f || !replaceTarget) return;
    try { const row = await S.api.replacePdf(replaceTarget, f); Object.assign(S.proposals.find(x => x.id === row.id), row); toast('PDF updated', 'ok'); tabProposals(); }
    catch (err) { toast(err.message, 'bad'); }
  };

  app.onclick = async e => {
    if (commonClicks(e)) return;
    const t = e.target;
    const un = t.closest('[data-unstage]'); if (un) { staged.splice(Number(un.dataset.unstage), 1); return tabProposals(); }
    const v = t.closest('[data-view]'); if (v) { const p = S.proposals.find(x => x.id === v.dataset.view); const w = window.open('', '_blank'); try { w.location = await S.api.pdfUrl(p); } catch (err) { w.close(); toast(err.message, 'bad'); } return; }
    const rp = t.closest('[data-replace]'); if (rp) { replaceTarget = S.proposals.find(x => x.id === rp.dataset.replace); $('#replaceIn').value = ''; $('#replaceIn').click(); return; }
    const d = t.closest('[data-del]');
    if (d) {
      const p = S.proposals.find(x => x.id === d.dataset.del);
      const n = S.reviews.filter(r => r.proposal_id === p.id).length;
      if (!await confirmBox('Delete ' + p.code + '?', `This permanently deletes the proposal, its PDF${n ? ` and <strong>${n} review${n === 1 ? '' : 's'}</strong>` : ''}. This cannot be undone.`, 'Delete', true)) return;
      try { await S.api.deleteProposal(p); S.proposals = S.proposals.filter(x => x.id !== p.id); S.reviews = S.reviews.filter(r => r.proposal_id !== p.id); delete S.padmin[p.id]; toast('Deleted'); tabProposals(); }
      catch (err) { toast(err.message, 'bad'); }
      return;
    }
    const a = t.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'clearstage') { staged = []; tabProposals(); }
    if (a.dataset.act === 'upload') {
      const codes = staged.map(s => s.code.trim());
      if (codes.some(c => !c)) return toast('Every proposal needs a code.', 'bad');
      if (new Set(codes).size !== codes.length || codes.some(c => S.proposals.some(p => p.code === c))) return toast('Codes must be unique.', 'bad');
      a.disabled = true; a.textContent = 'Uploading…';
      const failed = [];
      for (const s of staged.slice()) {
        try {
          const row = await S.api.createProposal({ code: s.code.trim(), title: s.title.trim(), tier: s.tier, released: s.released }, s.file,
            { college: s.college, requested: Number(s.requested || 0) });
          S.proposals.push(row); S.padmin[row.id] = { ...pa(row.id), college: s.college, requested: Number(s.requested || 0) };
          staged.splice(staged.indexOf(s), 1);
        } catch (err) { failed.push(s.code + ': ' + err.message); }
      }
      if (failed.length) toast('Some uploads failed — ' + failed.join(' | '), 'bad'); else toast('Uploaded', 'ok');
      tabProposals();
    }
    if (a.dataset.act === 'relall' || a.dataset.act === 'unrelall') {
      const val = a.dataset.act === 'relall';
      if (val && S.proposals.some(p => !p.pdf_path) && !await confirmBox('Some proposals have no PDF', 'Release them anyway?', 'Release all')) return;
      try { for (const p of S.proposals.filter(x => x.released !== val)) { await S.api.updateProposal(p.id, { released: val }); p.released = val; } toast(val ? 'All released' : 'All unreleased', 'ok'); tabProposals(); }
      catch (err) { toast(err.message, 'bad'); }
    }
  };
  app.onchange = async e => {
    const t = e.target;
    if (t.dataset.st) {
      const s = staged[Number(t.dataset.i)];
      s[t.dataset.st] = t.type === 'checkbox' ? t.checked : t.value; return;
    }
    const id = t.dataset.id; if (!id) return;
    try {
      if (t.dataset.pf) {
        const f = t.dataset.pf; let v = t.type === 'checkbox' ? t.checked : t.value.trim();
        if (f === 'code' && !v) { toast('Code cannot be blank', 'bad'); return tabProposals(); }
        const row = await S.api.updateProposal(id, { [f]: v });
        Object.assign(S.proposals.find(x => x.id === id), row);
        toast(f === 'released' ? (v ? 'Released to reviewers' : 'Hidden from reviewers') : 'Saved', 'ok');
        if (f === 'released') tabProposals();
      } else if (t.dataset.af) {
        const f = t.dataset.af; const v = f === 'requested' ? Number(t.value || 0) : t.value;
        await S.api.updateProposalAdmin(id, { [f]: v }); S.padmin[id] = { ...pa(id), [f]: v }; toast('Saved', 'ok');
      }
    } catch (err) { toast(err.message, 'bad'); tabProposals(); }
  };
  app.oninput = null;
}

// ---------------- Reviewers ----------------
function loginMessage(p, pw) {
  const url = location.href.split('#')[0].replace(/\?demo\b/, '');
  return `You've been set up as a reviewer for the ${CFG.PROGRAM_NAME || 'Innovations with AI'} grant proposals.

Portal: ${url}
Email: ${p.email}
Temporary password: ${pw || '(the coordinator will send this separately)'}

Choose "Proposal Review", sign in, and use the Password button (top right) to set your own password. Please score only the proposals in your queue, and recuse yourself from any proposal where you have a conflict of interest.${deadlineStr() ? `\n\nReviews are due ${deadlineStr()}.` : ''}

Questions: ${CFG.CONTACT_EMAIL || ''}`;
}
function showCredentials(p, pw, title) {
  modal({
    title, wide: true, ok: 'Done', cancel: null,
    body: `<p class="small muted" style="margin-top:0">Copy this message and send it to ${esc(p.display_name)}. The password is not shown again.</p>
      <div class="codebox" id="credbox">${esc(loginMessage(p, pw))}</div>
      <div style="margin-top:10px"><button class="btn" data-copy="#credbox">Copy message</button></div>`
  });
}
function tabReviewers() {
  const rel = released();
  const rows = S.profiles.slice().sort((a, b) => (b.active - a.active) || (a.role === 'admin') - (b.role === 'admin') || a.display_name.localeCompare(b.display_name));
  const unitOpts = sel => colleges().map(c => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('') + (sel && !colleges().includes(sel) ? `<option selected>${esc(sel)}</option>` : '') + `<option value="" ${!sel ? 'selected' : ''}>—</option>`;
  const inner = `
    <div class="card pad" style="margin-bottom:20px">
      <h3 style="margin-bottom:12px">Add a reviewer</h3>
      <form id="addRev" class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));align-items:end">
        <div><label class="f">Full name</label><input class="input" name="name" required></div>
        <div><label class="f">Email (their login)</label><input class="input" name="email" type="email" required></div>
        <div><label class="f">College / school represented</label><select class="input" name="unit">${unitOpts('')}</select></div>
        <div><label class="f">Role</label><select class="input" name="role"><option value="reviewer">Reviewer</option><option value="admin">Coordinator (full access)</option></select></div>
        <div><label class="f">Temporary password</label><div class="row" style="gap:6px;flex-wrap:nowrap"><input class="input" name="pw" value="${genPassword()}" required minlength="8"><button type="button" class="btn sm" data-act="gen" title="Generate">↻</button></div></div>
        <div><button class="btn primary" type="submit" style="width:100%">Create login</button></div>
      </form>
      <p class="small muted" style="margin:10px 0 0">RFP §9: one representative from each college/school, with the coordinator representing Arts and Sciences. Review committee members may not apply for a grant.</p>
    </div>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Name</th><th>Email</th><th>Represents</th><th>Role</th><th class="c">Active</th><th>Progress</th><th class="c">Recused</th><th></th></tr></thead>
      <tbody>${rows.map(p => {
        const rs = S.reviews.filter(r => r.reviewer_id === p.id && rel.some(x => x.id === r.proposal_id));
        const sub = rs.filter(r => r.status === 'submitted').length, rec = rs.filter(r => r.status === 'recused').length;
        const todo = rel.length - rec; const pct = todo ? Math.round(100 * sub / todo) : 0;
        const self = p.id === S.me.id;
        return `<tr ${p.active ? '' : 'class="below"'}>
          <td><input class="input sm" data-pr="display_name" data-id="${p.id}" value="${esc(p.display_name)}" style="min-width:150px"></td>
          <td class="small">${esc(p.email)}</td>
          <td><select class="input sm" data-pr="unit" data-id="${p.id}">${unitOpts(p.unit)}</select></td>
          <td><select class="input sm" data-pr="role" data-id="${p.id}" ${self ? 'disabled title="You can’t change your own role"' : ''}><option value="reviewer" ${p.role === 'reviewer' ? 'selected' : ''}>Reviewer</option><option value="admin" ${p.role === 'admin' ? 'selected' : ''}>Coordinator</option></select></td>
          <td class="c"><label class="switch"><input type="checkbox" data-pr="active" data-id="${p.id}" ${p.active ? 'checked' : ''} ${self ? 'disabled' : ''}><span></span></label></td>
          <td style="min-width:130px"><span class="small num">${sub} / ${todo} submitted</span><div class="bar"><i style="width:${pct}%"></i></div></td>
          <td class="c num">${rec}</td>
          <td class="r" style="white-space:nowrap"><button class="btn sm" data-reset="${p.id}">Reset password</button> <button class="btn sm ghost" data-invite="${p.id}" title="Copy invitation text without a password">Invite text</button></td></tr>`;
      }).join('')}</tbody></table></div>
    <p class="small muted" style="margin-top:10px">Deactivating a reviewer blocks their sign-in access to proposals and removes them from progress counts; their submitted scores are kept and still count.</p>`;
  app.innerHTML = adminShell('reviewers', inner);
  $('#addRev').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, btn = $('button[type=submit]', f);
    const data = { display_name: f.name.value.trim(), email: f.email.value.trim(), unit: f.unit.value, role: f.role.value, password: f.pw.value };
    if (data.password.length < 8) return toast('Password must be at least 8 characters.', 'bad');
    btn.disabled = true;
    try {
      const p = await S.api.createReviewer(data);
      S.profiles.push(p); tabReviewers(); showCredentials(p, data.password, 'Login created');
    } catch (err) { toast(err.message, 'bad'); btn.disabled = false; }
  };
  app.onclick = async e => {
    if (commonClicks(e)) return;
    if (e.target.closest('[data-act=gen]')) { $('#addRev').pw.value = genPassword(); return; }
    const r = e.target.closest('[data-reset]');
    if (r) {
      const p = S.profiles.find(x => x.id === r.dataset.reset); const pw = genPassword();
      const ok = await modal({ title: 'Reset password for ' + p.display_name + '?', body: `<label class="f">New temporary password</label><input class="input" id="rpw" value="${pw}">`, ok: 'Reset password',
        onOk: async bg => { const v = $('#rpw', bg).value; if (v.length < 8) throw new Error('At least 8 characters.'); await S.api.setPassword(p.id, v); return v; } });
      if (ok) showCredentials(p, ok, 'Password reset');
      return;
    }
    const inv = e.target.closest('[data-invite]');
    if (inv) { copyText(loginMessage(S.profiles.find(x => x.id === inv.dataset.invite), '')); }
  };
  app.onchange = async e => {
    const t = e.target; if (!t.dataset.pr) return;
    const f = t.dataset.pr, id = t.dataset.id; const v = t.type === 'checkbox' ? t.checked : t.value;
    try { const row = await S.api.updateProfile(id, { [f]: v }); Object.assign(S.profiles.find(x => x.id === id), row); toast('Saved', 'ok'); if (f === 'active' || f === 'role') tabReviewers(); }
    catch (err) { toast(err.message, 'bad'); tabReviewers(); }
  };
  app.oninput = null;
}

// ---------------- Funding planner ----------------
function fundingModel() {
  const all = sortedProposals(S.proposals, 'mean');
  const elig = all.filter(x => x.st.status === 'above');
  const cap = budgetCap();
  let cum = 0, sugCum = 0;
  const topBy = {};
  elig.forEach(x => { const c = pa(x.p.id).college || '—'; if (!topBy[c]) topBy[c] = x.p.id; });
  const meanKey = x => Math.round((x.st.mean || 0) * 100);
  const tieCount = {}; elig.forEach(x => { tieCount[meanKey(x)] = (tieCount[meanKey(x)] || 0) + 1; });
  const rows = elig.map((x, i) => {
    const A = pa(x.p.id); const req = Number(A.requested || 0);
    cum += req;
    let suggested = false;
    if (sugCum + req <= cap) { suggested = true; sugCum += req; }
    return { ...x, A, req, cum, suggested, rank: i + 1, top: topBy[A.college || '—'] === x.p.id, tie: tieCount[meanKey(x)] > 1 };
  });
  const decided = S.proposals.map(p => pa(p.id)).filter(A => FUNDED.has(A.decision));
  const awarded = decided.reduce((a, A) => a + Number(A.awarded != null ? A.awarded : A.requested || 0), 0);
  const byCollege = {};
  colleges().forEach(c => { byCollege[c] = { n: 0, amt: 0, elig: 0 }; });
  decided.forEach(A => { const c = A.college || '—'; byCollege[c] = byCollege[c] || { n: 0, amt: 0, elig: 0 }; byCollege[c].n++; byCollege[c].amt += Number(A.awarded != null ? A.awarded : A.requested || 0); });
  elig.forEach(x => { const c = pa(x.p.id).college || '—'; byCollege[c] = byCollege[c] || { n: 0, amt: 0, elig: 0 }; byCollege[c].elig++; });
  const tiers = { micro: 0, midi: 0 };
  S.proposals.forEach(p => { const A = pa(p.id); if (FUNDED.has(A.decision)) { const t = A.decision === 'fund_micro' ? 'micro' : p.tier; tiers[t]++; } });
  return { all, elig, rows, cap, awarded, byCollege, tiers, sugTotal: sugCum, other: all.filter(x => x.st.status !== 'above') };
}
function tabFunding() {
  const M = fundingModel();
  const remaining = M.cap - M.awarded;
  const decSel = (id, val) => `<select class="input sm" data-dec="${id}">${DECISIONS.map(([v, l]) => `<option value="${v}" ${v === (val || '') ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const inner = `
    <div class="kpis">
      <div class="kpi"><div class="v num">${money(M.cap)}</div><div class="l">Total funds this cycle</div></div>
      <div class="kpi hl"><div class="v num">${money(M.awarded)}</div><div class="l">Awarded so far (your decisions)</div><div class="bar"><i style="width:${Math.min(100, Math.round(100 * M.awarded / (M.cap || 1)))}%;background:${M.awarded > M.cap ? 'var(--bad)' : 'var(--ok)'}"></i></div></div>
      <div class="kpi"><div class="v num" style="color:${remaining < 0 ? 'var(--bad)' : 'inherit'}">${money(remaining)}</div><div class="l">Remaining</div></div>
      <div class="kpi"><div class="v num">${M.tiers.micro} <span class="muted" style="font-size:15px">micro</span> · ${M.tiers.midi} <span class="muted" style="font-size:15px">midi</span></div><div class="l">Awards (RFP expects ~12–15 micro, ~5–8 midi)</div></div>
    </div>
    <div class="notice info" style="margin-bottom:16px">Eligible = ${thrIncludesBonus() ? 'mean total' : 'mean excluding bonus'} ≥ ${threshold()} with Competency mean &gt; 0. Ranked from the top score down; <strong>Suggested</strong> funds each in full while it fits under the cap. Also consider the top-scoring proposal in each college/school, and break ties in favor of the unit with fewer awards (RFP §9). All scores are recommendations to the Office of the Provost.</div>
    <div class="row between noprint" style="margin-bottom:10px"><h3>Eligible proposals (${M.rows.length})</h3>
      <div class="row"><button class="btn sm" data-act="exp-sum">Export summary (CSV)</button><button class="btn sm" data-act="print">Print</button></div></div>
    ${M.rows.length ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th class="c">#</th><th>Code</th><th>Proposal</th><th>College</th><th class="c mean-col">Mean ± SD</th><th class="r">Requested</th><th class="r">Cumulative</th><th class="c">Suggested</th><th>Decision</th><th class="r">Award $</th></tr></thead>
      <tbody>${M.rows.map(x => `<tr>
        <td class="c num muted">${x.rank}</td>
        <td class="num"><a href="#/review/admin/proposal/${x.p.id}"><strong>${esc(x.p.code)}</strong></a></td>
        <td style="min-width:200px">${esc(x.p.title)}<div class="row" style="gap:5px;margin-top:3px">${tierChip(x.p.tier)}${x.top ? '<span class="badge b-navy">Top in college</span>' : ''}${x.tie ? '<span class="badge b-warn">Tie</span>' : ''}${x.st.compZeroAny ? '<span class="badge b-warn">⚠ Comp. 0</span>' : ''}</div></td>
        <td class="small">${esc(x.A.college || '—')}</td>
        <td class="c mean-col num"><span class="meanpill">${fmt1(x.st.mean)}</span> <div class="tiny muted">± ${fmt1(x.st.sd)} · n = ${x.st.n}</div></td>
        <td class="r num">${money(x.req)}</td>
        <td class="r num ${x.cum > M.cap ? 'hot' : ''}">${money(x.cum)}</td>
        <td class="c">${x.suggested ? '<span class="badge b-ok">Fund</span>' : '<span class="badge b-plain">Over cap</span>'}</td>
        <td class="noprint">${decSel(x.p.id, x.A.decision)}</td><td class="printonly">${esc((DECISIONS.find(d => d[0] === (x.A.decision || '')) || ['', ''])[1])}</td>
        <td class="r"><input class="input sm num" type="number" min="0" step="50" style="width:95px;text-align:right" data-award="${x.p.id}" value="${x.A.awarded != null ? esc(x.A.awarded) : ''}" placeholder="${FUNDED.has(x.A.decision) ? esc(x.req) : ''}" ${FUNDED.has(x.A.decision) ? '' : 'disabled'}></td>
      </tr>`).join('')}</tbody></table></div>
      <p class="small muted">Funding every eligible proposal in full would take ${money(M.rows.reduce((a, x) => a + x.req, 0))}; the suggested set totals ${money(M.sugTotal)}.</p>` : '<div class="card empty">No proposals are above threshold yet.</div>'}
    <div class="grid2" style="margin-top:20px">
      <div><h3 style="margin-bottom:10px">Awards by college / school</h3>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>College / school</th><th class="c">Eligible</th><th class="c">Awards</th><th class="r">Amount</th></tr></thead>
        <tbody>${Object.entries(M.byCollege).map(([c, v]) => `<tr><td>${esc(c)}</td><td class="c num">${v.elig}</td><td class="c num">${v.n}</td><td class="r num">${money(v.amt)}</td></tr>`).join('')}</tbody></table></div></div>
      <div><h3 style="margin-bottom:10px">Below threshold or awaiting reviews (${M.other.length})</h3>
        ${M.other.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>College</th><th class="c">Mean</th><th>Status</th><th>Decision</th></tr></thead>
        <tbody>${M.other.map(x => `<tr><td><a href="#/review/admin/proposal/${x.p.id}">${esc(x.p.code)}</a></td><td class="small">${esc(pa(x.p.id).college || '—')}</td><td class="c num">${fmt1(x.st.mean)}</td><td>${statusBadge(x.st)}</td><td class="noprint">${decSel(x.p.id, pa(x.p.id).decision)}</td><td class="printonly">${esc((DECISIONS.find(d => d[0] === (pa(x.p.id).decision || '')) || ['', ''])[1])}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card empty small">None.</div>'}
      </div>
    </div>`;
  app.innerHTML = adminShell('funding', inner);
  app.onclick = e => {
    if (commonClicks(e)) return;
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'exp-sum') exportSummary();
    if (a.dataset.act === 'print') window.print();
  };
  app.onchange = async e => {
    const t = e.target;
    try {
      if (t.dataset.dec) {
        const id = t.dataset.dec, d = t.value, A = pa(id); const p = S.proposals.find(x => x.id === id);
        let awarded = null;
        if (d === 'fund') awarded = Number(A.requested || 0);
        else if (d === 'fund_micro') awarded = Math.min(Number(A.requested || 0) || 1000, 1000);
        else if (d === 'partial') awarded = A.awarded != null ? Number(A.awarded) : Math.round(Number(A.requested || 0) / 2);
        await S.api.updateProposalAdmin(id, { decision: d, awarded });
        S.padmin[id] = { ...A, decision: d, awarded };
        toast(`${p.code}: ${(DECISIONS.find(x => x[0] === d) || ['', 'cleared'])[1]}`, 'ok'); tabFunding();
      }
      if (t.dataset.award) {
        const id = t.dataset.award; const v = t.value === '' ? null : Number(t.value);
        await S.api.updateProposalAdmin(id, { awarded: v }); S.padmin[id] = { ...pa(id), awarded: v }; tabFunding();
      }
    } catch (err) { toast(err.message, 'bad'); }
  };
  app.oninput = null;
}

// ---------------- My reviews ----------------
function tabMine() {
  app.innerHTML = adminShell('mine', `<p class="muted" style="margin-top:-6px">You also review as the Arts and Sciences representative. Your scores count toward each proposal's mean like any other reviewer's.</p>${queueHTML()}`);
  app.onclick = e => {
    if (commonClicks(e)) return;
    const o = e.target.closest('[data-open]'); if (o) go('review/p/' + o.dataset.open);
  };
  app.onchange = app.oninput = null;
}

// ---------------- Settings ----------------
function tabSettings() {
  const rb = R();
  const custom = !!(S.settings.rubric && S.settings.rubric.criteria);
  const inner = `
    <div class="grid2">
      <div class="card pad stack">
        <h3>Review window</h3>
        <label class="check"><span class="switch"><input type="checkbox" data-set="reviews_open" ${reviewsOpen() ? 'checked' : ''}><span></span></span> Reviewing is open (reviewers can score and submit)</label>
        <label class="check"><span class="switch"><input type="checkbox" data-set="coordinator_reviews" ${coordReviews() ? 'checked' : ''}><span></span></span> I score proposals with this coordinator account</label>
        <div class="small muted" style="margin-top:-6px">Turn off if you review under a separate reviewer login. Your coordinator account then drops out of the score matrix and review counts, and the My reviews tab is hidden.</div>
        <div><label class="f">Review deadline (shown to reviewers)</label><input class="input" type="date" data-set="review_deadline" value="${esc(S.settings.review_deadline || '')}" style="max-width:220px"></div>
      </div>
      <div class="card pad stack">
        <h3>Scoring and funding</h3>
        <div class="row"><div style="flex:1"><label class="f">Funding threshold (mean score)</label><input class="input num" type="number" step="0.5" data-set="threshold" value="${threshold()}"></div>
          <div style="flex:1"><label class="f">Budget cap ($)</label><input class="input num" type="number" step="500" data-set="budget_cap" value="${budgetCap()}"></div></div>
        <label class="check"><span class="switch"><input type="checkbox" data-set="threshold_includes_bonus" ${thrIncludesBonus() ? 'checked' : ''}><span></span></span> Threshold counts bonus points (RFP: "a score of ≥31"; rubric sheet: "31 of 52")</label>
        <div><label class="f">Flag a criterion as "split" when reviewer SD is at least</label><input class="input num" type="number" step="0.1" min="0" data-set="disagreement_sd" value="${disagreeSD()}" style="max-width:120px"></div>
      </div>
      <div class="card pad stack">
        <h3>Colleges / schools</h3>
        <textarea class="input" rows="6" data-colleges>${esc(colleges().join('\n'))}</textarea>
        <div class="row between"><span class="small muted">One per line. Used for reviewer units and proposal colleges.</span><button class="btn sm" data-act="savecol">Save list</button></div>
      </div>
      <div class="card pad stack">
        <h3>Passwords</h3>
        <div><label class="f">New Grants Management password</label><div class="row" style="flex-wrap:nowrap"><input class="input" type="password" id="mgpw" autocomplete="new-password" placeholder="8+ characters"><button class="btn" data-act="mgpw">Change</button></div>
          <div class="small muted" style="margin-top:4px">Separate from everyone's review logins.</div></div>
        <div><button class="btn" data-act="mypw">Change my own sign-in password</button></div>
      </div>
    </div>
    <div class="card pad" style="margin-top:16px">
      <div class="row between"><h3>Rubric ${custom ? '<span class="badge b-gold">customized</span>' : '<span class="badge b-plain">default</span>'}</h3>
        <div class="row"><button class="btn sm" data-act="rubreset">Reset to default</button><button class="btn sm primary" data-act="rubsave">Save rubric</button></div></div>
      <p class="small muted" style="margin:6px 0 12px">Edits apply to all totals immediately, including reviews already submitted (scores are stored per criterion and totals are recomputed). Current maximum: ${maxBase()} + ${maxBonus()} bonus = ${maxBase() + maxBonus()}.</p>
      <div id="rubEd">${rb.criteria.map((c, i) => `<details class="rb" data-ci="${i}"><summary><span class="wt">×${c.weight}</span> ${esc(c.name)}</summary><div class="rb-body">
        <div class="row" style="flex-wrap:nowrap"><div style="flex:1"><label class="f">Name</label><input class="input sm" data-k="name" value="${esc(c.name)}"></div>
          <div><label class="f">Weight</label><input class="input sm num" type="number" min="0" step="1" data-k="weight" value="${c.weight}" style="width:70px"></div>
          <div><label class="f">Section</label><input class="input sm" data-k="section" value="${esc(c.section || '')}" style="width:80px"></div></div>
        ${[4, 3, 2, 1, 0].map(l => `<div><label class="f">${l} — ${esc((rb.levels.find(x => x.v === l) || {}).label || '')}</label><textarea class="input sm" rows="2" data-k="d${l}">${esc((c.desc || {})[l] || '')}</textarea></div>`).join('')}
        <div><label class="f">Reviewer guidance</label><textarea class="input sm" rows="2" data-k="guidance">${esc(c.guidance || '')}</textarea></div></div></details>`).join('')}
        ${rb.bonuses.map((b, i) => `<details class="rb" data-bi="${i}"><summary><span class="pts">+${b.points}</span> ${esc(b.name)}</summary><div class="rb-body">
          <div class="row" style="flex-wrap:nowrap"><div style="flex:1"><label class="f">Name</label><input class="input sm" data-k="name" value="${esc(b.name)}"></div>
          <div><label class="f">Points</label><input class="input sm num" type="number" min="0" step="1" data-k="points" value="${b.points}" style="width:70px"></div>
          <div><label class="f">Section</label><input class="input sm" data-k="section" value="${esc(b.section || '')}" style="width:80px"></div></div></div></details>`).join('')}
      </div>
    </div>
    <div class="card pad" style="margin-top:16px">
      <h3 style="margin-bottom:10px">Data</h3>
      <div class="row"><button class="btn" data-act="exp-long">Export all scores (CSV)</button><button class="btn" data-act="exp-sum">Export summary (CSV)</button>
      ${S.demo ? '<button class="btn danger" data-act="resetdemo">Reset demo data</button>' : ''}</div>
      <p class="small muted" style="margin:8px 0 0">Export both CSVs after each review round as your own backup.</p>
    </div>`;
  app.innerHTML = adminShell('settings', inner);
  app.onclick = async e => {
    if (commonClicks(e)) return;
    const a = e.target.closest('[data-act]'); if (!a) return;
    const act = a.dataset.act;
    try {
      if (act === 'savecol') {
        const list = $('[data-colleges]').value.split('\n').map(s => s.trim()).filter(Boolean);
        await S.api.saveSetting('colleges', list); S.settings.colleges = list; toast('Saved', 'ok');
      }
      if (act === 'mgpw') {
        const v = $('#mgpw').value; if (v.length < 8) return toast('Use at least 8 characters.', 'bad');
        await S.api.setMgmtPassword(v); $('#mgpw').value = ''; toast('Grants Management password changed', 'ok');
      }
      if (act === 'mypw') changeOwnPassword();
      if (act === 'rubsave') {
        const cur = JSON.parse(JSON.stringify(R()));
        $$('[data-ci]').forEach(d => {
          const c = cur.criteria[Number(d.dataset.ci)];
          $$('[data-k]', d).forEach(inp => {
            const k = inp.dataset.k;
            if (k === 'weight') c.weight = Math.max(0, Number(inp.value || 0));
            else if (/^d\d$/.test(k)) { c.desc = c.desc || {}; c.desc[k[1]] = inp.value; }
            else c[k] = inp.value;
          });
        });
        $$('[data-bi]').forEach(d => {
          const b = cur.bonuses[Number(d.dataset.bi)];
          $$('[data-k]', d).forEach(inp => { const k = inp.dataset.k; b[k] = k === 'points' ? Math.max(0, Number(inp.value || 0)) : inp.value; });
        });
        if (S.reviews.some(r => r.status === 'submitted') && !await confirmBox('Change the rubric mid-review?', 'Reviews have already been submitted. Changing weights or points recalculates their totals.', 'Save rubric')) return;
        await S.api.saveSetting('rubric', cur); S.settings.rubric = cur; toast('Rubric saved', 'ok'); tabSettings();
      }
      if (act === 'rubreset') {
        if (!await confirmBox('Reset rubric?', 'Restore the published default rubric text, weights and bonus points.', 'Reset')) return;
        await S.api.saveSetting('rubric', {}); S.settings.rubric = {}; toast('Rubric reset', 'ok'); tabSettings();
      }
      if (act === 'exp-long') exportLong();
      if (act === 'exp-sum') exportSummary();
      if (act === 'resetdemo') { S.api.reset(); S.me = null; S.loaded = false; go(''); }
    } catch (err) { toast(err.message, 'bad'); }
  };
  app.onchange = async e => {
    const t = e.target; const k = t.dataset.set; if (!k) return;
    let v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) : t.value;
    try { await S.api.saveSetting(k, v); S.settings[k] = v; toast('Saved', 'ok'); viewAdmin('settings'); }
    catch (err) { toast(err.message, 'bad'); }
  };
  app.oninput = null;
}

// ====================================================================
// Exports
// ====================================================================
function exportLong() {
  const rb = R();
  const prof = id => S.profiles.find(p => p.id === id) || { display_name: id, unit: '' };
  const head = ['Code', 'Title', 'Tier', 'College', 'Requested', 'Reviewer', 'Reviewer unit', 'Status', 'Submitted at']
    .concat(rb.criteria.map(c => `${c.name} (0-4, x${c.weight})`), rb.bonuses.map(b => `BONUS ${b.name} (+${b.points})`),
      ['Weighted (max ' + maxBase() + ')', 'Bonus', 'Total (max ' + (maxBase() + maxBonus()) + ')', 'Overall comment', 'Criterion comments', 'COI note']);
  const rows = [head];
  const ps = S.proposals.slice().sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  ps.forEach(p => {
    S.reviews.filter(r => r.proposal_id === p.id).forEach(r => {
      const c = calc(r); const u = prof(r.reviewer_id); const A = pa(p.id);
      rows.push([p.code, p.title, p.tier, A.college, A.requested, u.display_name, u.unit, r.status, r.submitted_at || '']
        .concat(rb.criteria.map(k => isNum((r.scores || {})[k.key]) ? r.scores[k.key] : ''), rb.bonuses.map(b => (r.scores || {})[b.key] ? b.points : 0),
          [c.base, c.bonus, c.total, r.overall_comment || '', rb.criteria.filter(k => (r.comments || {})[k.key]).map(k => `${k.name}: ${r.comments[k.key]}`).join(' | '), r.coi_note || '']));
    });
  });
  download(`ai-grants-all-scores-${stamp()}.csv`, csv(rows));
}
function exportSummary() {
  const rb = R();
  const head = ['Rank', 'Code', 'Title', 'Tier', 'College', 'Requested', 'n submitted', 'Drafts', 'Recused', 'Mean total', 'SD', 'Min', 'Max', 'Mean excl. bonus']
    .concat(rb.criteria.map(c => `Mean: ${c.name}`), ['Status', 'Any reviewer Competency=0', 'Decision', 'Award']);
  const rows = [head];
  sortedProposals(S.proposals, 'mean').forEach((x, i) => {
    const A = pa(x.p.id), st = x.st;
    const r1 = v => v == null ? '' : Math.round(v * 100) / 100;
    rows.push([i + 1, x.p.code, x.p.title, x.p.tier, A.college, A.requested, st.n, st.drafts.length, st.recused.length, r1(st.mean), r1(st.sd), st.min == null ? '' : st.min, st.max == null ? '' : st.max, r1(st.meanBase)]
      .concat(rb.criteria.map(c => r1(st.crit[c.key].mean)), [{ above: 'Above threshold', below: 'Below threshold', gate: 'Competency mean 0', pending: 'Awaiting reviews' }[st.status], st.compZeroAny ? 'yes' : '',
        (DECISIONS.find(d => d[0] === (A.decision || '')) || ['', ''])[1].replace('— undecided —', ''), FUNDED.has(A.decision) ? (A.awarded != null ? A.awarded : A.requested) : '']));
  });
  download(`ai-grants-summary-${stamp()}.csv`, csv(rows));
}

// ====================================================================
// Boot
// ====================================================================
async function boot() {
  if (isDemo()) { S.api = new window.GrantsApi.DemoApi(); S.demo = true; }
  else if (configured()) S.api = new window.GrantsApi.SupabaseApi(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  if (S.api) { try { S.me = await S.api.currentProfile(); } catch (e) { S.me = null; } }
  if (S.api && !S.demo) {
    S.api.sb.auth.onAuthStateChange((evt) => { if (evt === 'SIGNED_OUT' && S.me) { S.me = null; S.loaded = false; go(''); } });
  }
  window.addEventListener('hashchange', render);
  render();
}
boot();
})();
