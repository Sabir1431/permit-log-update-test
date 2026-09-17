/**
 * TAQA WS Permit Log — Google Apps Script backend (VERIFIED SIGN-IN build)
 * ---------------------------------------------------------------------------
 * This runs behind the "…/exec" URL used by index.html and can ALSO serve the
 * page itself. It reads/writes permit rows in your Google Sheet and — the key
 * point for accountability — stamps the *verified* Google identity of whoever
 * submits, taken from the session on the server. The browser cannot forge it.
 *
 * IDENTITY MODEL:
 *   - "Logged By"  = the signed-in Google email (server-derived) when available,
 *                    otherwise the name typed in the form (unverified fallback).
 *   - "Verified"   = YES when the email came from a real Google session, else NO.
 *
 * TWO WAYS TO GET VERIFIED EMAILS (see CHANGES-AND-SETUP.md for full steps):
 *   (A) Same Google Workspace domain as the sheet owner:
 *         Deploy → Execute as: Me · Who has access: Anyone within <your domain>.
 *   (B) Any Google account (incl. external contractors):
 *         Serve THIS page from Apps Script (doGet below) and deploy →
 *         Execute as: User accessing · Who has access: Anyone with a Google Account.
 *       In mode (B) the page calls the server with google.script.run, so the
 *       login cookie applies and getActiveUser() returns the real email.
 *
 *   If neither is configured, saving still works but "Verified" = NO and the
 *   web app shows an amber "sign-in not active" banner.
 *
 * INSTALL: Sheet → Extensions → Apps Script → paste this as Code.gs.
 *   For the served/verified build, also add an HTML file named  Index  and
 *   paste the contents of index.html into it. Then Deploy as a Web app.
 */

// ======================= CONFIG (edit these) =======================
var CONFIG = {
  MODE: 'SINGLE_TAB',      // 'SINGLE_TAB' (one tab + Project column) or 'TAB_PER_PROJECT'
  TAB_NAME: 'Permit Log',  // used when MODE === 'SINGLE_TAB'
  HTML_FILE: 'Index',      // Apps Script HTML file that holds the page (served build)

  // 🔒 ANTI-IMPERSONATION CONTROLS
  // When true, a permit can ONLY be saved by someone with a real Google session.
  // This blocks self-declared names AND blocks anyone POSTing a forged name to
  // the endpoint directly. Turn on once you deploy the verified (Mode A) build.
  REQUIRE_VERIFIED: true,

  // Optional approved-loggers allow-list (lowercase emails). Leave EMPTY to allow
  // any signed-in user on your domain. Add emails to restrict logging to named
  // officers only — anyone else is rejected, so no one can log on another's behalf.
  //   e.g. ALLOWED_LOGGERS: ['ahmed.ali@yourco.com', 'sara.khan@yourco.com']
  ALLOWED_LOGGERS: []
};

var COLUMNS = [
  'Date', 'Time', 'Permit No.', 'Permit Type', 'Location', 'Contractor',
  'Supervisor', 'Work Description', 'Hazards', 'Control Measures',
  'Permit Issuer', 'Valid From', 'Valid To', 'Status',
  'Project', 'Logged By', 'Logged At', 'Verified'
];

// payload key -> sheet header (identity handled separately, server-side)
var FIELD_TO_HEADER = {
  date: 'Date', time: 'Time', permitNo: 'Permit No.', permitTypeName: 'Permit Type',
  location: 'Location', contractor: 'Contractor', supervisor: 'Supervisor',
  workDescription: 'Work Description', hazards: 'Hazards', controlMeasures: 'Control Measures',
  permitIssuer: 'Permit Issuer', validFrom: 'Valid From', validTo: 'Valid To',
  status: 'Status', project: 'Project'
};

// ======================= WEB ENTRY POINTS =======================

