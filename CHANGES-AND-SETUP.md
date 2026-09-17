# Permit Log — Improvements & Setup

**For:** HSE Manager
**Files:** `index.html` (rebuilt), `apps-script/Code.gs` (new verified backend)

---

## 1. What was added

### 👤 Verified "Logged By" — tamper-proof identity
- Every permit now records **who logged it**.
- When the app is served through Apps Script with Google sign-in (see §3), the
  identity is the submitter's **verified Google email**, stamped **on the server**.
  The browser cannot fake it, and the field is shown read-only.
- A green banner confirms *"Verified sign-in active — logging as …"*.
- If verified sign-in isn't enabled yet, the app still works: it shows an amber
  banner and records a **self-declared name** (clearly marked *not verified*).
- Each row also stores a **Verified = YES/NO** column so you can see, per entry,
  whether the identity is trustworthy.

### 📊 Team Performance tab (your monitoring view)
See **who is logging and who is not**, per person:
- Total permits, **Verified** count, logged **today / this week / this month**.
- **Last logged** date and days since.
- **INACTIVE** (red) if someone hasn't logged within your threshold; **NEVER
  LOGGED** for roster members with zero entries.
- Leaderboard medals (🥇🥈🥉) and **Export Performance CSV**.

### ⚙️ Team / Settings
- Add the people who should be logging (names, or Google emails for verified
  mode) so they can be flagged even before their first entry.
- Set the **inactivity threshold** (default 3 days).

### KPI dashboard + filtering
- Total, Active, **Expired & Active ⚠️**, Logged Today, This Week, Active Loggers.
- Search, filter by type / status / **Expired & Active**, and date range.

---

## 2. Bugs fixed

| # | Bug | Fix |
|---|-----|-----|
| 1 | No record of who entered a permit | Verified/self-declared **Logged By** + timestamp |
| 2 | CSV export vulnerable to spreadsheet **formula injection** | Cells escaped; UTF-8 BOM added so Excel opens Arabic/accents correctly |
| 3 | CSV missing fields | Exports all fields incl. Logged By / Verified, respects filters |
| 4 | No check for **expired-but-still-Active** permits | KPI, row highlight, filter, and a save-time warning |
| 5 | No check that **Valid To** is after **Valid From** | Added |
| 6 | Toast messages stacked / flickered | Single debounced timer |
| 7 | Inputs saved with stray whitespace | All fields trimmed |
| 8 | React row keys could collide | Keys include permit no. + index |

> **Live-data finding:** on first load the dashboard flagged **206 permits still
> marked "Active" whose *Valid To* is already in the past** — opened and never
> closed. Use the **"⚠️ Expired & Active"** status filter to list and close them.

---

## 3. Enable verified Google sign-in (the setup you chose)

Verified identity needs the page to be **served by Apps Script** so the Google
login session reaches the server. Do this once:

1. Google Sheet → **Extensions → Apps Script**.
2. Paste `apps-script/Code.gs` into **Code.gs**.
3. **File → New → HTML file**, name it **`Index`** (exact). Paste the entire
   contents of `index.html` into it. Save.
4. Set `CONFIG` at the top of Code.gs:
   - `MODE`: `SINGLE_TAB` (all permits in one tab — set `TAB_NAME`) or
     `TAB_PER_PROJECT` (one tab per project).
5. **Deploy → New deployment → Web app**, then pick ONE identity mode:

   **Mode A — your Google Workspace domain (cleanest, fully private sheet)**
   - *Execute as:* **Me**
   - *Who has access:* **Anyone within `<your-domain>`**
   - Verified emails are captured for everyone on your domain. The sheet stays
     private (only the script writes to it). **Requires each logger to sign in
     with a Google Workspace account on your domain.**

   **Mode B — any Google account (incl. external contractors)**
   - *Execute as:* **User accessing the web app**
   - *Who has access:* **Anyone with a Google Account**
   - Captures the real email of any Google account. ⚠️ Trade-off: because the
     script runs as the visitor, each logger must be given **edit access to the
     Sheet**. Only use this if you're comfortable sharing the sheet with them.

6. Give people the **new `/exec` URL** as the app link. They sign in with Google;
   the app shows the green verified banner and stamps each save automatically.

### 3.1 Stop anyone logging under another person's name (anti-impersonation)

Two server controls in `Code.gs` CONFIG make the logger identity impossible to fake:

- **`REQUIRE_VERIFIED: true`** (default) — a permit can *only* be saved by someone
  with a real Google session. The browser-typed name is ignored; the server writes
  the signed-in email. This also blocks anyone trying to POST a forged entry
  straight to the endpoint. Result: **the "Logged By" value is always the real
  submitter — no one can put a colleague's name on their entry.**
- **`ALLOWED_LOGGERS: [...]`** — an optional approved-loggers list of emails. When
  set, only those accounts can submit; everyone else is rejected with a clear
  message. Use it so only your named officers can log, each strictly as themselves.
  Leave it empty to allow any signed-in user on your domain.

  ```js
  ALLOWED_LOGGERS: ['ahmed.ali@yourco.com', 'sara.khan@yourco.com']
  ```

What each person sees:
- ✅ **Approved + signed in** → green "verified — logging as <email>", read-only.
- ⛔ **Signed in but not on the list** → red "Not an approved logger", Save disabled.
- ⛔ **Not signed in** (with REQUIRE_VERIFIED) → red "Sign-in required", Save disabled.

> Because credit is now the verified email, if one officer logs for another it
> shows the *actual* person's email — so cover-ups surface instead of hiding.
> Re-deploy a **new version** after editing CONFIG for changes to take effect.

> **Which mode?** If your site HSE officers have company Google/Workspace
> accounts on one domain → **Mode A** (recommended). If they're on mixed/personal
> Gmail and you can share the sheet → **Mode B**. If neither fits, the app still
> runs in self-declared mode (amber banner) and the **Verified** column will read
> **NO** — you'll still get names + performance tracking, just not tamper-proof.

The backend is header-driven and **auto-adds** the `Logged By`, `Logged At` and
`Verified` columns to your sheet — it won't disturb existing columns.

### Keeping the current static hosting too (optional)
`index.html` also still works hosted statically (e.g. GitHub Pages) against the
existing `…/exec` URL — it just runs in self-declared mode. Verified mode
requires the served build above.

---

## 4. Recommended
- Add each project's HSE officers in **⚙️ Team / Settings** (use their Google
  emails if verified) so red **INACTIVE / NEVER LOGGED** flags are meaningful.
- Roster/threshold are stored per-browser — keep your oversight on one device,
  or ask and we can move the roster into the sheet so it's shared.

---

## 5. How to run
- **Static (self-declared):** open `index.html` or host it as you do now.
- **Verified:** deploy via Apps Script as in §3 and use the `/exec` URL.
No build step or dependencies in either case.
