// Grants Management — post-award tracking for the coordinator.
// Loaded before app.js; app.js calls window.Mgmt.render(parts, helpers) for #/manage routes.
(function () {
'use strict';

let P = null;                       // helpers handed over by app.js
const M = { loaded: false, ok: false, d: null };
const TBL = ['mgmt_awards', 'mgmt_people', 'mgmt_sessions', 'mgmt_attendance', 'mgmt_milestones', 'mgmt_budget_lines',
  'mgmt_expenses', 'mgmt_assessments', 'mgmt_surveys', 'mgmt_survey_done', 'mgmt_testimonials', 'mgmt_deliverables'];
const short = t => t.replace('mgmt_', '');

const DOMAINS = { 1: 'Critical evaluation', 2: 'AI foundations', 3: 'Effective use', 4: 'Judgment', 5: 'Ethics, integrity & privacy', 6: 'Discipline & workplace application' };
const KINDS = { convening: 'Convening', training: 'AI training', lightning: 'Lightning Talks', watch: 'Watch party', other: 'Other' };
const CATS = { stipend: 'Stipend', software: 'Software / AI license', equipment: 'Equipment', materials: 'Materials / printing', speaker: 'Speaker / workshop fee', other: 'Other' };
const STIP = [['pending', 'Pending'], ['approved', 'Approved'], ['sent', 'Sent to payroll'], ['paid', 'Paid']];
const DELIV = { final_report: 'Final report', syllabus: 'Revised syllabus', assignment: 'Assignment / activity', assessment_data: 'Assessment data', other: 'Other' };
const STATUS = { active: 'Active', complete: 'Complete', withdrawn: 'Withdrawn' };
const KEY_STORE = 'aigp-anthropic-key', MODEL_STORE = 'aigp-anthropic-model', NARR_STORE = 'aigp-narrative';

// ---------------------------------------------------------------- utils
const esc = s => P.esc(s);
const $ = (s, el) => P.$(s, el), $$ = (s, el) => P.$$(s, el);
const num = (v, d) => (v == null || v === '' || isNaN(Number(v))) ? d : Number(v);
const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f ? f(x) : x) || 0), 0);
const money = n => P.money(n);
const pct = n => (n == null || isNaN(n)) ? '—' : Math.round(n) + '%';
const f1 = n => (n == null || isNaN(n)) ? '—' : (Math.round(n * 10) / 10).toFixed(1);
const f2 = n => (n == null || isNaN(n)) ? '—' : (Math.round(n * 100) / 100).toFixed(2);
const today = () => new Date().toISOString().slice(0, 10);
const ls = {
  get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
  set(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* ignore */ } }
};
const dshort = d => {
  if (!d) return 'TBD';
  const dt = new Date(d + 'T12:00:00');
  return isNaN(dt) ? d : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: dt.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
};
const tierChip = t => P.tierChip(t);
const byCode = (a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }) || String(a.title).localeCompare(String(b.title));

// ---------------------------------------------------------------- settings
const st = () => P.S.settings;
const reqTraining = () => num(st().mgmt_req_training, 3);
const reqCop = () => num(st().mgmt_req_cop, 5);
const talksPer = () => Math.max(1, num(st().mgmt_talks_per_session, 5));
const cycle = () => st().mgmt_cycle || 'Spring 2027';
const donor = () => st().mgmt_donor || 'Zach Handelman, Member, WNE Board of Trustees';
const cap = () => num(st().budget_cap, 35000);

// ---------------------------------------------------------------- data
async function load() {
  const ok = await P.S.api.mStatus();
  if (!ok) throw new Error('LOCKED');
  const res = await Promise.all(TBL.map(t => P.S.api.mList(t)));
  M.d = {}; TBL.forEach((t, i) => { M.d[short(t)] = res[i]; });
  M.loaded = true;
}
function lockedOut(msg) {
  M.loaded = false; M.ok = false; P.ss.del(P.MGMT_KEY);
  P.toast(msg || 'Grants Management is locked. Enter the management password again.', 'bad');
  P.go('');
}
async function call(fn) {
  try { return await fn(); }
  catch (e) {
    if (/row-level security|violates|permission denied|is locked/i.test(e.message || '')) { lockedOut('Your management unlock has expired. Unlock again to keep working.'); return undefined; }
    P.toast(e.message || String(e), 'bad'); return undefined;
  }
}
function put(t, row) {           // replace or add a row in the local cache
  const k = short(t); const arr = M.d[k];
  const i = row.id ? arr.findIndex(r => r.id === row.id) : -1;
  if (i >= 0) arr[i] = row; else arr.push(row);
}
const awards = () => M.d.awards.slice().sort(byCode);
const active = () => awards().filter(a => a.status !== 'withdrawn');
const award = id => M.d.awards.find(a => a.id === id);
const roleRank = p => ({ lead: 0, 'co-lead': 1, member: 2 }[p.role] ?? 3);
const peopleOf = id => M.d.people.filter(p => p.award_id === id).sort((a, b) => roleRank(a) - roleRank(b) || a.name.localeCompare(b.name));
const leadOf = id => peopleOf(id)[0] || null;
const sessions = () => M.d.sessions.slice().sort((a, b) => (a.session_date || '9999') .localeCompare(b.session_date || '9999') || a.sort - b.sort || a.title.localeCompare(b.title));
const att = (sid, aid) => M.d.attendance.find(r => r.session_id === sid && r.award_id === aid);
const linesOf = id => M.d.budget_lines.filter(l => l.award_id === id);
const expOf = id => M.d.expenses.filter(x => x.award_id === id);
const leadName = a => { const l = leadOf(a.id); return l ? l.name : ''; };
const talksNeeded = () => sum(active(), a => a.tier === 'midi' ? 2 : 1);

// ---------------------------------------------------------------- conditions (RFP §7; lead-only tracking)
function conds(a) {
  const midi = a.tier === 'midi';
  const w = a.waivers || {};
  const A = M.d.attendance.filter(r => r.award_id === a.id);
  const sess = id => M.d.sessions.find(s => s.id === id) || {};
  const tr = A.filter(r => r.attended && sess(r.session_id).kind === 'training').length;
  const cop = A.filter(r => r.attended && sess(r.session_id).counts_cop).length;
  const talks = A.filter(r => r.presented).length;
  const asm = M.d.assessments.filter(r => r.award_id === a.id);
  const d1 = asm.some(r => Number(r.domain) === 1 && r.mean_pre != null && r.mean_post != null);
  const sv = M.d.surveys.length;
  const svDone = M.d.survey_done.filter(r => r.award_id === a.id && M.d.surveys.some(s => s.id === r.survey_id)).length;
  const dl = M.d.deliverables.filter(r => r.award_id === a.id);
  const rep = dl.some(x => x.kind === 'final_report'), mat = dl.some(x => x.kind === 'syllabus' || x.kind === 'assignment');
  const list = [
    { k: 'training', short: 'Training', label: 'AI training series', req: true, have: tr, need: reqTraining(), how: 'Attendance at AI training sessions' },
    { k: 'assessment', short: 'Pre/post', label: 'Pre/post assessment incl. Domain 1', req: true, have: d1 ? 1 : 0, need: 1, how: `Domain 1 pre and post means entered (${asm.length} domain row${asm.length === 1 ? '' : 's'} on file)` },
    { k: 'talks', short: 'Talks', label: midi ? 'Two Lunch Lightning Talks' : 'One Lunch Lightning Talk', req: true, have: talks, need: midi ? 2 : 1, how: '"Presented" ticks on session attendance' },
    { k: 'surveys', short: 'Surveys', label: 'Initiative surveys', req: true, have: svDone, need: sv, how: 'Completion ticks on the Surveys tab' },
    { k: 'report', short: 'Report', label: 'Final report + syllabus or assignment', req: true, have: (rep ? 1 : 0) + (mat ? 1 : 0), need: 2, how: 'Deliverables on file: final report, plus a syllabus or assignment' },
    { k: 'repository', short: 'Repository', label: 'Materials in institutional repository', req: true, have: a.repository_done ? 1 : 0, need: 1, how: 'Repository box ticked on the award' },
    { k: 'cop', short: 'CoP', label: 'Community of Practice events', req: midi, have: cop, need: reqCop(), how: 'Attendance at sessions marked "counts toward CoP"' },
    { k: 'ambassador', short: 'Ambassador', label: 'AI Ambassador to home unit', req: midi, have: a.ambassador_done ? 1 : 0, need: 1, how: 'Ambassador box ticked on the award' }
  ];
  list.forEach(c => {
    c.waived = Object.prototype.hasOwnProperty.call(w, c.k);
    c.waiverNote = c.waived ? String(w[c.k] || '') : '';
    c.met = c.waived || c.have >= c.need;
  });
  return list;
}
function progress(a) {
  const c = conds(a).filter(x => x.req);
  const met = c.filter(x => x.met).length;
  return { met, total: c.length, ready: met === c.length, missing: c.filter(x => !x.met) };
}
function condCell(c) {
  if (c.waived) return `<span class="ck waived" title="Waived${c.waiverNote ? ': ' + esc(c.waiverNote) : ''}">waived</span>`;
  if (!c.req) return c.have ? `<span class="ck opt num" title="Encouraged for micro-grants">${c.have}</span>` : '<span class="cell-none" title="Encouraged, not required, for micro-grants">·</span>';
  if (c.met) return `<span class="ck ok" title="${esc(c.label)}: met">✓</span>`;
  return `<span class="ck part num" title="${esc(c.label)}: ${c.have} of ${c.need}">${c.have}/${c.need}</span>`;
}
function readyBadge(a) {
  if (a.status === 'withdrawn') return '<span class="badge b-plain">Withdrawn</span>';
  const p = progress(a);
  return p.ready ? '<span class="badge b-ok">Ready for stipend</span>' : `<span class="badge b-warn">${p.met}/${p.total} conditions</span>`;
}

// ---------------------------------------------------------------- money
function fin(a) {
  const L = linesOf(a.id), X = expOf(a.id);
  const stip = L.filter(l => l.category === 'stipend');
  return {
    budgeted: sum(L, l => l.amount), stipend: sum(stip, l => l.amount),
    stipPaid: sum(stip.filter(l => l.stipend_status === 'paid'), l => l.amount),
    nonBudget: sum(L.filter(l => l.category !== 'stipend'), l => l.amount), spent: sum(X, x => x.amount)
  };
}

// ---------------------------------------------------------------- assessment maths
function asmStats(rows) {
  // rows with both means and a scale max -> % of scale, n-weighted
  const ok = rows.filter(r => r.mean_pre != null && r.mean_post != null && num(r.scale_max, 0) > 0);
  if (!ok.length) return null;
  const wPre = sum(ok, r => num(r.n_pre, 1)), wPost = sum(ok, r => num(r.n_post, 1));
  const pre = sum(ok, r => num(r.mean_pre, 0) / r.scale_max * 100 * num(r.n_pre, 1)) / (wPre || 1);
  const post = sum(ok, r => num(r.mean_post, 0) / r.scale_max * 100 * num(r.n_post, 1)) / (wPost || 1);
  const g = pre < 100 ? (post - pre) / (100 - pre) : null;
  const dRows = ok.filter(r => num(r.sd_pre, 0) > 0 && num(r.sd_post, 0) > 0);
  let d = null;
  if (dRows.length) {
    const ds = dRows.map(r => {
      const n1 = num(r.n_pre, 2), n2 = num(r.n_post, 2);
      const sp = Math.sqrt(((n1 - 1) * r.sd_pre * r.sd_pre + (n2 - 1) * r.sd_post * r.sd_post) / Math.max(1, n1 + n2 - 2));
      return { d: (r.mean_post - r.mean_pre) / sp, w: n2 };
    });
    d = sum(ds, x => x.d * x.w) / (sum(ds, x => x.w) || 1);
  }
  return { projects: new Set(ok.map(r => r.award_id)).size, students: sum(ok, r => num(r.n_post, 0)), pre, post, gain: post - pre, g, d };
}
const rowGain = r => (r.mean_pre != null && r.mean_post != null && num(r.scale_max, 0) > 0) ? (r.mean_post - r.mean_pre) / r.scale_max * 100 : null;

function gainsChart(byDomain) {
  // Paired horizontal bars, pre (light) vs post (dark), % of scale. Ordinal blue ramp (validated).
  const rows = Object.keys(byDomain).filter(k => byDomain[k]);
  if (!rows.length) return '<div class="empty small">No pre/post data with a scale maximum yet.</div>';
  const W = 640, L = 190, R = 52, rowH = 46, top = 8;
  const H = top + rows.length * rowH + 22;
  const x = v => L + (W - L - R) * Math.max(0, Math.min(100, v)) / 100;
  let g = '';
  [0, 25, 50, 75, 100].forEach(t => {
    g += `<line x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${H - 20}" class="gl"/><text x="${x(t)}" y="${H - 6}" class="ax" text-anchor="middle">${t}%</text>`;
  });
  rows.forEach((k, i) => {
    const s = byDomain[k], y = top + i * rowH;
    g += `<text x="${L - 10}" y="${y + 21}" class="lb" text-anchor="end">${esc(k + '. ' + DOMAINS[k])}</text>`;
    const bar = (v, yy, cls, lab) => {
      const w = Math.max(2, x(v) - L);
      return `<g class="hit"><title>Domain ${k} ${lab}: ${pct(v)} of scale (${s.projects} project${s.projects === 1 ? '' : 's'}, n=${s.students})</title>
        <rect x="${L}" y="${yy}" width="${w}" height="14" rx="4" class="${cls}"/><text x="${L + w + 6}" y="${yy + 11}" class="vl">${pct(v)}</text></g>`;
    };
    g += bar(s.pre, y + 4, 'pre', 'pre') + bar(s.post, y + 21, 'post', 'post');
  });
  return `<div class="legend small"><span><i class="sw pre"></i>Pre</span><span><i class="sw post"></i>Post</span><span class="muted">mean score as % of each instrument's maximum, weighted by n</span></div>
    <svg class="gchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pre and post scores by domain">${g}</svg>`;
}

// ---------------------------------------------------------------- shell & routing
const TABS = [['dashboard', 'Dashboard'], ['awardees', 'Awardees'], ['sessions', 'Sessions & dates'], ['budget', 'Budget'],
  ['assessment', 'Assessment'], ['surveys', 'Surveys & testimonials'], ['reports', 'Reports'], ['settings', 'Settings']];