function doGet(ev) {
  try {
    var action = ev && ev.parameter && ev.parameter.action;
    if (action === 'list')   return json({ ok: true, rows: listRows((ev.parameter.project) || '') });
    if (action === 'whoami') return json(whoamiObj());
    if (action)              return json({ ok: false, error: 'Unknown action: ' + action });
    // No action → serve the app (verified build). Falls back to a message if
    // the Index HTML file has not been added.
    try {
      return HtmlService.createHtmlOutputFromFile(CONFIG.HTML_FILE)
        .setTitle('TAQA WS Permit Log')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } catch (e) {
      return json({ ok: true, note: 'API is live. Add an HTML file named "' + CONFIG.HTML_FILE + '" to serve the page, or host index.html statically.' });
    }
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doPost(ev) {
  var payload = parsePayload(ev);
  if (!payload) return json({ ok: false, error: 'No payload received' });
  return json(savePermit_(payload));
}

// ======================= google.script.run API (served build) =======================
// These let the served page call the server directly, so the Google login
// session is available and identity can be verified.

function apiWhoami() { return whoamiObj(); }
function apiList(project) { return { ok: true, rows: listRows(project || '') }; }
function apiSave(payload) { return savePermit_(payload || {}); }

// ======================= CORE =======================

function whoamiObj() {
  var email = '';
  try { email = Session.getActiveUser().getEmail() || ''; } catch (e) {}
  return {
    ok: true,
    email: email,
    verified: !!email,
    authorized: email ? isAllowed(email) : false,
    requireVerified: !!CONFIG.REQUIRE_VERIFIED,
    restricted: (CONFIG.ALLOWED_LOGGERS || []).length > 0
  };
}

// True if this email may log permits (allow-list empty = anyone signed in).
function isAllowed(email) {
  var list = CONFIG.ALLOWED_LOGGERS || [];
  if (!list.length) return true;
  var target = String(email || '').trim().toLowerCase();
  for (var i = 0; i < list.length; i++) {
    if (String(list[i]).trim().toLowerCase() === target) return true;
  }
  return false;
}

function savePermit_(payload) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);

    // 🔒 Trusted identity from the server session — cannot be spoofed by the browser.
    var sessionEmail = '';
    try { sessionEmail = Session.getActiveUser().getEmail() || ''; } catch (e) {}
    var verified = !!sessionEmail;

    // Anti-impersonation gate. When REQUIRE_VERIFIED is on, we never trust a
    // browser-supplied name — only the signed-in Google identity — so no one
    // can log under someone else's name or POST a forged entry to the endpoint.
    if (CONFIG.REQUIRE_VERIFIED && !verified) {
      return { ok: false, error: 'Sign-in required. Open the app via its Apps Script link and sign in with your Google account to log a permit.' };
    }
    if (verified && !isAllowed(sessionEmail)) {
      return { ok: false, error: 'Not authorized: ' + sessionEmail + ' is not on the approved loggers list. Contact the HSE Manager.' };
    }

    // Identity written to the sheet is the verified email (never the typed name)
    // whenever a session exists. Typed name is used only in self-declared mode.
    var loggedBy = verified ? sessionEmail : String(payload.loggedBy || '').trim();

    var sheet = getSheet(payload.project || '');
    var headers = ensureHeaders(sheet);

    var row = headers.map(function (h) {
      for (var key in FIELD_TO_HEADER) {
        if (FIELD_TO_HEADER[key] === h) return payload[key] != null ? payload[key] : '';
      }
      if (h === 'Logged By') return loggedBy;
      if (h === 'Logged At') return payload.clientLoggedAt || new Date().toISOString();
      if (h === 'Verified')  return verified ? 'YES' : 'NO';
      return '';
    });

    sheet.appendRow(row);
    return { ok: true, success: true, loggedBy: loggedBy, verified: verified };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function getSheet(project) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet;
  if (CONFIG.MODE === 'TAB_PER_PROJECT') {
    sheet = ss.getSheetByName(project) || ss.insertSheet(project);
  } else {
    sheet = ss.getSheetByName(CONFIG.TAB_NAME) || ss.insertSheet(CONFIG.TAB_NAME);
  }
  return sheet;
}

function ensureHeaders(sheet) {
  var lastCol = sheet.getLastColumn();
  var headers = lastCol > 0
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); })
    : [];

  if (headers.length === 0) {
    headers = COLUMNS.slice();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return headers;
  }
  var missing = COLUMNS.filter(function (c) { return headers.indexOf(c) === -1; });
  if (missing.length) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    headers = headers.concat(missing);
  }
  return headers;
}

function listRows(project) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = (CONFIG.MODE === 'TAB_PER_PROJECT')
    ? ss.getSheetByName(project)
    : ss.getSheetByName(CONFIG.TAB_NAME);
  if (!sheet) return [];

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = {}, hasData = false;
    for (var c = 0; c < headers.length; c++) {
      var v = values[i][c];
      if (v instanceof Date) v = formatCell(headers[c], v);
      obj[headers[c]] = v;
      if (v !== '' && v != null) hasData = true;
    }
    if (!hasData) continue;
    if (CONFIG.MODE === 'SINGLE_TAB' && project && obj['Project'] && String(obj['Project']).trim() !== project) continue;
    rows.push(obj);
  }
  return rows;
}

function formatCell(header, dateVal) {
  var tz = Session.getScriptTimeZone() || 'Asia/Dubai';
  if (header === 'Time') return Utilities.formatDate(dateVal, tz, 'HH:mm');
  if (header === 'Date') return Utilities.formatDate(dateVal, tz, 'yyyy-MM-dd');
  return Utilities.formatDate(dateVal, tz, "yyyy-MM-dd'T'HH:mm:ss");
}

function parsePayload(ev) {
  if (ev && ev.parameter && ev.parameter.payload) {
    try { return JSON.parse(ev.parameter.payload); } catch (e) {}
  }
  if (ev && ev.postData && ev.postData.contents) {
    try { return JSON.parse(ev.postData.contents); } catch (e) {}
  }
  return null;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
