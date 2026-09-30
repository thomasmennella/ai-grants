# Innovations with AI — Grants Portal

A portal with two password-protected sides:

- **Proposal Review.** Each reviewer has their own login. The coordinator uploads de-identified PDFs, reviewers score them against the rubric, and the coordinator sees every score, with means and SDs, a funding planner, and exports.
- **Grants Management.** A placeholder for now, locked behind its own separate password.

It is a static website (hosted free on GitHub Pages) backed by a free Supabase project, which handles logins, the database and PDF storage.

**Try it first:** open `index.html` in a browser and click **Explore the demo**. The demo runs entirely in your browser on sample data.

---

## One-time setup (about 20 minutes)

### 1. Create the Supabase project
1. Go to <https://supabase.com>, sign up (GitHub sign-in is easiest), and click **New project**.
2. Name it `ai-grants`, set a strong database password (save it somewhere), and choose the region **East US**. Keep the Free plan.
3. Wait about 2 minutes for the project to finish provisioning.

### 2. Create the database
1. In the left sidebar, open **SQL Editor** and click **New query**.
2. Open `supabase/setup.sql` from this folder, copy all of it, paste it in, and click **Run**. You should see "Success. No rows returned."

### 3. Configure logins
1. Go to **Authentication → Sign In / Providers → Email** (older layouts: *Providers → Email*).
2. Turn **OFF** "Confirm email". Reviewers are given passwords directly, so no confirmation emails are needed.
3. Leave **"Allow new users to sign up" ON**. The portal uses it when you create reviewer logins. Someone who signs up on their own gets no access, because only accounts you create in the portal are given a profile.

### 4. Make yourself the coordinator
1. Go to **Authentication → Users → Add user → Create new user**. Enter `thomas.mennella@wne.edu` and a password, and tick **Auto Confirm User**.
2. Back in **SQL Editor**, open a new query, paste in `supabase/make-me-admin.sql`, and click **Run**. The last line should show your email with `role = admin`.

### 5. Connect the website to Supabase
1. Go to **Project Settings → API** (or **Data API** / **API Keys**).
2. Copy the **Project URL** and the **anon / publishable** key.
3. Paste both into `config.js`:
   ```js
   SUPABASE_URL: 'https://abcdefgh.supabase.co',
   SUPABASE_ANON_KEY: 'eyJhbGciOi...',
   ```
   The anon key is meant to be public, and your data is protected by the database's security rules. **Never** paste the `service_role` / secret key.

### 6. Publish on GitHub Pages
1. On GitHub, create a new repository called `ai-grants`. It must be public for free Pages; that's fine, because the code contains no secrets or proposal data.
2. Upload everything in this folder, including the `supabase` and `.github` folders (**Add file → Upload files**; drag the whole folder in). If your computer hides the `.github` folder, create the file on GitHub instead: **Add file → Create new file**, name it `.github/workflows/keep-supabase-awake.yml`, and paste in the contents.
3. Go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, select branch `main` and folder `/ (root)`, and click Save.
4. After about a minute the site is live at `https://thomasmennella.github.io/ai-grants/`.
5. (Optional) In Supabase, go to **Authentication → URL Configuration** and set **Site URL** to that address.

### 7. First sign-in
1. Open the portal, choose **Proposal Review**, and sign in.
2. Go to **Settings → Passwords** and change the Grants Management password. The starting password is `change-me-mgmt`.
3. Check the other settings: review deadline, threshold (31), budget cap ($35,000), and the list of colleges/schools.

---

## Running a review cycle