function shell(tab, inner, extra) {
  const as = active();
  return `<div class="wrap">
    <div class="pagehead"><div><div class="eyebrow">Grants Management · ${esc(cycle())}</div><h1>Innovations with AI awards</h1>
      <p>${as.length} active award${as.length === 1 ? '' : 's'} · ${money(sum(as, a => a.award_total))} awarded of ${money(cap())} · ${as.filter(a => progress(a).ready).length} ready for stipend release</p></div>
      <div class="row noprint">${extra || ''}<a class="btn" href="#/review">Proposal Review</a><button class="btn" data-mact="refresh">Refresh</button></div></div>
    <nav class="tabs">${TABS.map(([k, l]) => `<a class="tab ${k === tab ? 'on' : ''}" href="#/manage/${k}">${l}</a>`).join('')}</nav>
    ${inner}</div>`;
}
let current = null;               // { fn, args } for re-rendering after edits
function show(fn, ...args) { current = { fn, args }; fn(...args); }
function rerender() { const y = window.scrollY; if (current) current.fn(...current.args); window.scrollTo(0, y); }

async function render(parts, helpers) {
  P = helpers;
  const app = P.app;
  if (!M.loaded) {
    app.innerHTML = '<div class="empty">Loading grants management…</div>';
    try { await load(); }
    catch (e) {
      if (e.message === 'MGMT_NOT_INSTALLED') {
        app.innerHTML = `<div class="wrap"><div class="card pad"><h2>One more setup step</h2><p>The Grants Management tables aren't in your database yet. In Supabase, open <strong>SQL Editor → New query</strong>, paste in the full contents of <code>supabase/management.sql</code>, and click <strong>Run</strong>. Then come back and unlock again.</p><a class="btn" href="#/">Back to the portal</a></div></div>`;
        return;
      }
      if (e.message === 'LOCKED') return lockedOut();
      throw e;
    }
    if (!st().mgmt_seeded && !M.d.sessions.length && !M.d.milestones.length) await call(seedShells);
  }
  const [tab, id] = parts;
  const views = { dashboard: vDashboard, awardees: vAwardees, sessions: vSessions, budget: vBudget, assessment: vAssessment, surveys: vSurveys, reports: vReports, settings: vSettings };
  if (tab === 'award' && id) return show(vAward, id);
  if (tab === 'report') return show(vReport);
  show(views[tab] || vDashboard);
}
function reset() { M.loaded = false; M.d = null; current = null; }

// Seed the sessions, milestones and survey the RFP tells us will happen.
async function seedShells() {
  const api = P.S.api;
  const nLight = Math.max(2, Math.ceil((talksNeeded() || 20) / talksPer()));
  const S0 = (kind, title, session_date, counts_cop, sort, notes) => ({ kind, title, session_date, counts_cop, sort, notes, start_time: '', location: '' });
  const rows = [S0('convening', 'Awardee convening & Community of Practice launch', '2026-11-20', true, 1, '')];
  for (let i = 1; i <= 3; i++) rows.push(S0('training', `AI Training ${i}`, null, false, 1 + i, 'Max. three one-hour sessions (RFP §7)'));
  for (let i = 1; i <= nLight; i++) rows.push(S0('lightning', `Lunch Lightning Talks #${i}`, null, true, 10 + i, `Ten-minute talks, ~${talksPer()} per one-hour session`));
  await api.mInsertMany('mgmt_sessions', rows);
  await api.mInsertMany('mgmt_milestones', [
    ['Award notifications', '2026-11-16', true], ['Awardees convene; Community of Practice launches', '2026-11-20', false],
    ['Pre-assessment (start of Spring 2027)', null, false], ['Post-assessment (end of Spring 2027)', null, false],
    ['Final report, assessment data and surveys due (early May 2027)', null, false], ['Stipends released (early summer 2027)', null, false],
    ['Donor impact report drafted (June 2027)', null, false]
  ].map(([title, due_date, done], i) => ({ title, due_date, done, sort: i, notes: '' })));
  await api.mInsertMany('mgmt_surveys', [{ name: 'Final initiative survey (impact data, student testimonials, plans to scale)', sort: 1, due_date: null, link: '' }]);
  await api.saveSetting('mgmt_seeded', true); st().mgmt_seeded = true;
  await load();
  P.toast('Added the sessions, milestones and survey from the RFP. Fill in dates as you set them.', 'ok');
}

