// Data layer. Two interchangeable back ends with the same interface:
//   SupabaseApi — the real, shared system
//   DemoApi     — an in-browser sandbox with sample data (nothing leaves the browser)
(function () {
  'use strict';

  const BUCKET = 'proposals';

  function check(res, what) {
    if (res.error) {
      const msg = res.error.message || String(res.error);
      throw new Error(what ? `${what}: ${msg}` : msg);
    }
    return res.data;
  }

  // ------------------------------------------------------------------
  // Supabase
  // ------------------------------------------------------------------
  class SupabaseApi {
    constructor(url, key) {
      this.url = url; this.key = key;
      this.sb = window.supabase.createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'aigp-auth' }
      });
      this.demo = false;
    }

    async currentProfile() {
      const { data } = await this.sb.auth.getSession();
      if (!data || !data.session) return null;
      return this._loadProfile(data.session.user.id);
    }
    async _loadProfile(uid) {
      const res = await this.sb.from('profiles').select('*').eq('id', uid).maybeSingle();
      if (res.error || !res.data || !res.data.active) return null;
      return res.data;
    }
    async signIn(email, password) {
      const res = await this.sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (res.error) {
        if (/confirm/i.test(res.error.message)) throw new Error('This account has not been confirmed. Ask the coordinator to check the Supabase "Confirm email" setting.');
        if (/invalid login credentials/i.test(res.error.message)) throw new Error('Email or password is incorrect.');
        throw new Error('Sign-in failed: ' + res.error.message);
      }
      const prof = await this._loadProfile(res.data.user.id);
      if (!prof) { await this.sb.auth.signOut(); throw new Error('Password accepted, but this account has no portal profile yet. Run make-me-admin.sql (coordinator) or add the person on the Reviewers tab.'); }
      return prof;
    }
    async signOut() { await this.sb.auth.signOut(); }
    async changeOwnPassword(pw) { check(await this.sb.auth.updateUser({ password: pw })); }

    // Settings
    async getSettings() {
      const rows = check(await this.sb.from('settings').select('key,value'));
      const out = {}; rows.forEach(r => { out[r.key] = r.value; }); return out;
    }
    async saveSetting(key, value) {
      check(await this.sb.from('settings').upsert({ key, value, updated_at: new Date().toISOString() }), 'Saving setting');
    }

    // Proposals
    async listProposals() { return check(await this.sb.from('proposals').select('*').order('code')); }
    async listProposalAdmin() { return check(await this.sb.from('proposal_admin').select('*')); }
    async _upload(file) {
      const path = `${crypto.randomUUID()}.pdf`;
      check(await this.sb.storage.from(BUCKET).upload(path, file, { contentType: 'application/pdf', upsert: false }), 'Uploading PDF');
      return path;
    }
    async createProposal(meta, file, adminMeta) {
      const pdf_path = file ? await this._upload(file) : null;
      const row = check(await this.sb.from('proposals').insert({
        code: meta.code, title: meta.title || '', tier: meta.tier || 'micro',
        released: !!meta.released, pdf_path, pdf_name: file ? file.name : null
      }).select().single(), 'Creating proposal');
      check(await this.sb.from('proposal_admin').upsert({ proposal_id: row.id, ...(adminMeta || {}) }), 'Saving coordinator details');
      return row;
    }
    async updateProposal(id, patch) {
      return check(await this.sb.from('proposals').update(patch).eq('id', id).select().single(), 'Updating proposal');
    }
    async updateProposalAdmin(id, patch) {
      check(await this.sb.from('proposal_admin').upsert({ proposal_id: id, ...patch }), 'Updating coordinator details');
    }
    async replacePdf(p, file) {
      const path = await this._upload(file);
      const row = await this.updateProposal(p.id, { pdf_path: path, pdf_name: file.name });
      if (p.pdf_path) await this.sb.storage.from(BUCKET).remove([p.pdf_path]);
      return row;
    }
    async deleteProposal(p) {
      if (p.pdf_path) await this.sb.storage.from(BUCKET).remove([p.pdf_path]);
      check(await this.sb.from('proposals').delete().eq('id', p.id), 'Deleting proposal');
    }
    async pdfUrl(p) {
      if (!p.pdf_path) return null;
      const d = check(await this.sb.storage.from(BUCKET).createSignedUrl(p.pdf_path, 60 * 60 * 3), 'Opening PDF');
      return d.signedUrl;
    }

    // Reviews
    async listReviews() { return check(await this.sb.from('reviews').select('*')); }
    async saveReview(r) {
      const body = {
        scores: r.scores || {}, comments: r.comments || {}, overall_comment: r.overall_comment || '',
        status: r.status || 'draft', coi_note: r.coi_note || ''
      };
      if (r.id) {
        const res = await this.sb.from('reviews').update(body).eq('id', r.id).select().maybeSingle();
        const d = check(res, 'Saving review');
        if (!d) throw new Error('This review is locked (already submitted, or reviewing has been closed).');
        return d;
      }
      return check(await this.sb.from('reviews').insert({
        ...body, proposal_id: r.proposal_id, reviewer_id: r.reviewer_id
      }).select().single(), 'Saving review');
    }
    async adminUpdateReview(id, patch) {
      return check(await this.sb.from('reviews').update(patch).eq('id', id).select().single(), 'Updating review');
    }
    async adminUpsertReview(r) {
      return check(await this.sb.from('reviews').upsert(r, { onConflict: 'proposal_id,reviewer_id' }).select().single(), 'Updating review');
    }

    // People
    async listProfiles() { return check(await this.sb.from('profiles').select('*').order('display_name')); }
    async createReviewer({ email, display_name, unit, password, role }) {
      email = email.trim().toLowerCase();
      // A throwaway client so the coordinator's own session is untouched.
      const tmp = window.supabase.createClient(this.url, this.key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'aigp-tmp-' + Date.now() }
      });
      const res = await tmp.auth.signUp({ email, password });
      if (res.error) throw new Error('Creating login: ' + res.error.message);
      const user = res.data.user;
      if (!user || (Array.isArray(user.identities) && user.identities.length === 0)) {
        throw new Error('That email already has a login in Supabase. See the setup guide ("Adding someone who already has a login").');
      }
      return check(await this.sb.from('profiles').insert({
        id: user.id, email, display_name, unit: unit || '', role: role || 'reviewer', active: true
      }).select().single(), 'Creating reviewer profile');
    }
    async updateProfile(id, patch) {
      return check(await this.sb.from('profiles').update(patch).eq('id', id).select().single(), 'Updating reviewer');
    }
    async setPassword(id, pw) { check(await this.sb.rpc('admin_set_password', { target: id, pw }), 'Resetting password'); }

    // Management platform gate
    async checkMgmtPassword(pw) { return !!check(await this.sb.rpc('check_mgmt_password', { pw })); }
    async setMgmtPassword(pw) { check(await this.sb.rpc('set_mgmt_password', { pw }), 'Changing password'); }
  }

  // ------------------------------------------------------------------
  // Demo (in-browser sandbox)
  // ------------------------------------------------------------------
  function makePdf(title, lines) {
    const esc = s => s.replace(/[\\()]/g, m => '\\' + m).replace(/[^\x20-\x7e]/g, '-');
    let body = 'BT /F2 16 Tf 72 720 Td (' + esc(title) + ') Tj ET\n';
    body += 'BT /F1 11 Tf 72 690 Td 16 TL\n' + lines.map((l, i) => (i ? 'T* ' : '') + '(' + esc(l) + ') Tj').join('\n') + '\nET';
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
      `<< /Length ${body.length} >>\nstream\n${body}\nendstream`
    ];
    let out = '%PDF-1.4\n'; const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const x = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
    return new Blob([out], { type: 'application/pdf' });
  }

  const DEMO_KEY = 'aigp-demo-v1';
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2));

  function seedDemo() {
    const admin = { id: 'u-admin', email: 'coordinator@demo', display_name: 'Tom Mennella', role: 'admin', unit: 'Arts and Sciences', active: true };
    const reviewers = [
      { id: 'u-bus', email: 'business@demo', display_name: 'Dana Reyes', role: 'reviewer', unit: 'Business', active: true },
      { id: 'u-eng', email: 'engineering@demo', display_name: 'Sam Patel', role: 'reviewer', unit: 'Engineering', active: true },
      { id: 'u-law', email: 'law@demo', display_name: 'Jordan Kim', role: 'reviewer', unit: 'Law', active: true },
      { id: 'u-pha', email: 'pharmacy@demo', display_name: 'Casey Morgan', role: 'reviewer', unit: 'Pharmacy and Health Sciences', active: true }
    ];
    const P = [
      ['P-01', 'Verifying AI-drafted lab reports in a gateway science course', 'midi', 'Arts and Sciences', 2800],
      ['P-02', 'Critiquing AI legal research memos in a first-year skills course', 'micro', 'Law', 1000],
      ['P-03', 'AI-assisted data analysis sequence across two methods courses', 'midi', 'Business', 3000],
      ['P-04', 'Prompt engineering and verification in an intro programming course', 'micro', 'Engineering', 1000],
      ['P-05', 'Evaluating AI drug-information outputs in a required pharmacotherapy course', 'midi', 'Pharmacy and Health Sciences', 2500],
      ['P-06', 'AI critical evaluation in a first-year writing seminar', 'micro', 'Arts and Sciences', 900],
      ['P-07', 'Engineering design reviews with AI-generated alternatives', 'micro', 'Engineering', 1000],
      ['P-08', 'AI in financial statement analysis for an upper-level core course', 'micro', 'Business', 750]
    ];
    const proposals = [], padmin = [];
    P.forEach(([code, title, tier, college, requested], i) => {
      const id = 'p-' + (i + 1);
      proposals.push({ id, code, title, tier, pdf_path: 'demo:' + id, pdf_name: code + '.pdf', released: i < 7, created_at: new Date(Date.now() - (10 - i) * 864e5).toISOString() });
      padmin.push({ proposal_id: id, college, requested, decision: '', awarded: null, notes: '' });
    });
    // Deterministic pseudo-random scores
    let s = 7; const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    const quality = [3.6, 2.4, 3.2, 2.9, 3.4, 3.0, 1.6, 2.7];
    const keys = ['competency', 'impact', 'integration', 'scaffolding', 'workplace', 'students', 'feasibility', 'budget'];
    const reviews = [];
    reviewers.concat([admin]).forEach((r, ri) => {
      proposals.slice(0, 7).forEach((p, pi) => {
        if (r.id === 'u-admin' && pi > 2) return;              // coordinator still has work to do
        if (r.id === 'u-law' && p.id === 'p-2') {               // a recusal
          reviews.push({ id: uid(), proposal_id: p.id, reviewer_id: r.id, scores: {}, comments: {}, overall_comment: '', status: 'recused', coi_note: 'Close collaborator of a likely author.', updated_at: new Date().toISOString(), submitted_at: null });
          return;
        }
        if (r.id === 'u-pha' && pi >= 5) return;                // not started
        const scores = {};
        keys.forEach(k => { scores[k] = Math.max(0, Math.min(4, Math.round(quality[pi] + (rnd() - 0.5) * 1.8))); });
        if (r.id === 'u-eng' && p.id === 'p-7') scores.competency = 0;
        scores.bonus_dfw = (pi === 0 || pi === 5) && rnd() > 0.2 ? 2 : 0;
        scores.bonus_across = (pi === 2 || pi === 0) ? 1 : 0;
        scores.bonus_sustained = rnd() > 0.6 ? 1 : 0;
        const draft = (r.id === 'u-admin' && pi === 2) || (r.id === 'u-bus' && pi === 6);
        reviews.push({
          id: uid(), proposal_id: p.id, reviewer_id: r.id, scores,
          comments: scores.scaffolding <= 2 ? { scaffolding: 'Formative checkpoints are not described; consider adding one mid-semester.' } : {},
          overall_comment: 'Sample overall comment.', status: draft ? 'draft' : 'submitted', coi_note: '',
          updated_at: new Date().toISOString(), submitted_at: draft ? null : new Date().toISOString()
        });
      });
    });
    return {
      profiles: [admin].concat(reviewers),
      passwords: { 'coordinator@demo': 'demo', 'business@demo': 'demo', 'engineering@demo': 'demo', 'law@demo': 'demo', 'pharmacy@demo': 'demo' },
      proposals, padmin, reviews,
      settings: { reviews_open: true, threshold: 31, threshold_includes_bonus: true, budget_cap: 35000, review_deadline: '2026-11-09', disagreement_sd: 1 },
      mgmt: 'demo', session: null
    };
  }

  class DemoApi {
    constructor() {
      this.demo = true;
      this.blobs = {};
      try { this.db = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); } catch (e) { this.db = null; }
      if (!this.db) this.db = seedDemo();
    }
    _save() { try { localStorage.setItem(DEMO_KEY, JSON.stringify(this.db)); } catch (e) { /* storage unavailable: keep in memory */ } }
    reset() { this.db = seedDemo(); this.blobs = {}; this._save(); }
    _me() { return this.db.profiles.find(p => p.id === this.db.session); }
    _admin() { const m = this._me(); if (!m || m.role !== 'admin') throw new Error('Only the coordinator can do this'); }
    _wait() { return new Promise(r => setTimeout(r, 60)); }

    async currentProfile() { await this._wait(); const m = this._me(); return m && m.active ? m : null; }
    async signIn(email, password) {
      await this._wait();
      email = email.trim().toLowerCase();
      const p = this.db.profiles.find(x => x.email === email);
      if (!p || this.db.passwords[email] !== password) throw new Error('Email or password is incorrect.');
      if (!p.active) throw new Error('This account does not have access to the review platform.');
      this.db.session = p.id; this._save(); return p;
    }
    async signOut() { this.db.session = null; this._save(); }
    async changeOwnPassword(pw) { this.db.passwords[this._me().email] = pw; this._save(); }

    async getSettings() { await this._wait(); return JSON.parse(JSON.stringify(this.db.settings)); }
    async saveSetting(key, value) { this._admin(); this.db.settings[key] = value; this._save(); }

    async listProposals() {
      await this._wait();
      const me = this._me();
      return this.db.proposals.filter(p => me.role === 'admin' || p.released).map(p => ({ ...p })).sort((a, b) => a.code.localeCompare(b.code));
    }
    async listProposalAdmin() { this._admin(); return this.db.padmin.map(x => ({ ...x })); }
    async createProposal(meta, file, adminMeta) {
      this._admin();
      if (this.db.proposals.some(p => p.code === meta.code)) throw new Error(`Creating proposal: code ${meta.code} already exists`);
      const id = uid();
      const row = { id, code: meta.code, title: meta.title || '', tier: meta.tier || 'micro', released: !!meta.released, pdf_path: file ? 'blob:' + id : null, pdf_name: file ? file.name : null, created_at: new Date().toISOString() };
      if (file) this.blobs[row.pdf_path] = URL.createObjectURL(file);
      this.db.proposals.push(row);
      this.db.padmin.push({ proposal_id: id, college: '', requested: 0, decision: '', awarded: null, notes: '', ...(adminMeta || {}) });
      this._save(); return { ...row };
    }
    async updateProposal(id, patch) {
      this._admin();
      const p = this.db.proposals.find(x => x.id === id);
      if (patch.code && this.db.proposals.some(x => x.code === patch.code && x.id !== id)) throw new Error('Updating proposal: that code is already in use');
      Object.assign(p, patch); this._save(); return { ...p };
    }
    async updateProposalAdmin(id, patch) {
      this._admin();
      let a = this.db.padmin.find(x => x.proposal_id === id);
      if (!a) { a = { proposal_id: id, college: '', requested: 0, decision: '', awarded: null, notes: '' }; this.db.padmin.push(a); }
      Object.assign(a, patch); this._save();
    }
    async replacePdf(p, file) {
      const path = 'blob:' + uid(); this.blobs[path] = URL.createObjectURL(file);
      return this.updateProposal(p.id, { pdf_path: path, pdf_name: file.name });
    }
    async deleteProposal(p) {
      this._admin();
      this.db.proposals = this.db.proposals.filter(x => x.id !== p.id);
      this.db.padmin = this.db.padmin.filter(x => x.proposal_id !== p.id);
      this.db.reviews = this.db.reviews.filter(x => x.proposal_id !== p.id);
      this._save();
    }
    async pdfUrl(p) {
      if (!p.pdf_path) return null;
      if (this.blobs[p.pdf_path]) return this.blobs[p.pdf_path];
      const blob = makePdf(`${p.code}  (${p.tier === 'midi' ? 'Midi' : 'Micro'}-Grant proposal, demo placeholder)`, [
        p.title,
        '',
        'This is a placeholder PDF generated for the demo. In the real portal, the',
        'de-identified proposal PDF uploaded by the coordinator appears here.',
        '',
        'A. The course',
        'B. Competencies',
        'C. Impact, integration and scaffolding',
        'D. Workplace relevance',
        'E. Evidence of gain',
        'F. Feasibility and sustainability',
        'Appendix A. Budget'
      ]);
      const url = URL.createObjectURL(blob); this.blobs[p.pdf_path] = url; return url;
    }

    async listReviews() {
      await this._wait();
      const me = this._me();
      return this.db.reviews.filter(r => me.role === 'admin' || r.reviewer_id === me.id).map(r => JSON.parse(JSON.stringify(r)));
    }
    async saveReview(r) {
      await this._wait();
      const me = this._me();
      if (!this.db.settings.reviews_open && me.role !== 'admin') throw new Error('Reviewing has been closed by the coordinator.');
      let row = r.id ? this.db.reviews.find(x => x.id === r.id) : null;
      if (row && row.status === 'submitted' && me.role !== 'admin') throw new Error('This review is locked (already submitted).');
      const now = new Date().toISOString();
      const body = { scores: r.scores || {}, comments: r.comments || {}, overall_comment: r.overall_comment || '', status: r.status || 'draft', coi_note: r.coi_note || '', updated_at: now };
      body.submitted_at = body.status === 'submitted' ? (row && row.submitted_at) || now : null;
      if (row) Object.assign(row, body);
      else { row = { id: uid(), proposal_id: r.proposal_id, reviewer_id: me.id, ...body }; this.db.reviews.push(row); }
      this._save(); return JSON.parse(JSON.stringify(row));
    }
    async adminUpdateReview(id, patch) {
      this._admin();
      const row = this.db.reviews.find(x => x.id === id);
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      if (patch.status && patch.status !== 'submitted') row.submitted_at = null;
      this._save(); return { ...row };
    }
    async adminUpsertReview(r) {
      this._admin();
      const row = this.db.reviews.find(x => x.proposal_id === r.proposal_id && x.reviewer_id === r.reviewer_id);
      if (row) return this.adminUpdateReview(row.id, r);
      const n = { id: uid(), scores: {}, comments: {}, overall_comment: '', coi_note: '', status: 'draft', submitted_at: null, updated_at: new Date().toISOString(), ...r };
      this.db.reviews.push(n); this._save(); return { ...n };
    }

    async listProfiles() { this._admin(); return this.db.profiles.map(p => ({ ...p })).sort((a, b) => a.display_name.localeCompare(b.display_name)); }
    async createReviewer({ email, display_name, unit, password, role }) {
      this._admin(); email = email.trim().toLowerCase();
      if (this.db.profiles.some(p => p.email === email)) throw new Error('That email already has a login.');
      const p = { id: uid(), email, display_name, unit: unit || '', role: role || 'reviewer', active: true };
      this.db.profiles.push(p); this.db.passwords[email] = password; this._save(); return { ...p };
    }
    async updateProfile(id, patch) {
      this._admin(); const p = this.db.profiles.find(x => x.id === id); Object.assign(p, patch); this._save(); return { ...p };
    }
    async setPassword(id, pw) { this._admin(); const p = this.db.profiles.find(x => x.id === id); this.db.passwords[p.email] = pw; this._save(); }

    async checkMgmtPassword(pw) { await this._wait(); return pw === this.db.mgmt; }
    async setMgmtPassword(pw) { this._admin(); if (pw.length < 8) throw new Error('Password must be at least 8 characters'); this.db.mgmt = pw; this._save(); }
  }

  window.GrantsApi = { SupabaseApi, DemoApi };
})();