1. **Reviewers tab.** Add each committee member with their name, email and college/school. A temporary password is generated for you. Copy the message that appears and send it to them; the password is not shown again, but you can reset it at any time.
2. **Proposals tab.** Drop in the de-identified PDFs. Give each one a code (P-01, P-02… are filled in automatically), a short neutral title, and its tier. College and requested amount are visible only to you. Leave "Release now" unticked until you're ready.
3. **Release.** Toggle proposals to *Released*, or use **Release all**. Reviewers see only released proposals.
4. **Reviewers score.** The PDF appears beside the rubric. Scores autosave as drafts, reviewers can add per-criterion comments, and they can recuse themselves for a conflict of interest. **Submit** locks the review.
5. **Scores tab.** Every reviewer's total appears per proposal, with the mean and SD highlighted. Click a proposal to see scores criterion by criterion, disagreement flags, comments and your private notes. From there you can **reopen** a submitted review or **mark a reviewer recused**.
6. **My reviews.** You score as the Arts and Sciences representative, and your scores count like anyone else's.
7. **Funding planner.** Eligible proposals are ranked by mean, with the running total against the cap, a suggested funding set, "top in college" and tie flags, and awards by college. Record a decision and award amount for each proposal.
8. **Close reviewing** in Settings when the window ends. Everything becomes read-only for reviewers.
9. **Export** both CSVs (Scores tab or Settings) for the Provost's Office and as your own backup.

### How scores are calculated
- Each criterion is scored 0–4 and multiplied by its weight (3, 2, 2, 2, 1, 1, 1, 1), for a maximum of 52. The bonuses (+2, +1, +1) bring the maximum to **56**.
- Mean, SD (sample) and range use **submitted** reviews only. Drafts and recusals are excluded.
- **Above threshold** means the mean total is ≥ 31 **and** the mean Competency score is above 0. Any single reviewer scoring Competency 0 is flagged separately for your attention.
- The RFP says "≥ 31" with a maximum of 56 (bonus included), while the rubric sheet says "31 of 52 (60%)". The portal counts bonus points toward the threshold by default; you can switch this in **Settings → Scoring**.
- A criterion is flagged as "split" when the reviewers' SD on it is ≥ 1 point on the 0–4 scale (adjustable).
- You can edit the rubric text, weights and bonus points in **Settings → Rubric**. Totals are recalculated automatically.

---

## Good to know

- **Free-tier pause.** Supabase pauses free projects that get too little database activity over a week. The included GitHub Action (`.github/workflows/keep-supabase-awake.yml`) prevents this by running a tiny query every 8 hours. To turn it on: in the GitHub repo, go to **Settings → Secrets and variables → Actions → New repository secret** and add `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the same two values as in `config.js`). Then open the **Actions** tab, choose "Keep Supabase awake" and click **Run workflow** once to confirm it goes green. If the project ever does pause, click **Restore project** in the Supabase dashboard; your data is kept.
- **Password resets** are in the Reviewers tab. If that ever fails, use Supabase: **Authentication → Users → (user) → Send password recovery** (emails the reviewer a reset link).
- **Adding someone who already has a login** (for example, a user you created by hand in Supabase): run this in the SQL Editor, changing the details:
  ```sql
  insert into public.profiles (id, email, display_name, role, unit)
  select id, email, 'Full Name', 'reviewer', 'Business' from auth.users where email = 'person@wne.edu';
  ```
- **Blinding.** Reviewers can only ever read released proposals, their own scores, and the settings. They cannot see other reviewers' scores, other reviewers' identities, colleges, requested amounts or your notes. This is enforced by the database, not just hidden in the page.
- **After the cycle.** Delete the proposals (Proposals tab) once awards are final, if you don't want the PDFs kept.
- **Grants Management.** This side is a placeholder. The planned modules are the awardee roster, conditions-of-award tracking, stipends, assessment data, reports and the donor impact report.

## Files
| File | What it is |
|---|---|
| `index.html` | Page shell and styles |
| `app.js` | The portal (views, scoring, coordinator tools) |
| `api.js` | Data layer: Supabase, plus the in-browser demo |
| `rubric.js` | The default rubric (from the AI MiniGrant rubric sheet) |
| `config.js` | Your Supabase URL and key, program name, contact email |
| `supabase/setup.sql` | Tables, security rules, PDF storage, defaults |
| `supabase/make-me-admin.sql` | Makes your account the coordinator |
| `.github/workflows/keep-supabase-awake.yml` | Pings the database so the free project doesn't pause |