// ---------------------------------------------------------------- generic field saving
// <input data-t="awards" data-id="…" data-f="field" data-k="text|num|num0|int|date|bool">
async function saveField(el) {
  const t = 'mgmt_' + el.dataset.t, id = el.dataset.id, f = el.dataset.f, k = el.dataset.k || 'text';
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (k === 'num') v = v === '' ? null : Number(v);
  if (k === 'num0') v = v === '' ? 0 : Number(v);
  if (k === 'int') v = v === '' ? null : parseInt(v, 10);
  if (k === 'date' || k === 'id') v = v || null;
  if (k === 'text') v = String(v).trim();
  const row = await call(() => P.S.api.mUpdate(t, id, { [f]: v }));
  if (row) { put(t, row); P.toast('Saved', 'ok'); }
  return row;
}
function bindCommon(extraClick, extraChange) {
  const app = P.app;
  app.onclick = async e => {
    const r = e.target.closest('[data-mact]');
    if (r && r.dataset.mact === 'refresh') { M.loaded = false; return render(location.hash.replace(/^#\/?manage\/?/, '').split('/').filter(Boolean), P); }
    if (r && r.dataset.mact === 'remind') return remindModal();
    const file = e.target.closest('[data-file]');
    if (file) { e.preventDefault(); return openFile(file.dataset.file, file.dataset.name); }
    if (extraClick) return extraClick(e);
  };
  app.onchange = async e => {
    const el = e.target;
    if (el.dataset && el.dataset.t && el.dataset.id && el.dataset.f) {
      const row = await saveField(el);
      if (row && el.dataset.rr !== undefined) rerender();
      return;
    }
    if (extraChange) return extraChange(e);
  };
  app.oninput = null;
}
async function openFile(path, name) {
  const w = window.open('', '_blank');
  try { const u = await P.S.api.mFileUrl(path, name); w.location = u; }
  catch (err) { w.close(); P.toast(err.message, 'bad'); }
}
const fileLink = (path, name) => path ? `<a href="#" data-file="${esc(path)}" data-name="${esc(name || '')}">${esc(name || 'file')}</a>` : '';
const inp = (t, row, f, opts = {}) => {
  const v = row[f] == null ? '' : row[f];
  const type = opts.type || (opts.k === 'date' ? 'date' : (opts.k && opts.k.startsWith('num')) || opts.k === 'int' ? 'number' : 'text');
  return `<input class="input sm ${opts.cls || ''}" type="${type}" ${opts.step ? `step="${opts.step}"` : (type === 'number' ? 'step="any"' : '')} data-t="${t}" data-id="${row.id}" data-f="${f}" data-k="${opts.k || 'text'}" ${opts.rr ? 'data-rr' : ''} value="${esc(v)}" ${opts.ph ? `placeholder="${esc(opts.ph)}"` : ''} style="${opts.w ? 'width:' + opts.w : ''}">`;
};
const sel = (t, row, f, options, opts = {}) => `<select class="input sm" data-t="${t}" data-id="${row.id}" data-f="${f}" data-k="${opts.k || 'text'}" ${opts.rr ? 'data-rr' : ''} style="${opts.w ? 'width:' + opts.w : ''}">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(row[f] == null ? '' : row[f]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const chk = (t, row, f, opts = {}) => `<input type="checkbox" class="cbx" data-t="${t}" data-id="${row.id}" data-f="${f}" data-k="bool" ${opts.rr ? 'data-rr' : ''} ${row[f] ? 'checked' : ''}>`;

// ---------------------------------------------------------------- Dashboard
function matrix(list) {
  const keys = ['training', 'talks', 'cop', 'assessment', 'surveys', 'report', 'repository', 'ambassador'];
  const head = conds({ tier: 'midi', waivers: {}, id: '' });
  return `<div class="tbl-wrap"><table class="tbl mtx">
    <thead><tr><th>Award</th><th>Lead</th>${keys.map(k => `<th class="c" title="${esc(head.find(c => c.k === k).label)}">${esc(head.find(c => c.k === k).short)}</th>`).join('')}<th>Status</th></tr></thead>
    <tbody>${list.map(a => {
      const c = conds(a);
      return `<tr class="click" data-open="${a.id}"><td><strong class="num">${esc(a.code)}</strong> ${tierChip(a.tier)}<div class="tiny muted clip">${esc(a.title)}</div></td>
        <td class="small">${esc(leadName(a)) || '<span class="badge b-warn">add lead</span>'}</td>
        ${keys.map(k => `<td class="c">${condCell(c.find(x => x.k === k))}</td>`).join('')}<td>${readyBadge(a)}</td></tr>`;
    }).join('')}</tbody></table></div>
    <p class="small muted" style="margin-top:8px">✓ met · <span class="ck part">1/3</span> progress · <span class="ck waived">waived</span> · <span class="cell-none">·</span> not required (encouraged for micro-grants). Only the lead's participation is tracked. CoP and Ambassador are required for midi-grants.</p>`;
}
function vDashboard() {
  const as = active();
  const F = as.map(fin);
  const t = today();
  const upcoming = sessions().filter(s => s.session_date && s.session_date >= t).slice(0, 5);
  const undated = M.d.sessions.filter(s => !s.session_date).length;
  const ms = M.d.milestones.slice().sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.sort - b.sort).filter(m => !m.done).slice(0, 6);
  const attention = [];
  as.forEach(a => {
    const l = leadOf(a.id);
    if (!l) attention.push(`<a href="#/manage/award/${a.id}">${esc(a.code)}</a>: no lead entered yet`);
    else if (!l.email) attention.push(`<a href="#/manage/award/${a.id}">${esc(a.code)}</a>: lead has no email`);
    const f = fin(a);
    if (Math.abs(f.budgeted - num(a.award_total, 0)) > 0.5) attention.push(`<a href="#/manage/award/${a.id}">${esc(a.code)}</a>: budget lines total ${money(f.budgeted)} but the award is ${money(a.award_total)}`);
    if (f.spent > f.nonBudget + 0.5) attention.push(`<a href="#/manage/award/${a.id}">${esc(a.code)}</a>: non-stipend spending ${money(f.spent)} exceeds its budget ${money(f.nonBudget)}`);
  });
  M.d.sessions.filter(s => s.session_date && s.session_date < t && !M.d.attendance.some(r => r.session_id === s.id && r.attended))
    .forEach(s => attention.push(`<a href="#/manage/sessions">${esc(s.title)}</a> (${dshort(s.session_date)}) has passed with no attendance recorded`));
  M.d.milestones.filter(m => !m.done && m.due_date && m.due_date < t).forEach(m => attention.push(`Milestone overdue: ${esc(m.title)} (${dshort(m.due_date)})`));
  if (sum(as, a => a.award_total) > cap()) attention.push(`Total awarded (${money(sum(as, a => a.award_total))}) is over the ${money(cap())} cap`);
  const planned = sum(as, a => a.students_planned), reached = sum(as, a => a.students_reached);
  const inner = `
    <div class="kpis">
      <div class="kpi hl"><div class="v num">${as.length}</div><div class="l">Active awards · ${as.filter(a => a.tier === 'micro').length} micro, ${as.filter(a => a.tier === 'midi').length} midi</div></div>
      <div class="kpi"><div class="v num">${money(sum(as, a => a.award_total))}</div><div class="l">Awarded of ${money(cap())}</div><div class="bar"><i style="width:${Math.min(100, Math.round(100 * sum(as, a => a.award_total) / (cap() || 1)))}%"></i></div></div>
      <div class="kpi"><div class="v num">${money(sum(F, f => f.stipPaid))}</div><div class="l">Stipends paid of ${money(sum(F, f => f.stipend))}</div></div>
      <div class="kpi"><div class="v num">${money(sum(F, f => f.spent))}</div><div class="l">Non-stipend spent of ${money(sum(F, f => f.nonBudget))} budgeted</div></div>
      <div class="kpi"><div class="v num">${reached ? reached.toLocaleString() : planned.toLocaleString()}</div><div class="l">${reached ? `Students reached (${planned.toLocaleString()} planned)` : 'Students planned (none reported reached yet)'}</div></div>
      <div class="kpi"><div class="v num">${as.filter(a => progress(a).ready).length} <span class="muted" style="font-size:16px">of ${as.length}</span></div><div class="l">Ready for stipend release</div></div>
    </div>
    ${as.length ? `<div class="row between" style="margin-bottom:10px"><h3>Conditions of award</h3><button class="btn sm" data-mact="remind">Email reminders…</button></div>${matrix(as)}`
      : `<div class="card pad"><h3>No awards yet</h3><p class="muted">Go to <a href="#/manage/awardees">Awardees</a> and import the proposals you marked funded on the review side.</p></div>`}
    <div class="grid2" style="margin-top:20px">
      <div class="card pad"><h3 style="margin-bottom:8px">Coming up</h3>
        ${upcoming.length ? `<ul class="plain">${upcoming.map(s => `<li><span class="date">${dshort(s.session_date)}</span> ${esc(s.title)} <span class="badge b-plain">${esc(KINDS[s.kind])}</span></li>`).join('')}</ul>` : '<p class="muted small" style="margin:0">No dated sessions ahead.</p>'}
        ${undated ? `<p class="small muted" style="margin:8px 0 0">${undated} session${undated === 1 ? '' : 's'} still need a date — <a href="#/manage/sessions">set dates</a>.</p>` : ''}
        ${ms.length ? `<h3 style="margin:14px 0 8px;font-size:15px">Open milestones</h3><ul class="plain">${ms.map(m => `<li><span class="date">${dshort(m.due_date)}</span> ${esc(m.title)}</li>`).join('')}</ul>` : ''}
      </div>
      <div class="card pad"><h3 style="margin-bottom:8px">Needs attention</h3>
        ${attention.length ? `<ul class="plain warnlist">${attention.slice(0, 12).map(x => `<li>${x}</li>`).join('')}</ul>${attention.length > 12 ? `<p class="small muted">…and ${attention.length - 12} more</p>` : ''}` : '<p class="muted small" style="margin:0">Nothing flagged.</p>'}
      </div>
    </div>`;
  P.app.innerHTML = shell('dashboard', inner);
  bindCommon(e => { const o = e.target.closest('[data-open]'); if (o) P.go('manage/award/' + o.dataset.open); });
}

// ---------------------------------------------------------------- Awardees
function importCandidates() {
  return P.S.proposals.filter(p => P.FUNDED.has(P.pa(p.id).decision) && !M.d.awards.some(a => a.proposal_id === p.id))
    .sort(byCode).map(p => {
      const A = P.pa(p.id);
      return { p, A, tier: A.decision === 'fund_micro' ? 'micro' : p.tier, amount: A.awarded != null ? Number(A.awarded) : Number(A.requested || 0) };
    });
}
function vAwardees() {
  const list = awards();
  const cand = importCandidates();
  const inner = `
    <div class="row between" style="margin-bottom:12px">
      <div class="row"><button class="btn primary" data-a="import">Import funded proposals${cand.length ? ` (${cand.length} new)` : ''}</button><button class="btn" data-a="add">Add award manually</button></div>
      <div class="row"><button class="btn sm" data-mact="remind">Email reminders…</button><button class="btn sm" data-a="csv">Roster CSV</button></div></div>
    ${list.length ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Code</th><th>Project</th><th>College</th><th>Lead</th><th class="r">Award</th><th class="r">Students</th><th style="min-width:150px">Conditions</th><th></th></tr></thead>
      <tbody>${list.map(a => { const p = progress(a); const l = leadOf(a.id);
        return `<tr class="click ${a.status === 'withdrawn' ? 'below' : ''}" data-open="${a.id}"><td><strong class="num">${esc(a.code)}</strong></td>
          <td style="min-width:220px">${esc(a.title)}<div class="row" style="gap:5px;margin-top:3px">${tierChip(a.tier)}${a.status !== 'active' ? `<span class="badge b-plain">${esc(STATUS[a.status])}</span>` : ''}</div></td>
          <td class="small">${esc(a.college || '—')}</td>
          <td class="small">${l ? `${esc(l.name)}${peopleOf(a.id).length > 1 ? ` <span class="muted">+${peopleOf(a.id).length - 1}</span>` : ''}` : '<span class="badge b-warn">add lead</span>'}</td>
          <td class="r num">${money(a.award_total)}</td>
          <td class="r num small">${a.students_reached != null ? a.students_reached : (a.students_planned != null ? `<span class="muted">${a.students_planned} planned</span>` : '—')}</td>
          <td><span class="small num">${p.met}/${p.total}</span><div class="bar"><i style="width:${Math.round(100 * p.met / (p.total || 1))}%"></i></div></td>
          <td>${readyBadge(a)}</td></tr>`; }).join('')}</tbody></table></div>`
      : '<div class="card empty">No awards yet. Import the funded proposals from the review side, or add one manually.</div>'}`;
  P.app.innerHTML = shell('awardees', inner);
  bindCommon(async e => {
    const o = e.target.closest('[data-open]'); if (o) return P.go('manage/award/' + o.dataset.open);
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'import') return importModal();
    if (b.dataset.a === 'add') return addAwardModal();
    if (b.dataset.a === 'csv') return exportRoster();
  });
}
async function createAward(row) {
  const a = await P.S.api.mInsert('mgmt_awards', row);
  put('mgmt_awards', a);
  const l = await P.S.api.mInsert('mgmt_budget_lines', { award_id: a.id, category: 'stipend', description: 'Stipend', amount: Number(row.award_total || 0) });
  put('mgmt_budget_lines', l);
  return a;
}
function importModal() {
  const cand = importCandidates();
  if (!cand.length) {
    return P.modal({ title: 'Nothing new to import', ok: 'OK', cancel: null,
      body: '<p style="margin:0">Every proposal marked <em>Fund in full</em>, <em>Fund partially</em> or <em>Fund as micro-grant</em> in the review side\'s Funding planner is already here. To add more, record the decision in the Funding planner first, or add an award manually.</p>' });
  }
  P.modal({
    title: 'Import funded proposals', wide: true, ok: 'Import selected',
    body: `<p class="small muted" style="margin-top:0">From the review side's Funding planner. Each import gets a single stipend budget line for the award amount, which you can split later. Add the lead and co-leads from the cover sheets afterwards.</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>Code</th><th>Title</th><th>Tier</th><th>College</th><th class="r">Award</th></tr></thead>
      <tbody>${cand.map((c, i) => `<tr><td><input type="checkbox" class="cbx" data-imp="${i}" checked></td><td class="num">${esc(c.p.code)}</td><td class="small">${esc(c.p.title)}</td><td>${tierChip(c.tier)}</td><td class="small">${esc(c.A.college || '—')}</td><td class="r num">${money(c.amount)}</td></tr>`).join('')}</tbody></table></div>`,
    onOk: async bg => {
      const picks = $$('[data-imp]', bg).filter(x => x.checked).map(x => cand[Number(x.dataset.imp)]);
      if (!picks.length) throw new Error('Select at least one proposal.');
      for (const c of picks) {
        await createAward({ proposal_id: c.p.id, code: c.p.code, title: c.p.title, tier: c.tier, college: c.A.college || '', award_total: c.amount });
      }
      P.toast(`Imported ${picks.length} award${picks.length === 1 ? '' : 's'}`, 'ok');
      rerender();
    }
  });
}
function addAwardModal() {
  P.modal({
    title: 'Add an award', ok: 'Add award',
    body: `<div class="stack">
      <div class="row" style="flex-wrap:nowrap"><div style="width:110px"><label class="f">Code</label><input class="input" id="naCode" placeholder="P-12"></div><div style="flex:1"><label class="f">Project title</label><input class="input" id="naTitle"></div></div>
      <div class="row" style="flex-wrap:nowrap"><div style="flex:1"><label class="f">Tier</label><select class="input" id="naTier"><option value="micro">Micro</option><option value="midi">Midi</option></select></div>
      <div style="flex:1"><label class="f">College</label><select class="input" id="naCol"><option value="">—</option>${P.colleges().map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
      <div style="flex:1"><label class="f">Award ($)</label><input class="input num" id="naAmt" type="number" min="0" step="50"></div></div></div>`,
    onOk: async bg => {
      const title = $('#naTitle', bg).value.trim(); if (!title) throw new Error('Give the project a title.');
      await createAward({ code: $('#naCode', bg).value.trim(), title, tier: $('#naTier', bg).value, college: $('#naCol', bg).value, award_total: Number($('#naAmt', bg).value || 0) });
      P.toast('Award added', 'ok'); rerender();
    }
  });
}

// ---------------------------------------------------------------- Award detail
function vAward(id) {
  const a = award(id);
  if (!a) { P.app.innerHTML = shell('awardees', '<div class="card empty">That award no longer exists.</div>'); bindCommon(); return; }
  const C = conds(a), pr = progress(a), F = fin(a);
  const ppl = peopleOf(id), lines = linesOf(id), exps = expOf(id);
  const asm = M.d.assessments.filter(r => r.award_id === id).sort((x, y) => x.domain - y.domain);
  const dl = M.d.deliverables.filter(r => r.award_id === id);
  const tst = M.d.testimonials.filter(r => r.award_id === id);
  const sess = sessions();
  const order = awards(); const i = order.findIndex(x => x.id === id);
  const prev = order[i - 1], next = order[i + 1];
  const personOpts = [['', '—']].concat(ppl.map(p => [p.id, p.name || '(unnamed)']));

  const header = `
    <div class="row between noprint" style="margin-bottom:12px"><a href="#/manage/awardees">← All awardees</a>
      <div class="row" style="gap:6px">${prev ? `<a class="btn sm" href="#/manage/award/${prev.id}">← ${esc(prev.code)}</a>` : ''}${next ? `<a class="btn sm" href="#/manage/award/${next.id}">${esc(next.code)} →</a>` : ''}</div></div>
    <div class="row" style="gap:10px;margin-bottom:4px"><h2 class="num">${esc(a.code || '—')}</h2>${tierChip(a.tier)}${readyBadge(a)}</div>
    <div style="font-size:16px;margin-bottom:14px">${esc(a.title)}</div>`;

  const details = `<div class="card pad"><h3 class="ch">Award details</h3>
    <div class="fgrid">
      <div><label class="f">Code</label>${inp('awards', a, 'code', { rr: 1 })}</div>
      <div class="span2"><label class="f">Project title</label>${inp('awards', a, 'title', { rr: 1 })}</div>
      <div><label class="f">Tier</label>${sel('awards', a, 'tier', [['micro', 'Micro'], ['midi', 'Midi']], { rr: 1 })}</div>
      <div><label class="f">Status</label>${sel('awards', a, 'status', Object.entries(STATUS), { rr: 1 })}</div>
      <div><label class="f">Award total ($)</label>${inp('awards', a, 'award_total', { k: 'num0', rr: 1, step: 50 })}</div>
      <div><label class="f">College / school</label>${sel('awards', a, 'college', [['', '—']].concat(P.colleges().map(c => [c, c])).concat(a.college && !P.colleges().includes(a.college) ? [[a.college, a.college]] : []))}</div>
      <div><label class="f">Department</label>${inp('awards', a, 'department')}</div>
      <div><label class="f">Students planned</label>${inp('awards', a, 'students_planned', { k: 'int' })}</div>
      <div><label class="f">Students reached</label>${inp('awards', a, 'students_reached', { k: 'int' })}</div>
      <div class="span2"><label class="f">Course(s)</label>${inp('awards', a, 'course_info', { ph: 'e.g. 200-level required course, 3 sections' })}</div>
      <div class="span3"><label class="f">Proficiency domains targeted</label><div class="row" style="gap:12px">${[1, 2, 3, 4, 5, 6].map(d => `<label class="check small"><input type="checkbox" class="cbx" data-dom="${d}" ${(a.domains || []).map(Number).includes(d) ? 'checked' : ''}> ${d}. ${esc(DOMAINS[d])}</label>`).join('')}</div>
        ${a.tier === 'midi' && (a.domains || []).filter(d => Number(d) !== 1).length < 2 ? '<div class="small" style="color:var(--warn);margin-top:4px">Midi-grants must target Domain 1 plus at least two more.</div>' : ''}</div>
      <div class="span3"><label class="f">Notes (private)</label><textarea class="input" rows="2" data-t="awards" data-id="${a.id}" data-f="notes">${esc(a.notes || '')}</textarea></div>
    </div>
    ${a.proposal_id ? `<p class="small muted" style="margin:10px 0 0">Imported from the review side · <a href="#/review/admin/proposal/${a.proposal_id}">see its review scores</a></p>` : ''}
  </div>`;

  const people = `<div class="card pad"><div class="row between"><h3 class="ch">People</h3><button class="btn sm" data-a="addperson">+ Add person</button></div>
    ${ppl.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Department</th><th>Role</th><th></th></tr></thead><tbody>
      ${ppl.map(p => `<tr><td>${inp('people', p, 'name', { rr: 1 })}</td><td>${inp('people', p, 'email', { type: 'email' })}</td><td>${inp('people', p, 'department')}</td>
        <td>${sel('people', p, 'role', [['lead', 'Lead'], ['co-lead', 'Co-lead'], ['member', 'Team member']], { rr: 1 })}</td>
        <td class="r" style="white-space:nowrap">${p.email ? `<a class="btn sm ghost" href="mailto:${esc(p.email)}">Email</a>` : ''}<button class="btn sm ghost" data-del="people|${p.id}" title="Remove">✕</button></td></tr>`).join('')}
    </tbody></table></div><p class="small muted" style="margin:8px 0 0">Conditions are tracked against the lead only. Co-leads can still have their own stipend lines.</p>` : '<p class="muted small" style="margin:6px 0 0">Add the lead (and any co-leads) from the proposal\'s cover sheet.</p>'}
  </div>`;

  const conditions = `<div class="card pad"><div class="row between"><h3 class="ch">Conditions of award <span class="small muted">(${pr.met} of ${pr.total} required met)</span></h3><span>${readyBadge(a)}</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Condition</th><th class="c">Progress</th><th>Tracked from</th><th></th></tr></thead><tbody>
    ${C.map(c => `<tr ${!c.req && !c.have ? 'class="below"' : ''}><td>${esc(c.label)}${c.req ? '' : ' <span class="badge b-plain">encouraged</span>'}${c.waived ? `<div class="tiny muted">Waived${c.waiverNote ? ': ' + esc(c.waiverNote) : ''}</div>` : ''}</td>
      <td class="c">${condCell(c)} <span class="tiny muted num">${c.waived ? '' : `${c.have}/${c.need}`}</span></td>
      <td class="small muted">${esc(c.how)}${c.k === 'repository' ? `<div class="row" style="gap:6px;margin-top:4px;flex-wrap:nowrap">${chk('awards', a, 'repository_done', { rr: 1 })} ${inp('awards', a, 'repository_url', { ph: 'Repository link', w: '100%' })}</div>` : ''}
        ${c.k === 'ambassador' ? `<div class="row" style="gap:6px;margin-top:4px;flex-wrap:nowrap">${chk('awards', a, 'ambassador_done', { rr: 1 })} ${inp('awards', a, 'ambassador_note', { ph: 'What they did (e.g. dept. meeting, date)', w: '100%' })}</div>` : ''}</td>
      <td class="r">${c.waived ? `<button class="btn sm" data-unwaive="${c.k}">Remove waiver</button>` : (c.met ? '' : `<button class="btn sm ghost" data-waive="${c.k}">Waive…</button>`)}</td></tr>`).join('')}
    </tbody></table></div></div>`;

  const attendance = `<div class="card pad"><div class="row between"><h3 class="ch">Sessions (lead's attendance)</h3><a class="small" href="#/manage/sessions">Manage sessions →</a></div>
    ${sess.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Session</th><th class="c">Attended</th><th class="c">Presented</th></tr></thead><tbody>
      ${sess.map(s => { const r = att(s.id, a.id) || {}; return `<tr><td class="small num">${dshort(s.session_date)}</td><td>${esc(s.title)} <span class="badge b-plain">${esc(KINDS[s.kind])}</span>${s.counts_cop ? ' <span class="badge b-navy" title="Counts toward Community of Practice">CoP</span>' : ''}</td>
        <td class="c"><input type="checkbox" class="cbx" data-att="${s.id}|${a.id}|attended" ${r.attended ? 'checked' : ''}></td>
        <td class="c">${s.kind === 'lightning' ? `<input type="checkbox" class="cbx" data-att="${s.id}|${a.id}|presented" ${r.presented ? 'checked' : ''}>` : '<span class="cell-none">·</span>'}</td></tr>`; }).join('')}
    </tbody></table></div>` : '<p class="muted small">No sessions yet.</p>'}</div>`;

  const budget = `<div class="card pad"><div class="row between"><h3 class="ch">Budget & spending</h3><div class="row"><button class="btn sm" data-a="addline">+ Budget line</button><button class="btn sm" data-a="addexp">+ Expense</button></div></div>
    <div class="row small" style="gap:18px;margin-bottom:10px"><span>Award <strong class="num">${money(a.award_total)}</strong></span><span>Budgeted <strong class="num" style="${Math.abs(F.budgeted - num(a.award_total, 0)) > 0.5 ? 'color:var(--bad)' : ''}">${money(F.budgeted)}</strong></span>
      <span>Stipends <strong class="num">${money(F.stipend)}</strong> (${money(F.stipPaid)} paid)</span><span>Non-stipend <strong class="num">${money(F.spent)}</strong> spent of ${money(F.nonBudget)}</span></div>
    ${lines.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Category</th><th>Description</th><th class="r">Amount</th><th>Payee (stipend)</th><th>Stipend status</th><th>Status date</th><th></th></tr></thead><tbody>
      ${lines.map(l => `<tr><td>${sel('budget_lines', l, 'category', Object.entries(CATS), { rr: 1 })}</td><td>${inp('budget_lines', l, 'description')}</td>
        <td class="r">${inp('budget_lines', l, 'amount', { k: 'num0', rr: 1, w: '95px', step: 50 })}</td>
        <td>${l.category === 'stipend' ? sel('budget_lines', l, 'person_id', personOpts, { k: 'id' }) : '<span class="cell-none">·</span>'}</td>
        <td>${l.category === 'stipend' ? stipSelect(l, a) : '<span class="cell-none">·</span>'}</td>
        <td>${l.category === 'stipend' ? inp('budget_lines', l, 'status_date', { k: 'date' }) : ''}</td>
        <td class="r"><button class="btn sm ghost" data-del="budget_lines|${l.id}" title="Delete line">✕</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted small">No budget lines.</p>'}
    ${exps.length ? `<h3 style="font-size:14.5px;margin:14px 0 8px">Non-stipend expenses</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Vendor</th><th>Description</th><th>Budget line</th><th class="r">Amount</th><th>Ref.</th><th>Receipt</th><th></th></tr></thead><tbody>
      ${exps.sort((x, y) => (x.spent_on || '').localeCompare(y.spent_on || '')).map(x => `<tr><td>${inp('expenses', x, 'spent_on', { k: 'date' })}</td><td>${inp('expenses', x, 'vendor')}</td><td>${inp('expenses', x, 'description')}</td>
        <td>${sel('expenses', x, 'line_id', [['', '—']].concat(lines.filter(l => l.category !== 'stipend').map(l => [l.id, CATS[l.category] + (l.description ? ' – ' + l.description : '')])), { k: 'id' })}</td>
        <td class="r">${inp('expenses', x, 'amount', { k: 'num0', rr: 1, w: '90px' })}</td><td>${inp('expenses', x, 'reference', { w: '90px' })}</td>
        <td class="small">${x.file_path ? fileLink(x.file_path, x.file_name) : `<button class="linkbtn" data-upexp="${x.id}">Attach</button>`}</td>
        <td class="r"><button class="btn sm ghost" data-del="expenses|${x.id}" title="Delete">✕</button></td></tr>`).join('')}</tbody></table></div>` : ''}
  </div>`;

  const assessment = `<div class="card pad"><div class="row between"><h3 class="ch">Pre/post assessment</h3><button class="btn sm" data-a="addasm">+ Domain row</button></div>
    ${asm.length ? `<div class="tbl-wrap"><table class="tbl asm"><thead><tr><th>Domain</th><th>Instrument</th><th class="c">Max</th><th class="c">n pre</th><th class="c">Mean pre</th><th class="c">SD pre</th><th class="c">n post</th><th class="c">Mean post</th><th class="c">SD post</th><th class="c">Gain</th><th>Data file</th><th></th></tr></thead><tbody>
      ${asm.map(r => `<tr><td>${sel('assessments', r, 'domain', [1, 2, 3, 4, 5, 6].map(d => [d, d + '. ' + DOMAINS[d]]), { k: 'int', rr: 1, w: '185px' })}</td><td>${inp('assessments', r, 'instrument', { w: '140px' })}</td>
        ${['scale_max', 'n_pre', 'mean_pre', 'sd_pre', 'n_post', 'mean_post', 'sd_post'].map(f => `<td>${inp('assessments', r, f, { k: f.startsWith('n_') ? 'int' : 'num', rr: 1, w: '70px' })}</td>`).join('')}
        <td class="c num small">${rowGain(r) == null ? '—' : (rowGain(r) >= 0 ? '+' : '') + f1(rowGain(r)) + ' pts'}</td>
        <td class="small">${r.file_path ? fileLink(r.file_path, r.file_name) : `<button class="linkbtn" data-upasm="${r.id}">Upload</button>`}</td>
        <td class="r"><button class="btn sm ghost" data-del="assessments|${r.id}" title="Delete">✕</button></td></tr>`).join('')}
    </tbody></table></div><p class="small muted" style="margin:8px 0 0">Gain = change in mean as percentage points of the instrument's maximum. Domain 1 pre and post means complete this condition.</p>`
      : '<p class="muted small">No assessment data yet. Add a row per domain (Domain 1 is required).</p>'}</div>`;

  const deliverables = `<div class="card pad"><div class="row between"><h3 class="ch">Deliverables</h3>
      <div class="row"><select class="input sm" id="dlKind" style="width:auto">${Object.entries(DELIV).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><button class="btn sm" data-a="dlfile">Upload file</button><button class="btn sm" data-a="dllink">Add link</button></div></div>
    ${dl.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Type</th><th>File / link</th><th>Received</th><th>Notes</th><th></th></tr></thead><tbody>
      ${dl.map(x => `<tr><td>${sel('deliverables', x, 'kind', Object.entries(DELIV), { rr: 1 })}</td>
        <td class="small">${x.file_path ? fileLink(x.file_path, x.file_name) : ''}${x.url ? `${x.file_path ? ' · ' : ''}<a href="${esc(x.url)}" target="_blank" rel="noopener">link ↗</a>` : ''}</td>
        <td>${inp('deliverables', x, 'received_on', { k: 'date' })}</td><td>${inp('deliverables', x, 'notes')}</td>
        <td class="r"><button class="btn sm ghost" data-del="deliverables|${x.id}" title="Delete">✕</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted small">None yet. The final report plus a revised syllabus or assignment completes the report condition.</p>'}</div>`;

  const surveys = `<div class="card pad"><div class="row between"><h3 class="ch">Surveys</h3><a class="small" href="#/manage/surveys">Manage surveys →</a></div>
    ${M.d.surveys.length ? M.d.surveys.slice().sort((x, y) => x.sort - y.sort).map(s => { const r = M.d.survey_done.find(d => d.survey_id === s.id && d.award_id === id);
      return `<div class="row" style="padding:6px 0;border-top:1px solid #eeebe4"><label class="check" style="flex:1"><input type="checkbox" class="cbx" data-sv="${s.id}|${id}" ${r ? 'checked' : ''}> ${esc(s.name)}</label><span class="small muted">${r && r.completed_on ? 'completed ' + dshort(r.completed_on) : (s.due_date ? 'due ' + dshort(s.due_date) : '')}</span></div>`; }).join('')
      : '<p class="muted small">No surveys defined yet.</p>'}</div>`;

  const testimonials = `<div class="card pad"><div class="row between"><h3 class="ch">Testimonials</h3><button class="btn sm" data-a="addtst">+ Add</button></div>
    ${tst.length ? tst.map(t => `<div class="quote"><div>“${esc(t.quote)}”</div><div class="small muted">— ${esc(t.attribution || t.kind)} ${t.featured ? '<span class="badge b-gold">featured</span>' : ''}</div></div>`).join('') + '<p class="small muted" style="margin:6px 0 0">Edit or feature quotes on the <a href="#/manage/surveys">Surveys & testimonials</a> tab.</p>'
      : '<p class="muted small">None yet.</p>'}</div>`;

  const danger = `<div class="row noprint" style="justify-content:flex-end;margin-top:16px"><button class="btn sm danger" data-a="delaward">Delete this award</button></div>`;

  P.app.innerHTML = shell('awardees', header + `<div class="stack">${conditions}${details}${people}${attendance}${budget}${assessment}${deliverables}<div class="grid2">${surveys}${testimonials}</div></div>` + danger);
  bindAward(a);
}
function stipSelect(l, a) {
  return `<select class="input sm" data-stip="${l.id}" data-award="${a.id}">${STIP.map(([v, t]) => `<option value="${v}" ${l.stipend_status === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
}
async function setStipend(lineId, awardId, value, el) {
  const a = award(awardId);
  if (value !== 'pending' && !progress(a).ready) {
    const missing = progress(a).missing.map(c => c.label).join('; ');
    const ok = await P.confirmBox('Conditions not yet met', `${esc(a.code)} still has open conditions: <strong>${esc(missing)}</strong>. Stipends are released on completion of the conditions (RFP §6–7). Mark this stipend <em>${esc(STIP.find(s => s[0] === value)[1])}</em> anyway?`, 'Mark anyway');
    if (!ok) { if (el) el.value = (M.d.budget_lines.find(l => l.id === lineId) || {}).stipend_status || 'pending'; return; }
  }
  const row = await call(() => P.S.api.mUpdate('mgmt_budget_lines', lineId, { stipend_status: value, status_date: today() }));
  if (row) { put('mgmt_budget_lines', row); P.toast('Stipend status updated', 'ok'); rerender(); }
}
async function toggleAttendance(spec, checked) {
  const [sid, aid, field] = spec.split('|');
  const cur = att(sid, aid) || { session_id: sid, award_id: aid, attended: false, presented: false };
  const row = { session_id: sid, award_id: aid, attended: !!cur.attended, presented: !!cur.presented, [field]: checked };
  if (field === 'presented' && checked) row.attended = true;
  if (field === 'attended' && !checked) row.presented = false;
  const saved = await call(() => P.S.api.mUpsert('mgmt_attendance', row, 'session_id,award_id'));
  if (saved) {
    const i = M.d.attendance.findIndex(r => r.session_id === sid && r.award_id === aid);
    if (i >= 0) M.d.attendance[i] = saved; else M.d.attendance.push(saved);
    rerender();
  }
}
async function toggleSurvey(spec, checked) {
  const [sid, aid] = spec.split('|');
  if (checked) {
    const saved = await call(() => P.S.api.mUpsert('mgmt_survey_done', { survey_id: sid, award_id: aid, completed_on: today() }, 'survey_id,award_id'));
    if (saved) M.d.survey_done.push(saved);
  } else {
    const ok = await call(async () => { await P.S.api.mDelete('mgmt_survey_done', { survey_id: sid, award_id: aid }); return true; });
    if (ok) M.d.survey_done = M.d.survey_done.filter(r => !(r.survey_id === sid && r.award_id === aid));
  }
  rerender();
}
async function delRow(spec) {
  const [t, id] = spec.split('|');
  const labels = { people: 'this person', budget_lines: 'this budget line', expenses: 'this expense', assessments: 'this assessment row', deliverables: 'this deliverable', sessions: 'this session and its attendance', milestones: 'this milestone', surveys: 'this survey and its completion record', testimonials: 'this testimonial' };
  if (!await P.confirmBox('Delete?', `Delete ${labels[t] || 'this row'}? This can't be undone.`, 'Delete', true)) return;
  const row = M.d[t].find(r => r.id === id);
  const ok = await call(async () => { await P.S.api.mDelete('mgmt_' + t, { id }); return true; });
  if (!ok) return;
  if (row && row.file_path) P.S.api.mRemove(row.file_path).catch(() => {});
  M.loaded = false; await load(); rerender();
}
function pickFile(accept) {
  return new Promise(resolve => {
    const f = document.createElement('input'); f.type = 'file'; if (accept) f.accept = accept;
    f.onchange = () => resolve(f.files[0] || null); f.click();
  });
}
async function attachFile(t, id) {
  const file = await pickFile();
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) return P.toast('That file is over 50 MB.', 'bad');
  const path = await call(() => P.S.api.mUpload(file)); if (!path) return;
  const row = await call(() => P.S.api.mUpdate('mgmt_' + t, id, { file_path: path, file_name: file.name }));
  if (row) { put('mgmt_' + t, row); P.toast('File attached', 'ok'); rerender(); }
}
function bindAward(a) {
  bindCommon(async e => {
    const t = e.target;
    const d = t.closest('[data-del]'); if (d) return delRow(d.dataset.del);
    const ue = t.closest('[data-upexp]'); if (ue) return attachFile('expenses', ue.dataset.upexp);
    const ua = t.closest('[data-upasm]'); if (ua) return attachFile('assessments', ua.dataset.upasm);
    const w = t.closest('[data-waive]');
    if (w) {
      const c = conds(a).find(x => x.k === w.dataset.waive);
      return P.modal({ title: 'Waive: ' + c.label, ok: 'Waive', body: '<label class="f">Reason (for the record)</label><textarea class="input" id="wv" rows="3" placeholder="e.g. approved absence; equivalent session attended"></textarea>',
        onOk: async bg => { const waivers = Object.assign({}, a.waivers || {}, { [c.k]: $('#wv', bg).value.trim() }); const row = await P.S.api.mUpdate('mgmt_awards', a.id, { waivers }); put('mgmt_awards', row); rerender(); } });
    }
    const uw = t.closest('[data-unwaive]');
    if (uw) { const waivers = Object.assign({}, a.waivers || {}); delete waivers[uw.dataset.unwaive]; const row = await call(() => P.S.api.mUpdate('mgmt_awards', a.id, { waivers })); if (row) { put('mgmt_awards', row); rerender(); } return; }
    const b = t.closest('[data-a]'); if (!b) return;
    const act = b.dataset.a;
    if (act === 'addperson') {
      const hasLead = peopleOf(a.id).some(p => p.role === 'lead');
      return P.modal({ title: 'Add a person', ok: 'Add',
        body: `<div class="stack"><div><label class="f">Name</label><input class="input" id="pn"></div><div><label class="f">Email</label><input class="input" id="pe" type="email"></div>
          <div class="row" style="flex-wrap:nowrap"><div style="flex:1"><label class="f">Department</label><input class="input" id="pd" value="${esc(a.department || '')}"></div>
          <div style="flex:1"><label class="f">Role</label><select class="input" id="pr"><option value="lead" ${hasLead ? '' : 'selected'}>Lead</option><option value="co-lead" ${hasLead ? 'selected' : ''}>Co-lead</option><option value="member">Team member</option></select></div></div></div>`,
        onOk: async bg => {
          const name = $('#pn', bg).value.trim(); if (!name) throw new Error('Enter a name.');
          const p = await P.S.api.mInsert('mgmt_people', { award_id: a.id, name, email: $('#pe', bg).value.trim(), department: $('#pd', bg).value.trim(), role: $('#pr', bg).value });
          put('mgmt_people', p);
          if (p.role === 'lead') {
            for (const l of linesOf(a.id).filter(l => l.category === 'stipend' && !l.person_id)) { put('mgmt_budget_lines', await P.S.api.mUpdate('mgmt_budget_lines', l.id, { person_id: p.id })); }
            if (!a.department && p.department) put('mgmt_awards', await P.S.api.mUpdate('mgmt_awards', a.id, { department: p.department }));
          }
          rerender();
        } });
    }
    if (act === 'addline') { const l = await call(() => P.S.api.mInsert('mgmt_budget_lines', { award_id: a.id, category: 'materials', description: '', amount: 0 })); if (l) { put('mgmt_budget_lines', l); rerender(); } }
    if (act === 'addexp') return expenseModal(a.id);
    if (act === 'addasm') {
      const used = M.d.assessments.filter(r => r.award_id === a.id).map(r => Number(r.domain));
      const next = [1].concat((a.domains || []).map(Number)).find(d => !used.includes(d)) || 1;
      const r = await call(() => P.S.api.mInsert('mgmt_assessments', { award_id: a.id, domain: next, instrument: next === 1 ? 'Domain 1 common rubric' : '' }));
      if (r) { put('mgmt_assessments', r); rerender(); }
    }
    if (act === 'dlfile') {
      const kind = $('#dlKind').value; const file = await pickFile(); if (!file) return;
      const path = await call(() => P.S.api.mUpload(file)); if (!path) return;
      const r = await call(() => P.S.api.mInsert('mgmt_deliverables', { award_id: a.id, kind, file_path: path, file_name: file.name, received_on: today() }));
      if (r) { put('mgmt_deliverables', r); P.toast('Uploaded', 'ok'); rerender(); }
    }
    if (act === 'dllink') {
      const kind = $('#dlKind').value;
      return P.modal({ title: 'Add a link: ' + DELIV[kind], ok: 'Add', body: '<label class="f">URL</label><input class="input" id="dlu" placeholder="https://…">',
        onOk: async bg => { const url = $('#dlu', bg).value.trim(); if (!/^https?:\/\//i.test(url)) throw new Error('Enter a full link starting with https://'); put('mgmt_deliverables', await P.S.api.mInsert('mgmt_deliverables', { award_id: a.id, kind, url, received_on: today() })); rerender(); } });
    }
    if (act === 'addtst') return testimonialModal(a.id);
    if (act === 'delaward') {
      if (!await P.confirmBox('Delete ' + (a.code || 'this award') + '?', 'This deletes the award with its people, attendance, budget, expenses, assessment data and deliverables. Testimonials are kept but unlinked. The review-side proposal is not affected, and you can re-import it.', 'Delete award', true)) return;
      const files = [].concat(expOf(a.id), M.d.assessments.filter(r => r.award_id === a.id), M.d.deliverables.filter(r => r.award_id === a.id)).map(r => r.file_path).filter(Boolean);
      const ok = await call(async () => { await P.S.api.mDelete('mgmt_awards', { id: a.id }); return true; });
      if (ok) { files.forEach(f => P.S.api.mRemove(f).catch(() => {})); M.loaded = false; await load(); P.toast('Award deleted'); P.go('manage/awardees'); }
    }
  }, async e => {
    const t = e.target;
    if (t.dataset.att) return toggleAttendance(t.dataset.att, t.checked);
    if (t.dataset.sv) return toggleSurvey(t.dataset.sv, t.checked);
    if (t.dataset.stip) return setStipend(t.dataset.stip, t.dataset.award, t.value, t);
    if (t.dataset.dom) {
      const doms = $$('[data-dom]').filter(x => x.checked).map(x => Number(x.dataset.dom));
      const row = await call(() => P.S.api.mUpdate('mgmt_awards', a.id, { domains: doms }));
      if (row) { put('mgmt_awards', row); rerender(); }
    }
  });
}
function expenseModal(awardId) {
  const as = active();
  const lineOpts = aid => [['', '—']].concat(linesOf(aid).filter(l => l.category !== 'stipend').map(l => [l.id, CATS[l.category] + (l.description ? ' – ' + l.description : '') + ' (' + money(l.amount) + ')']));
  const opts = list => list.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  P.modal({
    title: 'Record a non-stipend expense', ok: 'Save expense',
    body: `<div class="stack">
      <div><label class="f">Award</label><select class="input" id="xa">${as.map(a => `<option value="${a.id}" ${a.id === awardId ? 'selected' : ''}>${esc(a.code)} – ${esc(a.title)}</option>`).join('')}</select></div>
      <div><label class="f">Budget line</label><select class="input" id="xl">${opts(lineOpts(awardId || (as[0] || {}).id))}</select></div>
      <div class="row" style="flex-wrap:nowrap"><div style="flex:1"><label class="f">Date</label><input class="input" id="xd" type="date" value="${today()}"></div><div style="flex:1"><label class="f">Amount ($)</label><input class="input num" id="xm" type="number" min="0" step="0.01"></div></div>
      <div><label class="f">Vendor</label><input class="input" id="xv"></div><div><label class="f">Description</label><input class="input" id="xs"></div>
      <div class="row" style="flex-wrap:nowrap"><div style="flex:1"><label class="f">Reference (PO / receipt #)</label><input class="input" id="xr"></div><div style="flex:1"><label class="f">Receipt (optional)</label><input class="input" id="xf" type="file"></div></div></div>`,
    onOk: async bg => {
      const aid = $('#xa', bg).value; const amount = Number($('#xm', bg).value || 0);
      if (!aid) throw new Error('Choose an award.'); if (!(amount > 0)) throw new Error('Enter an amount.');
      const file = $('#xf', bg).files[0];
      const path = file ? await P.S.api.mUpload(file) : null;
      put('mgmt_expenses', await P.S.api.mInsert('mgmt_expenses', { award_id: aid, line_id: $('#xl', bg).value || null, spent_on: $('#xd', bg).value || null, amount,
        vendor: $('#xv', bg).value.trim(), description: $('#xs', bg).value.trim(), reference: $('#xr', bg).value.trim(), file_path: path, file_name: file ? file.name : null }));
      P.toast('Expense recorded', 'ok'); rerender();
    }
  });
  const bg = document.querySelector('.modal-bg:last-of-type');
  $('#xa', bg).onchange = () => { $('#xl', bg).innerHTML = opts(lineOpts($('#xa', bg).value)); };
}
function testimonialModal(awardId) {
  P.modal({
    title: 'Add a testimonial', ok: 'Save',
    body: `<div class="stack"><div><label class="f">Quote</label><textarea class="input" id="tq" rows="4"></textarea></div>
      <div class="row" style="flex-wrap:nowrap"><div style="flex:1"><label class="f">From</label><select class="input" id="tk"><option value="student">Student</option><option value="faculty">Faculty / staff</option><option value="other">Other</option></select></div>
      <div style="flex:2"><label class="f">Attribution as it should appear</label><input class="input" id="ta" placeholder="e.g. First-year student, gateway biology course"></div></div>
      <div><label class="f">Project</label><select class="input" id="tw"><option value="">— none —</option>${awards().map(a => `<option value="${a.id}" ${a.id === awardId ? 'selected' : ''}>${esc(a.code)} – ${esc(a.title)}</option>`).join('')}</select></div>
      <label class="check"><input type="checkbox" class="cbx" id="tf"> Feature in the impact report</label></div>`,
    onOk: async bg => {
      const quote = $('#tq', bg).value.trim(); if (!quote) throw new Error('Paste the quote.');
      put('mgmt_testimonials', await P.S.api.mInsert('mgmt_testimonials', { quote, kind: $('#tk', bg).value, attribution: $('#ta', bg).value.trim(), award_id: $('#tw', bg).value || null, featured: $('#tf', bg).checked }));
      P.toast('Testimonial saved', 'ok'); rerender();
    }
  });
}

// ---------------------------------------------------------------- Sessions & dates
function vSessions() {
  const ss = sessions(), as = active();
  const need = talksNeeded(), slots = M.d.sessions.filter(s => s.kind === 'lightning').length * talksPer();
  const shortBy = Math.max(0, Math.ceil((need - slots) / talksPer()));
  const ms = M.d.milestones.slice().sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.sort - b.sort);
  const inner = `
    <div class="row between" style="margin-bottom:10px"><h3>Sessions</h3>
      <div class="row">${Object.entries(KINDS).map(([k, l]) => `<button class="btn sm" data-add="${k}">+ ${esc(l)}</button>`).join('')}</div></div>
    ${need ? `<div class="notice ${shortBy ? '' : 'info'}" style="margin-bottom:12px">Lightning Talks: your roster needs <strong>${need}</strong> talks (one per micro, two per midi). ${M.d.sessions.filter(s => s.kind === 'lightning').length} session(s) × ${talksPer()} talks = ${slots} slots.
      ${shortBy ? ` <button class="btn sm" data-a="addlight" data-n="${shortBy}">Add ${shortBy} more session${shortBy === 1 ? '' : 's'}</button>` : ' That covers it.'}</div>` : ''}
    ${ss.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Session</th><th>Type</th><th>Date</th><th>Time</th><th>Location / link</th><th class="c" title="Counts toward the Community of Practice requirement">CoP</th><th class="c">Attended</th><th></th></tr></thead><tbody>
      ${ss.map(s => `<tr><td>${inp('sessions', s, 'title', { rr: 1, w: '100%' })}</td><td>${sel('sessions', s, 'kind', Object.entries(KINDS), { rr: 1 })}</td>
        <td>${inp('sessions', s, 'session_date', { k: 'date', rr: 1 })}</td><td>${inp('sessions', s, 'start_time', { w: '80px', ph: '12:00' })}</td>
        <td>${inp('sessions', s, 'location', { ph: 'Room or Zoom link' })}</td><td class="c">${chk('sessions', s, 'counts_cop', { rr: 1 })}</td>
        <td class="c num small">${M.d.attendance.filter(r => r.session_id === s.id && r.attended).length}</td>
        <td class="r"><button class="btn sm ghost" data-del="sessions|${s.id}" title="Delete session">✕</button></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="card empty">No sessions.</div>'}
    <h3 style="margin:24px 0 10px">Attendance</h3>
    ${as.length && ss.length ? `<div class="tbl-wrap"><table class="tbl grid-att"><thead><tr><th>Award (lead)</th>${ss.map(s => `<th class="c" title="${esc(s.title)}"><div class="vh">${esc(s.title)}</div><div class="tiny" style="text-transform:none;letter-spacing:0">${dshort(s.session_date)}</div></th>`).join('')}</tr></thead><tbody>
      ${as.map(a => `<tr><td><strong class="num">${esc(a.code)}</strong> ${tierChip(a.tier)}<div class="tiny muted">${esc(leadName(a) || 'no lead yet')}</div></td>
        ${ss.map(s => { const r = att(s.id, a.id) || {}; return `<td class="c"><input type="checkbox" class="cbx" title="Attended" data-att="${s.id}|${a.id}|attended" ${r.attended ? 'checked' : ''}>${s.kind === 'lightning' ? `<label class="pres" title="Gave a talk"><input type="checkbox" class="cbx" data-att="${s.id}|${a.id}|presented" ${r.presented ? 'checked' : ''}>talk</label>` : ''}</td>`; }).join('')}</tr>`).join('')}
    </tbody></table></div><p class="small muted" style="margin-top:8px">Tick the lead's attendance. For Lightning Talk sessions, also tick "talk" for whoever presented (that also marks them attended).</p>` : '<p class="muted small">Add awards and sessions to record attendance.</p>'}
    <div class="row between" style="margin:24px 0 10px"><h3>Milestones</h3><button class="btn sm" data-a="addms">+ Milestone</button></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th class="c">Done</th><th>Milestone</th><th>Date</th><th>Notes</th><th></th></tr></thead><tbody>
      ${ms.map(m => `<tr ${m.done ? 'class="below"' : ''}><td class="c">${chk('milestones', m, 'done', { rr: 1 })}</td><td>${inp('milestones', m, 'title', { w: '100%' })}</td><td>${inp('milestones', m, 'due_date', { k: 'date', rr: 1 })}</td><td>${inp('milestones', m, 'notes')}</td>
        <td class="r"><button class="btn sm ghost" data-del="milestones|${m.id}">✕</button></td></tr>`).join('')}
    </tbody></table></div>`;
  P.app.innerHTML = shell('sessions', inner);
  bindCommon(async e => {
    const t = e.target;
    const d = t.closest('[data-del]'); if (d) return delRow(d.dataset.del);
    const add = t.closest('[data-add]');
    if (add) {
      const k = add.dataset.add; const n = M.d.sessions.filter(s => s.kind === k).length + 1;
      const title = { convening: 'Awardee convening', training: `AI Training ${n}`, lightning: `Lunch Lightning Talks #${n}`, watch: `Watch party ${n}`, other: 'New session' }[k];
      const r = await call(() => P.S.api.mInsert('mgmt_sessions', { kind: k, title, counts_cop: k === 'lightning' || k === 'watch' || k === 'convening', sort: 50 + M.d.sessions.length }));
      if (r) { put('mgmt_sessions', r); rerender(); }
      return;
    }
    const b = t.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'addlight') {
      const base = M.d.sessions.filter(s => s.kind === 'lightning').length;
      const rows = Array.from({ length: Number(b.dataset.n) }, (_, i) => ({ kind: 'lightning', title: `Lunch Lightning Talks #${base + i + 1}`, counts_cop: true, sort: 10 + base + i + 1 }));
      const r = await call(() => P.S.api.mInsertMany('mgmt_sessions', rows)); if (r) { r.forEach(x => put('mgmt_sessions', x)); rerender(); }
    }
    if (b.dataset.a === 'addms') { const r = await call(() => P.S.api.mInsert('mgmt_milestones', { title: 'New milestone', sort: 99 })); if (r) { put('mgmt_milestones', r); rerender(); } }
  }, async e => { if (e.target.dataset.att) return toggleAttendance(e.target.dataset.att, e.target.checked); });
}

// ---------------------------------------------------------------- Budget
function vBudget() {
  const as = active();
  const F = as.map(a => ({ a, f: fin(a) }));
  const stipLines = M.d.budget_lines.filter(l => l.category === 'stipend' && as.some(a => a.id === l.award_id))
    .sort((x, y) => byCode(award(x.award_id), award(y.award_id)));
  const exps = M.d.expenses.slice().sort((x, y) => (y.spent_on || '').localeCompare(x.spent_on || ''));
  const totals = { award: sum(as, a => a.award_total), budget: sum(F, x => x.f.budgeted), stip: sum(F, x => x.f.stipend), paid: sum(F, x => x.f.stipPaid), non: sum(F, x => x.f.nonBudget), spent: sum(F, x => x.f.spent) };
  const pipeline = STIP.map(([k, l]) => [l, sum(stipLines.filter(x => x.stipend_status === k), x => x.amount), stipLines.filter(x => x.stipend_status === k).length]);
  const inner = `
    <div class="kpis">
      <div class="kpi"><div class="v num">${money(cap())}</div><div class="l">Funds this cycle</div></div>
      <div class="kpi hl"><div class="v num">${money(totals.award)}</div><div class="l">Awarded · ${money(cap() - totals.award)} unallocated</div></div>
      <div class="kpi"><div class="v num">${money(totals.stip)}</div><div class="l">Stipends budgeted · ${money(totals.paid)} paid</div></div>
      <div class="kpi"><div class="v num">${money(totals.spent)}</div><div class="l">Non-stipend spent of ${money(totals.non)}</div><div class="bar"><i style="width:${totals.non ? Math.min(100, Math.round(100 * totals.spent / totals.non)) : 0}%;background:${totals.spent > totals.non ? 'var(--bad)' : 'var(--ok)'}"></i></div></div>
    </div>
    <div class="row between" style="margin-bottom:10px"><h3>Stipend pipeline</h3><div class="row small muted">${pipeline.map(([l, amt, n]) => `<span>${esc(l)}: <strong class="num">${n}</strong> (${money(amt)})</span>`).join(' · ')}</div></div>
    ${stipLines.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Award</th><th>Payee</th><th class="r">Amount</th><th>Conditions</th><th>Status</th><th>Status date</th></tr></thead><tbody>
      ${stipLines.map(l => { const a = award(l.award_id); const p = M.d.people.find(x => x.id === l.person_id);
        return `<tr><td><a href="#/manage/award/${a.id}"><strong class="num">${esc(a.code)}</strong></a> ${tierChip(a.tier)}</td><td class="small">${p ? esc(p.name) : '<span class="badge b-warn">set payee</span>'}</td>
          <td class="r num">${money(l.amount)}</td><td>${readyBadge(a)}</td><td>${stipSelect(l, a)}</td><td>${inp('budget_lines', l, 'status_date', { k: 'date' })}</td></tr>`; }).join('')}
    </tbody></table></div><p class="small muted" style="margin-top:8px">Stipends are paid through payroll in early summer 2027 on completion of the conditions; they are subject to summer taxes and fringe (RFP Appendix A).</p>` : '<div class="card empty small">No stipend lines yet.</div>'}
    <div class="row between" style="margin:24px 0 10px"><h3>By award</h3><button class="btn sm" data-a="csvlines">Budget lines CSV</button></div>
    ${F.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Award</th><th class="r">Award</th><th class="r">Budgeted</th><th class="r">Stipends</th><th class="r">Non-stipend budget</th><th class="r">Spent</th><th class="r">Remaining</th></tr></thead><tbody>
      ${F.map(({ a, f }) => `<tr class="click" data-open="${a.id}"><td><strong class="num">${esc(a.code)}</strong> <span class="small muted">${esc(leadName(a))}</span></td><td class="r num">${money(a.award_total)}</td>
        <td class="r num ${Math.abs(f.budgeted - num(a.award_total, 0)) > 0.5 ? 'hot' : ''}">${money(f.budgeted)}</td><td class="r num">${money(f.stipend)}</td><td class="r num">${money(f.nonBudget)}</td>
        <td class="r num ${f.spent > f.nonBudget + 0.5 ? 'hot' : ''}">${money(f.spent)}</td><td class="r num">${money(f.nonBudget - f.spent)}</td></tr>`).join('')}
      <tr><td><strong>Total</strong></td><td class="r num"><strong>${money(totals.award)}</strong></td><td class="r num"><strong>${money(totals.budget)}</strong></td><td class="r num"><strong>${money(totals.stip)}</strong></td><td class="r num"><strong>${money(totals.non)}</strong></td><td class="r num"><strong>${money(totals.spent)}</strong></td><td class="r num"><strong>${money(totals.non - totals.spent)}</strong></td></tr>
    </tbody></table></div><p class="small muted" style="margin-top:8px">Highlighted: budget lines that don't add up to the award, or spending over the non-stipend budget.</p>` : ''}
    <div class="row between" style="margin:24px 0 10px"><h3>Expense log</h3><div class="row"><button class="btn sm primary" data-a="addexp">+ Record expense</button><button class="btn sm" data-a="csvexp">Expenses CSV</button></div></div>
    ${exps.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Award</th><th>Vendor</th><th>Description</th><th class="r">Amount</th><th>Ref.</th><th>Receipt</th><th></th></tr></thead><tbody>
      ${exps.map(x => { const a = award(x.award_id) || {}; return `<tr><td class="small num">${dshort(x.spent_on)}</td><td><a href="#/manage/award/${a.id}">${esc(a.code || '—')}</a></td><td class="small">${esc(x.vendor)}</td><td class="small">${esc(x.description)}</td>
        <td class="r num">${money(x.amount)}</td><td class="small">${esc(x.reference)}</td><td class="small">${x.file_path ? fileLink(x.file_path, x.file_name) : `<button class="linkbtn" data-upexp="${x.id}">Attach</button>`}</td>
        <td class="r"><button class="btn sm ghost" data-del="expenses|${x.id}">✕</button></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="card empty small">No expenses recorded.</div>'}`;
  P.app.innerHTML = shell('budget', inner);
  bindCommon(async e => {
    const t = e.target;
    const o = t.closest('[data-open]'); if (o) return P.go('manage/award/' + o.dataset.open);
    const d = t.closest('[data-del]'); if (d) return delRow(d.dataset.del);
    const ue = t.closest('[data-upexp]'); if (ue) return attachFile('expenses', ue.dataset.upexp);
    const b = t.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'addexp') { if (!active().length) return P.toast('Add an award first.', 'bad'); return expenseModal(null); }
    if (b.dataset.a === 'csvlines') return exportLines();
    if (b.dataset.a === 'csvexp') return exportExpenses();
  }, e => { if (e.target.dataset.stip) return setStipend(e.target.dataset.stip, e.target.dataset.award, e.target.value, e.target); });
}

// ---------------------------------------------------------------- Assessment
function domainSummary() {
  const out = {};
  [1, 2, 3, 4, 5, 6].forEach(d => { out[d] = asmStats(M.d.assessments.filter(r => Number(r.domain) === d && active().some(a => a.id === r.award_id))); });
  return out;
}
function vAssessment() {
  const S = domainSummary();
  const as = active();
  const missingD1 = as.filter(a => !M.d.assessments.some(r => r.award_id === a.id && Number(r.domain) === 1 && r.mean_pre != null && r.mean_post != null));
  const rows = M.d.assessments.filter(r => as.some(a => a.id === r.award_id)).sort((x, y) => byCode(award(x.award_id), award(y.award_id)) || x.domain - y.domain);
  const inner = `
    <div class="card pad" style="margin-bottom:16px"><h3 class="ch">Pre vs. post by domain</h3>${gainsChart(S)}</div>
    <div class="tbl-wrap" style="margin-bottom:8px"><table class="tbl"><thead><tr><th>Domain</th><th class="c">Projects</th><th class="c">Students (post n)</th><th class="c">Pre</th><th class="c">Post</th><th class="c">Change</th><th class="c" title="Hake normalized gain: (post − pre) / (100 − pre)">Normalized gain</th><th class="c" title="Cohen's d from pooled SDs, n-weighted across projects">Effect size d</th></tr></thead><tbody>
      ${[1, 2, 3, 4, 5, 6].map(d => { const s = S[d]; return `<tr ${s ? '' : 'class="below"'}><td>${d}. ${esc(DOMAINS[d])}</td><td class="c num">${s ? s.projects : 0}</td><td class="c num">${s ? s.students : '—'}</td>
        <td class="c num">${s ? pct(s.pre) : '—'}</td><td class="c num">${s ? pct(s.post) : '—'}</td><td class="c num">${s ? (s.gain >= 0 ? '+' : '') + f1(s.gain) + ' pts' : '—'}</td>
        <td class="c num">${s && s.g != null ? f2(s.g) : '—'}</td><td class="c num">${s && s.d != null ? f2(s.d) : '—'}</td></tr>`; }).join('')}
    </tbody></table></div>
    <p class="small muted">Scores are converted to % of each instrument's maximum so different instruments can be pooled; means are weighted by n. Effect size needs SDs for both pre and post. Treat pooled numbers across different instruments as descriptive.</p>
    ${missingD1.length ? `<div class="notice" style="margin:14px 0">Missing Domain 1 pre/post data: ${missingD1.map(a => `<a href="#/manage/award/${a.id}">${esc(a.code)}</a>`).join(', ')}</div>` : ''}
    <div class="row between" style="margin:20px 0 10px"><h3>All assessment data</h3><button class="btn sm" data-a="csv">Assessment CSV</button></div>
    ${rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Award</th><th>Domain</th><th>Instrument</th><th class="c">Max</th><th class="c">Pre (n)</th><th class="c">Post (n)</th><th class="c">Gain</th><th>File</th></tr></thead><tbody>
      ${rows.map(r => { const a = award(r.award_id); return `<tr class="click" data-open="${a.id}"><td><strong class="num">${esc(a.code)}</strong></td><td class="small">${r.domain}. ${esc(DOMAINS[r.domain])}</td><td class="small">${esc(r.instrument)}</td><td class="c num">${r.scale_max ?? '—'}</td>
        <td class="c num">${r.mean_pre ?? '—'} <span class="muted small">(${r.n_pre ?? '—'})</span></td><td class="c num">${r.mean_post ?? '—'} <span class="muted small">(${r.n_post ?? '—'})</span></td>
        <td class="c num">${rowGain(r) == null ? '—' : (rowGain(r) >= 0 ? '+' : '') + f1(rowGain(r)) + ' pts'}</td><td class="small">${r.file_path ? fileLink(r.file_path, r.file_name) : ''}</td></tr>`; }).join('')}</tbody></table></div><p class="small muted" style="margin-top:8px">Enter or edit data on each award's page.</p>`
      : '<div class="card empty small">No assessment data yet. Enter it on each award\'s page.</div>'}`;
  P.app.innerHTML = shell('assessment', inner);
  bindCommon(e => {
    const o = e.target.closest('[data-open]'); if (o && !e.target.closest('[data-file]')) return P.go('manage/award/' + o.dataset.open);
    const b = e.target.closest('[data-a]'); if (b && b.dataset.a === 'csv') exportAssessments();
  });
}

// ---------------------------------------------------------------- Surveys & testimonials
function vSurveys() {
  const sv = M.d.surveys.slice().sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const as = active();
  const tst = M.d.testimonials.slice().sort((a, b) => (b.featured - a.featured) || String(b.created_at).localeCompare(String(a.created_at)));
  const inner = `
    <div class="row between" style="margin-bottom:10px"><h3>Surveys</h3><button class="btn sm" data-a="addsv">+ Survey</button></div>
    ${sv.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Survey</th><th>Due</th><th>Link (Forms etc.)</th><th class="c">Completed</th><th></th></tr></thead><tbody>
      ${sv.map(s => `<tr><td>${inp('surveys', s, 'name', { w: '100%', rr: 1 })}</td><td>${inp('surveys', s, 'due_date', { k: 'date', rr: 1 })}</td><td>${inp('surveys', s, 'link', { ph: 'https://forms…' })}${s.link ? ` <a class="small" href="${esc(s.link)}" target="_blank" rel="noopener">open ↗</a>` : ''}</td>
        <td class="c num">${M.d.survey_done.filter(d => d.survey_id === s.id && as.some(a => a.id === d.award_id)).length} / ${as.length}</td><td class="r"><button class="btn sm ghost" data-del="surveys|${s.id}">✕</button></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="card empty small">No surveys yet.</div>'}
    ${sv.length && as.length ? `<h3 style="margin:22px 0 10px">Completion</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Award (lead)</th>${sv.map(s => `<th class="c" title="${esc(s.name)}"><div class="vh">${esc(s.name)}</div></th>`).join('')}</tr></thead><tbody>
      ${as.map(a => `<tr><td><strong class="num">${esc(a.code)}</strong> <span class="small muted">${esc(leadName(a))}</span></td>${sv.map(s => { const r = M.d.survey_done.find(d => d.survey_id === s.id && d.award_id === a.id);
        return `<td class="c"><input type="checkbox" class="cbx" data-sv="${s.id}|${a.id}" ${r ? 'checked' : ''} title="${r && r.completed_on ? 'Completed ' + dshort(r.completed_on) : 'Not completed'}"></td>`; }).join('')}</tr>`).join('')}
    </tbody></table></div>` : ''}
    <div class="row between" style="margin:26px 0 10px"><h3>Testimonials</h3><div class="row"><button class="btn sm primary" data-a="addtst">+ Testimonial</button><button class="btn sm" data-a="csv">Testimonials CSV</button></div></div>
    ${tst.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="c" title="Feature in the impact report">★</th><th>Quote</th><th>Attribution</th><th>From</th><th>Project</th><th></th></tr></thead><tbody>
      ${tst.map(t => `<tr><td class="c">${chk('testimonials', t, 'featured', { rr: 1 })}</td><td style="min-width:300px"><textarea class="input sm" rows="2" data-t="testimonials" data-id="${t.id}" data-f="quote">${esc(t.quote)}</textarea></td>
        <td>${inp('testimonials', t, 'attribution')}</td><td>${sel('testimonials', t, 'kind', [['student', 'Student'], ['faculty', 'Faculty / staff'], ['other', 'Other']])}</td>
        <td>${sel('testimonials', t, 'award_id', [['', '—']].concat(awards().map(a => [a.id, a.code || a.title])), { k: 'id' })}</td>
        <td class="r"><button class="btn sm ghost" data-del="testimonials|${t.id}">✕</button></td></tr>`).join('')}</tbody></table></div><p class="small muted" style="margin-top:8px">★ featured quotes appear in the printable impact report and are offered to the AI narrative.</p>`
      : '<div class="card empty small">Paste standout quotes from survey responses here as they come in.</div>'}`;
  P.app.innerHTML = shell('surveys', inner);
  bindCommon(async e => {
    const d = e.target.closest('[data-del]'); if (d) return delRow(d.dataset.del);
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'addsv') { const r = await call(() => P.S.api.mInsert('mgmt_surveys', { name: 'New survey', sort: M.d.surveys.length + 1 })); if (r) { put('mgmt_surveys', r); rerender(); } }
    if (b.dataset.a === 'addtst') return testimonialModal(null);
    if (b.dataset.a === 'csv') return exportTestimonials();
  }, e => { if (e.target.dataset.sv) return toggleSurvey(e.target.dataset.sv, e.target.checked); });
}

// ---------------------------------------------------------------- Reminders
function remindModal() {
  const keys = [['training', 'AI training series'], ['talks', 'Lightning Talk(s)'], ['cop', 'Community of Practice events (midi)'], ['assessment', 'Pre/post assessment (Domain 1)'],
    ['surveys', 'Initiative surveys'], ['report', 'Final report + syllabus/assignment'], ['repository', 'Repository deposit'], ['ambassador', 'AI Ambassador (midi)'], ['all', 'Anything still open']];
  const missing = k => active().filter(a => conds(a).some(c => c.req && !c.met && (k === 'all' || c.k === k)));
  const build = k => {
    const list = missing(k);
    const people = list.map(a => ({ a, l: leadOf(a.id) }));
    const emails = people.filter(x => x.l && x.l.email).map(x => x.l.email);
    const noEmail = people.filter(x => !x.l || !x.l.email).map(x => x.a.code);
    const label = (keys.find(x => x[0] === k) || ['', ''])[1];
    const subject = `Innovations with AI: ${k === 'all' ? 'conditions of award' : label} reminder`;
    const body = `Hello,\n\nA quick reminder from the Innovations with AI initiative: our records show ${k === 'all' ? 'some conditions of your award still open' : `"${label}" still open for your project`}.\n\nStipends are released in early summer 2027 once all conditions of award are complete. If you think our records are wrong, or you need help, just reply to this email.\n\nThank you,\n${P.S.me.display_name || 'Tom Mennella'}\nInitiative Coordinator`;
    return { list, emails, noEmail, subject, body };
  };
  P.modal({
    title: 'Email reminders', wide: true, ok: null, cancel: 'Close',
    body: `<div class="stack"><div><label class="f">Who hasn't completed…</label><select class="input" id="rk">${keys.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
      <div id="rbody"></div></div>`
  });
  const bg = document.querySelector('.modal-bg:last-of-type');
  const paint = () => {
    const k = $('#rk', bg).value; const r = build(k);
    $('#rbody', bg).innerHTML = r.list.length ? `
      <div class="small"><strong>${r.list.length}</strong> award${r.list.length === 1 ? '' : 's'}: ${r.list.map(a => esc(a.code)).join(', ')}${r.noEmail.length ? ` <span class="badge b-warn">no lead email: ${r.noEmail.map(esc).join(', ')}</span>` : ''}</div>
      <div><label class="f" style="margin-top:8px">To (BCC)</label><div class="codebox" id="rto">${esc(r.emails.join(', ')) || '—'}</div></div>
      <div><label class="f" style="margin-top:8px">Subject</label><input class="input" id="rsub" value="${esc(r.subject)}"></div>
      <div><label class="f" style="margin-top:8px">Message</label><textarea class="input" id="rmsg" rows="9">${esc(r.body)}</textarea></div>
      <div class="row" style="margin-top:10px"><button class="btn" id="rcopyto">Copy addresses</button><button class="btn" id="rcopymsg">Copy message</button>${r.emails.length ? '<button class="btn primary" id="rmail">Open in mail app</button>' : ''}</div>`
      : '<div class="notice info">Everyone has completed this. Nothing to send.</div>';
    const q = s => $(s, bg);
    if (q('#rcopyto')) q('#rcopyto').onclick = () => P.copyText(r.emails.join(', '));
    if (q('#rcopymsg')) q('#rcopymsg').onclick = () => P.copyText(q('#rmsg').value);
    if (q('#rmail')) q('#rmail').onclick = () => { location.href = `mailto:?bcc=${encodeURIComponent(r.emails.join(','))}&subject=${encodeURIComponent(q('#rsub').value)}&body=${encodeURIComponent(q('#rmsg').value)}`; };
  };
  $('#rk', bg).onchange = paint; paint();
}

// ---------------------------------------------------------------- Reports
function reportData() {
  const as = active();
  const F = as.map(fin);
  const byCollege = {};
  as.forEach(a => { const c = a.college || '—'; byCollege[c] = byCollege[c] || { n: 0, amt: 0, students: 0 }; byCollege[c].n++; byCollege[c].amt += num(a.award_total, 0); byCollege[c].students += num(a.students_reached ?? a.students_planned, 0); });
  const condRate = {};
  ['training', 'talks', 'cop', 'assessment', 'surveys', 'report', 'repository', 'ambassador'].forEach(k => {
    const req = as.filter(a => conds(a).find(c => c.k === k).req);
    condRate[k] = { met: req.filter(a => conds(a).find(c => c.k === k).met).length, of: req.length };
  });
  return {
    as, byCollege, condRate, domains: domainSummary(),
    awarded: sum(as, a => a.award_total), stip: sum(F, f => f.stipend), paid: sum(F, f => f.stipPaid), non: sum(F, f => f.nonBudget), spent: sum(F, f => f.spent),
    planned: sum(as, a => a.students_planned), reached: sum(as, a => a.students_reached), ready: as.filter(a => progress(a).ready).length,
    featured: M.d.testimonials.filter(t => t.featured)
  };
}
function vReports() {
  const key = ls.get(KEY_STORE);
  const draft = ls.get(NARR_STORE);
  const inner = `
    <div class="grid2">
      <div class="card pad stack"><h3>Printable impact report</h3>
        <p class="small muted" style="margin:0">Headline numbers, every project, conditions completed, pre/post gains by domain, budget, featured testimonials, and your narrative (if drafted). Print it or save it as a PDF from your browser.</p>
        <div><a class="btn primary" href="#/manage/report">Open impact report</a></div></div>
      <div class="card pad stack"><h3>Spreadsheets (CSV)</h3>
        <div class="row" style="gap:6px">${[['roster', 'Roster & people'], ['conditions', 'Conditions status'], ['attendance', 'Attendance'], ['lines', 'Budget lines'], ['expenses', 'Expenses'], ['assessments', 'Assessment data'], ['surveys', 'Survey completion'], ['testimonials', 'Testimonials']].map(([k, l]) => `<button class="btn sm" data-csv="${k}">${l}</button>`).join('')}</div></div>
    </div>
    <div class="card pad stack" style="margin-top:16px">
      <div class="row between"><h3>Donor narrative (AI draft)</h3><span class="small muted">${key ? 'API key saved in this browser' : '<a href="#/manage/settings">Add your Anthropic API key in Settings</a>'}</span></div>
      <p class="small muted" style="margin:0">Claude drafts a narrative for ${esc(donor())} from the portal's numbers: projects (code, title, college, tier), students, conditions, assessment gains, spending and featured quotes. <strong>No names or email addresses are sent.</strong> Always check every number against the dashboard before you send it.</p>
      <div><label class="f">Anything to emphasize (optional)</label><input class="input" id="nEmph" placeholder="e.g. first-year reach; plans to scale in 2027–28"></div>
      <div class="row"><button class="btn primary" data-a="draft" ${key ? '' : 'disabled'}>Draft narrative</button><span class="small muted" id="nState"></span></div>
      <textarea class="input" id="nOut" rows="16" placeholder="The draft appears here. You can edit it; edits are kept in this browser and used in the printable report.">${esc(draft)}</textarea>
      <div class="row"><button class="btn sm" data-a="copy">Copy</button><button class="btn sm" data-a="dl">Download .txt</button><button class="btn sm ghost" data-a="clear">Clear</button></div>
    </div>`;
  P.app.innerHTML = shell('reports', inner);
  bindCommon(async e => {
    const c = e.target.closest('[data-csv]');
    if (c) return ({ roster: exportRoster, conditions: exportConditions, attendance: exportAttendance, lines: exportLines, expenses: exportExpenses, assessments: exportAssessments, surveys: exportSurveys, testimonials: exportTestimonials })[c.dataset.csv]();
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'draft') return draftNarrative(b);
    if (b.dataset.a === 'copy') return P.copyText($('#nOut').value);
    if (b.dataset.a === 'dl') return P.download(`impact-narrative-${P.stamp()}.txt`, $('#nOut').value, 'text/plain');
    if (b.dataset.a === 'clear') { $('#nOut').value = ''; ls.set(NARR_STORE, ''); }
  });
  P.app.oninput = e => { if (e.target.id === 'nOut') ls.set(NARR_STORE, e.target.value); };
}
async function draftNarrative(btn) {
  const key = ls.get(KEY_STORE); if (!key) return P.toast('Add your API key in Settings first.', 'bad');
  const R = reportData();
  const payload = {
    program: 'Innovations with AI: Micro- and Midi-Grants Initiative', institution: P.CFG.INSTITUTION || 'Western New England University', cycle: cycle(), donor: donor(),
    funds_available: cap(), total_awarded: R.awarded, stipends_budgeted: R.stip, stipends_paid: R.paid, non_stipend_budget: R.non, non_stipend_spent: R.spent,
    awards: R.as.length, micro: R.as.filter(a => a.tier === 'micro').length, midi: R.as.filter(a => a.tier === 'midi').length,
    students_planned: R.planned, students_reached_reported: R.reached, awards_ready_for_stipend: R.ready,
    by_college: R.byCollege, conditions_completion: R.condRate,
    assessment_by_domain: Object.fromEntries(Object.entries(R.domains).filter(([, s]) => s).map(([d, s]) => [d + '. ' + DOMAINS[d], { projects: s.projects, students_post_n: s.students, pre_pct: Math.round(s.pre), post_pct: Math.round(s.post), normalized_gain: s.g == null ? null : Math.round(s.g * 100) / 100, effect_size_d: s.d == null ? null : Math.round(s.d * 100) / 100 }])),
    projects: R.as.map(a => ({ code: a.code, title: a.title, college: a.college, tier: a.tier, course: a.course_info, domains: (a.domains || []).map(d => DOMAINS[d]), students_planned: a.students_planned, students_reached: a.students_reached,
      domain_gains_pct_points: M.d.assessments.filter(r => r.award_id === a.id && rowGain(r) != null).map(r => ({ domain: r.domain, gain: Math.round(rowGain(r) * 10) / 10 })) })),
    featured_quotes: R.featured.map(t => ({ quote: t.quote, from: t.attribution || t.kind }))
  };
  const emph = $('#nEmph').value.trim();
  const prompt = `You are helping the coordinator of a university faculty mini-grant program write the narrative section of a donor impact report. The donor funded the program; the tone is grateful, concrete and professional, not promotional.

Write 600–900 words with short headings: an opening thank-you and summary, what was funded, who it reached, what students gained (use the assessment numbers carefully and explain them in plain language), how faculty participated (conditions of award), stewardship of funds, a few featured student or faculty voices (quote them exactly), and what comes next.

Rules: use ONLY the numbers in the data below; never invent figures, names or outcomes. Where data is missing or zero because the term is still under way, say so plainly or insert [TBD: …]. Do not name individual faculty. Normalized gain is (post − pre)/(100 − pre); effect size d is Cohen's d. Output plain text with headings, no markdown tables.${emph ? `\n\nThe coordinator asks you to emphasize: ${emph}` : ''}

DATA (JSON):
${JSON.stringify(payload, null, 2)}`;
  btn.disabled = true; $('#nState').textContent = 'Drafting… (20–60 seconds)';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: ls.get(MODEL_STORE) || 'claude-sonnet-5-5', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && data.error.message) || `HTTP ${res.status}`);
    const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    $('#nOut').value = text; ls.set(NARR_STORE, text);
    $('#nState').textContent = 'Done. Check every number before using it.';
  } catch (err) { $('#nState').textContent = ''; P.toast('Draft failed: ' + err.message, 'bad'); }
  btn.disabled = false;
}
function vReport() {
  const R = reportData();
  const narrative = ls.get(NARR_STORE);
  const condLabels = { training: 'AI training series', talks: 'Lightning Talks', cop: 'Community of Practice (midi)', assessment: 'Pre/post assessment', surveys: 'Surveys', report: 'Final report & materials', repository: 'Repository deposit', ambassador: 'AI Ambassador (midi)' };
  P.app.innerHTML = `<div class="wrap report">
    <div class="row between noprint" style="margin-bottom:16px"><a href="#/manage/reports">← Reports</a><button class="btn primary" onclick="window.print()">Print / save as PDF</button></div>
    <div class="eyebrow">${esc(P.CFG.INSTITUTION || '')}</div>
    <h1 style="margin:6px 0 4px">Innovations with AI — Impact Report</h1>
    <p class="muted" style="margin:0 0 4px">${esc(cycle())} cycle · supported by ${esc(donor())}</p>
    <p class="small muted" style="margin:0 0 18px">Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
    <div class="kpis">
      <div class="kpi"><div class="v num">${R.as.length}</div><div class="l">Projects funded (${R.as.filter(a => a.tier === 'micro').length} micro, ${R.as.filter(a => a.tier === 'midi').length} midi)</div></div>
      <div class="kpi"><div class="v num">${(R.reached || R.planned).toLocaleString()}</div><div class="l">${R.reached ? `Students reached so far (${R.as.filter(a => a.students_reached != null).length} of ${R.as.length} projects reporting; ${R.planned.toLocaleString()} planned)` : 'Students planned (none reported yet)'}</div></div>
      <div class="kpi"><div class="v num">${money(R.awarded)}</div><div class="l">Awarded of ${money(cap())}</div></div>
      <div class="kpi"><div class="v num">${Object.keys(R.byCollege).filter(k => k !== '—').length}</div><div class="l">Colleges / schools represented</div></div>
    </div>
    ${narrative ? `<section class="rsec"><h2>Narrative</h2><div class="narr">${esc(narrative).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>').replace(/^/, '<p>') + '</p>'}</div></section>` : ''}
    <section class="rsec"><h2>Student gains</h2>${gainsChart(R.domains)}
      <table class="tbl" style="margin-top:10px"><thead><tr><th>Domain</th><th class="c">Projects</th><th class="c">Students</th><th class="c">Pre</th><th class="c">Post</th><th class="c">Norm. gain</th><th class="c">Effect size d</th></tr></thead><tbody>
      ${Object.entries(R.domains).filter(([, s]) => s).map(([d, s]) => `<tr><td>${d}. ${esc(DOMAINS[d])}</td><td class="c num">${s.projects}</td><td class="c num">${s.students}</td><td class="c num">${pct(s.pre)}</td><td class="c num">${pct(s.post)}</td><td class="c num">${s.g == null ? '—' : f2(s.g)}</td><td class="c num">${s.d == null ? '—' : f2(s.d)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No pre/post data yet.</td></tr>'}</tbody></table></section>
    <section class="rsec"><h2>Projects</h2><table class="tbl"><thead><tr><th>Project</th><th>College</th><th>Tier</th><th>Lead</th><th class="r">Award</th><th class="r">Students</th><th>Conditions</th></tr></thead><tbody>
      ${R.as.map(a => { const p = progress(a); return `<tr><td><strong>${esc(a.code)}</strong> ${esc(a.title)}</td><td class="small">${esc(a.college)}</td><td>${a.tier === 'midi' ? 'Midi' : 'Micro'}</td><td class="small">${esc(leadName(a))}</td><td class="r num">${money(a.award_total)}</td><td class="r num">${a.students_reached ?? (a.students_planned != null ? a.students_planned + ' (planned)' : '—')}</td><td class="small">${p.met}/${p.total}</td></tr>`; }).join('')}</tbody></table></section>
    <div class="grid2">
      <section class="rsec"><h2>Participation</h2><table class="tbl"><tbody>${Object.entries(R.condRate).map(([k, v]) => `<tr><td>${esc(condLabels[k])}</td><td class="r num">${v.met} of ${v.of}</td></tr>`).join('')}</tbody></table></section>
      <section class="rsec"><h2>Funds</h2><table class="tbl"><tbody>
        <tr><td>Available</td><td class="r num">${money(cap())}</td></tr><tr><td>Awarded</td><td class="r num">${money(R.awarded)}</td></tr>
        <tr><td>Faculty stipends (paid)</td><td class="r num">${money(R.stip)} (${money(R.paid)})</td></tr><tr><td>Non-stipend spent / budgeted</td><td class="r num">${money(R.spent)} / ${money(R.non)}</td></tr>
        ${Object.entries(R.byCollege).map(([c, v]) => `<tr><td class="small muted">${esc(c)}: ${v.n} award${v.n === 1 ? '' : 's'}</td><td class="r num small muted">${money(v.amt)}</td></tr>`).join('')}</tbody></table></section>
    </div>
    ${R.featured.length ? `<section class="rsec"><h2>In their words</h2>${R.featured.map(t => `<div class="quote big"><div>“${esc(t.quote)}”</div><div class="small muted">— ${esc(t.attribution || t.kind)}</div></div>`).join('')}</section>` : ''}
  </div>`;
  P.app.onclick = P.app.onchange = P.app.oninput = null;
}

// ---------------------------------------------------------------- Settings
function vSettings() {
  const key = ls.get(KEY_STORE);
  const inner = `
    <div class="grid2">
      <div class="card pad stack"><h3>Cycle & requirements</h3>
        <div><label class="f">Cycle name</label><input class="input" data-set="mgmt_cycle" value="${esc(cycle())}"></div>
        <div><label class="f">Donor (for reports)</label><input class="input" data-set="mgmt_donor" value="${esc(donor())}"></div>
        <div class="row" style="flex-wrap:nowrap"><div style="flex:1"><label class="f">Trainings required</label><input class="input num" type="number" min="0" data-set="mgmt_req_training" data-num value="${reqTraining()}"></div>
          <div style="flex:1"><label class="f">CoP events required (midi)</label><input class="input num" type="number" min="0" data-set="mgmt_req_cop" data-num value="${reqCop()}"></div>
          <div style="flex:1"><label class="f">Talks per session</label><input class="input num" type="number" min="1" data-set="mgmt_talks_per_session" data-num value="${talksPer()}"></div></div>
        <p class="small muted" style="margin:0">RFP §7: up to three one-hour trainings; Lightning Talks are ten minutes in a one-hour session; midi awardees attend up to five CoP events. Budget cap and college list are shared with the review side's Settings.</p></div>
      <div class="card pad stack"><h3>AI narrative</h3>
        <div><label class="f">Anthropic API key</label><div class="row" style="flex-wrap:nowrap"><input class="input" id="apikey" type="password" placeholder="sk-ant-…" value="${esc(key)}" autocomplete="off"><button class="btn" data-a="savekey">Save</button></div>
          <div class="small muted" style="margin-top:4px">Stored only in this browser, never in the database. ${key ? '<button class="linkbtn" data-a="forget">Forget key</button>' : ''}</div></div>
        <div><label class="f">Model</label><input class="input" id="apimodel" value="${esc(ls.get(MODEL_STORE) || 'claude-sonnet-5-5')}"></div></div>
      <div class="card pad stack"><h3>Management password</h3>
        <div class="row" style="flex-wrap:nowrap"><input class="input" type="password" id="mgpw2" autocomplete="new-password" placeholder="New password (8+ characters)"><button class="btn" data-a="mgpw">Change</button></div>
        <p class="small muted" style="margin:0">The second lock on this side. Unlocks last 12 hours; use <strong>Lock</strong> (top right) when you step away.</p></div>
      <div class="card pad stack"><h3>Standard sessions</h3>
        <p class="small muted" style="margin:0">The convening, three trainings, Lightning Talk sessions, RFP milestones and final survey were added automatically the first time you opened this side. If you deleted them and want them back:</p>
        <div><button class="btn" data-a="reseed">Add the RFP sessions & milestones again</button></div></div>
    </div>`;
  P.app.innerHTML = shell('settings', inner);
  bindCommon(async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'savekey') { ls.set(KEY_STORE, $('#apikey').value.trim()); ls.set(MODEL_STORE, $('#apimodel').value.trim()); P.toast('Saved in this browser', 'ok'); rerender(); }
    if (b.dataset.a === 'forget') { ls.set(KEY_STORE, ''); P.toast('Key removed from this browser'); rerender(); }
    if (b.dataset.a === 'mgpw') { const v = $('#mgpw2').value; if (v.length < 8) return P.toast('Use at least 8 characters.', 'bad'); const ok = await call(async () => { await P.S.api.setMgmtPassword(v); return true; }); if (ok) { $('#mgpw2').value = ''; P.toast('Management password changed', 'ok'); } }
    if (b.dataset.a === 'reseed') { if (await P.confirmBox('Add the standard sessions again?', 'This adds the convening, three trainings, Lightning Talk sessions, milestones and the final survey. Existing ones are not removed, so you may get duplicates.', 'Add them')) { await call(seedShells); rerender(); } }
  }, async e => {
    const t = e.target; if (!t.dataset.set) return;
    const v = t.hasAttribute('data-num') ? Number(t.value) : t.value.trim();
    const ok = await call(async () => { await P.S.api.saveSetting(t.dataset.set, v); return true; });
    if (ok) { st()[t.dataset.set] = v; P.toast('Saved', 'ok'); }
  });
}

// ---------------------------------------------------------------- CSV exports
const dl = (name, rows) => P.download(`ai-grants-${name}-${P.stamp()}.csv`, P.csv(rows));
function exportRoster() {
  const rows = [['Code', 'Title', 'Tier', 'Status', 'College', 'Department', 'Award', 'Course', 'Domains', 'Students planned', 'Students reached', 'Person', 'Role', 'Email', 'Person department', 'Repository URL']];
  awards().forEach(a => {
    const ppl = peopleOf(a.id);
    (ppl.length ? ppl : [{}]).forEach(p => rows.push([a.code, a.title, a.tier, a.status, a.college, a.department, a.award_total, a.course_info, (a.domains || []).join(' '), a.students_planned ?? '', a.students_reached ?? '', p.name || '', p.role || '', p.email || '', p.department || '', a.repository_url]));
  });
  dl('roster', rows);
}
function exportConditions() {
  const keys = ['training', 'talks', 'cop', 'assessment', 'surveys', 'report', 'repository', 'ambassador'];
  const head = conds({ tier: 'midi', waivers: {}, id: '' });
  const rows = [['Code', 'Title', 'Tier', 'Lead'].concat(keys.map(k => head.find(c => c.k === k).short), ['Required met', 'Ready for stipend'])];
  active().forEach(a => { const c = conds(a); const p = progress(a);
    rows.push([a.code, a.title, a.tier, leadName(a)].concat(keys.map(k => { const x = c.find(y => y.k === k); return x.waived ? 'waived' : `${x.have}/${x.need}${x.req ? '' : ' (optional)'}`; }), [`${p.met}/${p.total}`, p.ready ? 'yes' : 'no'])); });
  dl('conditions', rows);
}
function exportAttendance() {
  const ss = sessions();
  const rows = [['Code', 'Lead'].concat(ss.map(s => `${s.title} (${s.session_date || 'TBD'})`))];
  active().forEach(a => rows.push([a.code, leadName(a)].concat(ss.map(s => { const r = att(s.id, a.id); return r ? (r.presented ? 'presented' : r.attended ? 'attended' : '') : ''; }))));
  dl('attendance', rows);
}
function exportLines() {
  const rows = [['Code', 'Category', 'Description', 'Amount', 'Payee', 'Stipend status', 'Status date']];
  M.d.budget_lines.slice().sort((x, y) => byCode(award(x.award_id) || {}, award(y.award_id) || {})).forEach(l => { const a = award(l.award_id) || {}; const p = M.d.people.find(x => x.id === l.person_id);
    rows.push([a.code, CATS[l.category], l.description, l.amount, p ? p.name : '', l.category === 'stipend' ? l.stipend_status : '', l.status_date || '']); });
  dl('budget-lines', rows);
}
function exportExpenses() {
  const rows = [['Date', 'Code', 'Vendor', 'Description', 'Budget line', 'Amount', 'Reference', 'Receipt file']];
  M.d.expenses.slice().sort((x, y) => (x.spent_on || '').localeCompare(y.spent_on || '')).forEach(x => { const a = award(x.award_id) || {}; const l = M.d.budget_lines.find(y => y.id === x.line_id);
    rows.push([x.spent_on || '', a.code, x.vendor, x.description, l ? CATS[l.category] + (l.description ? ' – ' + l.description : '') : '', x.amount, x.reference, x.file_name || '']); });
  dl('expenses', rows);
}
function exportAssessments() {
  const rows = [['Code', 'Tier', 'College', 'Domain', 'Instrument', 'Scale max', 'n pre', 'Mean pre', 'SD pre', 'n post', 'Mean post', 'SD post', 'Gain (% pts of max)', 'Notes', 'File']];
  M.d.assessments.slice().sort((x, y) => byCode(award(x.award_id) || {}, award(y.award_id) || {}) || x.domain - y.domain).forEach(r => { const a = award(r.award_id) || {};
    rows.push([a.code, a.tier, a.college, r.domain + '. ' + DOMAINS[r.domain], r.instrument, r.scale_max ?? '', r.n_pre ?? '', r.mean_pre ?? '', r.sd_pre ?? '', r.n_post ?? '', r.mean_post ?? '', r.sd_post ?? '', rowGain(r) == null ? '' : Math.round(rowGain(r) * 10) / 10, r.notes, r.file_name || '']); });
  dl('assessment', rows);
}
function exportSurveys() {
  const sv = M.d.surveys.slice().sort((a, b) => a.sort - b.sort);
  const rows = [['Code', 'Lead'].concat(sv.map(s => s.name))];
  active().forEach(a => rows.push([a.code, leadName(a)].concat(sv.map(s => { const r = M.d.survey_done.find(d => d.survey_id === s.id && d.award_id === a.id); return r ? (r.completed_on || 'yes') : ''; }))));
  dl('surveys', rows);
}
function exportTestimonials() {
  const rows = [['Featured', 'Quote', 'Attribution', 'From', 'Code']];
  M.d.testimonials.forEach(t => rows.push([t.featured ? 'yes' : '', t.quote, t.attribution, t.kind, (award(t.award_id) || {}).code || '']));
  dl('testimonials', rows);
}

window.Mgmt = { render, reset };
})();
