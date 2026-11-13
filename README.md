# Innovations with AI — Grants Portal

A portal with two password-protected sides:

- **Proposal Review.** Each reviewer has their own login. The coordinator uploads de-identified PDFs, reviewers score them against the rubric, and the coordinator sees every score, with means and SDs, a funding planner, and exports.
- **Grants Management.** Coordinator-only post-award tracking: awardees, conditions of award, sessions and attendance, budget and stipends, pre/post assessment, surveys and testimonials, and reporting. It needs two locks: your coordinator sign-in **and** the separate management password.

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
2. Back in **SQL Editor**, open a new query. Open `supabase/make-me-admin.sql` in a text editor (Notepad or TextEdit), copy **everything inside it**, paste that in (not the file name), and click **Run**. The last line should show your email with `role = admin`.

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

### 8. Add Grants Management (one time)
1. In Supabase, open **SQL Editor → New query**. Copy **everything inside** `supabase/management.sql`, paste it in, and click **Run**. You should see "Success". It adds new tables only and doesn't touch the review side.
2. Upload the new and updated site files to GitHub: `mgmt.js` (new) and the `templates` folder (new), plus `index.html`, `app.js` and `api.js`. **Don't** replace your live `config.js`; it holds your keys.
3. On the portal's front page, use the **Grants Management** card: your coordinator email and password, plus the management password. The first time it opens, it adds the sessions, milestones and survey the RFP calls for.

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

## Grants Management

**Built-in guides.** Every screen that isn't self-explanatory has a blue **How this works** panel at the top (click it to open; the portal remembers which ones you leave open), with links to the related screens.

**Assessment template.** `templates/assessment-data-template.xlsx` is the workbook awardees fill in: one sheet per domain (anonymous student codes, pre and post scores), plus a Summary sheet that calculates n, mean and SD in the same order as the portal's fields. It can be downloaded from the Assessment tab and from each award's page.

**Unlocking.** On the front page, enter your coordinator sign-in plus the management password. The database itself requires both: a reviewer account can't unlock it, and even your account sees nothing without the management password. An unlock lasts 12 hours, or until you click **Lock** (top right).

**Tabs**
- **Dashboard.** Headline numbers, a conditions-of-award grid for every award, upcoming sessions and milestones, and a "Needs attention" list (no lead entered, budget lines that don't add up, overspending, sessions with no attendance recorded, overdue milestones). **Email reminders…** builds a ready-to-send message to every lead still missing a condition: copy it, or open it in your mail app with the addresses in BCC.
- **Awardees.** **Import funded proposals** pulls everything you marked *Fund in full / partially / as micro-grant* in the review side's Funding planner, with tier, college and award amount, and creates a stipend budget line for each. Open an award to add the lead and co-leads from the cover sheet, and to manage everything about it on one page: conditions, attendance, budget and expenses, assessment data, deliverables, surveys and testimonials.
- **Sessions & dates.** The convening (Nov 20), AI Trainings 1–3 and enough Lunch Lightning Talk sessions for your roster are created for you; fill in dates and rooms. Attendance is a grid of awards × sessions; for Lightning Talk sessions, also tick **talk** for whoever presented. Milestones follow the RFP timeline.
- **Budget.** The stipend pipeline (pending → approved → sent to payroll → paid), budget vs. spending by award, and an expense log with receipt uploads. Marking a stipend approved before its conditions are met asks you to confirm.
- **Assessment.** Pre/post results pooled by domain: % of scale, change, normalized gain and effect size (Cohen's d, when SDs are entered), with a chart. Enter numbers on each award's page and upload the data file alongside.
- **Surveys & testimonials.** Your survey list (with Forms links and due dates), a completion grid, and a testimonial library. Star the quotes you want in the impact report.
- **Reports.** A printable impact report (print or save as PDF), CSV exports, and a Claude-drafted donor narrative. The narrative needs your Anthropic API key (Settings), which stays in your browser and is never stored in the database. Only aggregate data, project titles and featured quotes are sent — no names or emails. Check every number before using a draft.
- **Settings.** Cycle name, donor line, required counts (3 trainings, 5 CoP events for midi, 5 talks per session), API key, and the management password.

**How conditions are counted** (RFP §7; only the lead's participation is tracked)

| Condition | Micro | Midi | Counted from |
|---|---|---|---|
| AI training series (3 sessions) | required | required | attendance at AI training sessions |
| Lunch Lightning Talk(s) | 1 | 2 | "talk" ticks |
| Pre/post assessment incl. Domain 1 | required | required | Domain 1 pre and post means entered |
| Initiative surveys | required | required | completion ticks |
| Final report + syllabus or assignment | required | required | deliverables on file |
| Repository deposit | required | required | repository box on the award |
| Community of Practice (5 events) | encouraged | required | attendance at sessions marked "CoP" (convening, Lightning Talks, watch parties) |
| AI Ambassador | encouraged | required | ambassador box on the award |

Any condition can be **waived** with a note. An award shows **Ready for stipend** when every required condition is met or waived.

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
| `mgmt.js` | The Grants Management side |
| `templates/assessment-data-template.xlsx` | Pre/post data workbook for awardees (linked from the portal) |
| `supabase/management.sql` | Grants Management tables, two-lock security rules and private file storage |
| `.github/workflows/keep-supabase-awake.yml` | Pings the database so the free project doesn't pause |
