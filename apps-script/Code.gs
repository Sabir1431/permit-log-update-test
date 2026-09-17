/**
 * TAQA WS Permit Log — Apps Script backend (Users-sheet LOGIN build)
 * ---------------------------------------------------------------------------
 * Accountability model:
 *   - People sign in with a Name + Password stored in the "Users" tab.
 *   - The server validates those credentials on EVERY save and writes the
 *     matched Name into "Logged By". A browser can't change it, and you can't
 *     log under someone else's name without knowing their password.
 *   - Every saved permit is therefore tied to a real user (Verified = YES).
 *
 * Users tab layout (row 1 = headers; columns are matched BY NAME, any order):
 *   Name          | Email                    | Password   | Role
 *   Amninder Singh | asingh@hydropower.ae     | HPEG-001   | User
 *   Akhil          | amukundan@hydropower.ae  | HPEG-002   | User
 *   Nazar Shaikh   | snazar@hydropower.ae     | HPEG-003   | User
 *   Sabir Amin     | samin@hydropower.ae      | HPEG-ADMIN | Admin
 * People sign in with EMAIL + Password. Role "Admin" unlocks the oversight
 * views. Email/Role are optional — if absent, login falls back to Name.
 *
 * INSTALL:
 *   Sheet → Extensions → Apps Script → paste this as Code.gs.
 *   For the served build, also add an HTML file named "Index" and paste
 *   index.html into it, then Deploy → Web app (Execute as: Me).
 */

// ======================= CONFIG =======================
var CONFIG = {
  // Your sheet id (from the URL: /spreadsheets/d/<THIS>/edit). Needed because
  // this script is standalone (not created from the sheet).
  SPREADSHEET_ID: '1eqRc318-sQ7qZYMDlmfVCqo7Gu6_Z3HCbaqFDgE3hiI',

  // Login users live here. Column A = Name, Column B = Password.
  USERS_TAB: 'Users',

  // Project value sent by the app  ->  the permit tab that holds its rows.
  PROJECT_TABS: {
    'TWS O-16123': 'TWS O-16123 Permit Log',
    'TWS O-16124': 'TWS O-16124 Permit Log'
  },

  HTML_FILE: 'Index'
};

// Columns written to each permit tab (existing columns are kept; any missing
// ones are appended). Per-project tabs, so no "Project" column is needed.
var COLUMNS = [
  'Date', 'Time', 'Permit No.', 'Permit Type', 'Location', 'Contractor',
  'Supervisor', 'Work Description', 'Hazards', 'Control Measures',
  'Permit Issuer', 'Valid From', 'Valid To', 'Status',
  'Logged By', 'Logged At', 'Verified'
];

var FIELD_TO_HEADER = {
  date: 'Date', time: 'Time', permitNo: 'Permit No.', permitTypeName: 'Permit Type',
  location: 'Location', contractor: 'Contractor', supervisor: 'Supervisor',
  workDescription: 'Work Description', hazards: 'Hazards', controlMeasures: 'Control Measures',
  permitIssuer: 'Permit Issuer', validFrom: 'Valid From', validTo: 'Valid To', status: 'Status'
};

// ======================= WEB ENTRY POINTS =======================

function doGet(ev) {
  try {
    var action = ev && ev.parameter && ev.parameter.action;
    if (action === 'list')  return json({ ok: true, rows: listRows((ev.parameter.project) || '') });
    if (action === 'users') return json({ ok: true, users: getUserNames() });
    if (action)             return json({ ok: false, error: 'Unknown action: ' + action });
    try {
      return HtmlService.createHtmlOutputFromFile(CONFIG.HTML_FILE)
        .setTitle('HPEG Permit Log')
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
  var p = parsePayload(ev);
  if (!p) return json({ ok: false, error: 'No payload received' });
  if (p.action === 'login') return json(login_(p.login, p.password));
  return json(savePermit_(p));
}

// ======================= google.script.run API (served build) =======================
function apiLogin(creds) { return login_((creds || {}).login, (creds || {}).password); }
function apiUsers() { return { ok: true, users: getUserNames() }; }
function apiList(project) { return { ok: true, rows: listRows(project || '') }; }
function apiSave(payload) { return savePermit_(payload || {}); }

// ======================= AUTH =======================

// Reads the Users tab BY HEADER NAME (Name / Email / Password / Role) so column
// order doesn't matter and Email/Role are optional.
function usersData_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.USERS_TAB);
  if (!sheet) return null;
  var values = sheet.getDataRange().getValues();
  if (!values.length) return { values: [], idx: {} };
  var headers = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  return {
    values: values,
    idx: {
      name: headers.indexOf('name'),
      email: headers.indexOf('email'),
      password: headers.indexOf('password'),
      role: headers.indexOf('role')
    }
  };
}

// Match by Email (preferred) or Name, plus Password. Returns {name,email,role} or null.
function validateLogin_(loginId, password) {
  var d = usersData_();
  if (!d) return null;
  var idx = d.idx, values = d.values;
  var wantId = String(loginId || '').trim().toLowerCase();
  var wantPass = String(password || '').trim();
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var name  = idx.name  >= 0 ? String(row[idx.name]  || '').trim() : String(row[0] || '').trim();
    var email = idx.email >= 0 ? String(row[idx.email] || '').trim() : '';
    var pass  = idx.password >= 0 ? String(row[idx.password] || '').trim() : String(row[1] || '').trim();
    var role  = idx.role  >= 0 ? String(row[idx.role]  || '').trim() : '';
    if (!pass) continue;
    var idMatch = (email && email.toLowerCase() === wantId) || (name && name.toLowerCase() === wantId);
    if (idMatch && pass === wantPass) return { name: name || email, email: email, role: role || 'User' };
  }
  return null;
}

function login_(loginId, password) {
  var u = validateLogin_(loginId, password);
  if (!u) return { ok: false, error: 'Invalid email or password.' };
  return { ok: true, name: u.name, email: u.email, role: u.role };
}

// Names only — passwords/emails never leave the server via this call.
function getUserNames() {
  var d = usersData_();
  if (!d) return [];
  var idx = d.idx, values = d.values, out = [];
  for (var i = 1; i < values.length; i++) {
    var name = idx.name >= 0 ? String(values[i][idx.name] || '').trim() : String(values[i][0] || '').trim();
    if (name && out.indexOf(name) === -1) out.push(name);
  }
  return out;
}

// ======================= SAVE =======================

function savePermit_(payload) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);

    // 🔒 Re-validate credentials on every save. The name written is the one the
    // email + password belong to — never a browser-supplied name.
    var authUser = validateLogin_(payload.authLogin, payload.authPassword);
    if (!authUser) return { ok: false, error: 'AUTH: your login was not accepted. Please sign in again.' };
    var authName = authUser.name;

    var sheet = getSheetForProject_(payload.project || '');
    if (!sheet) return { ok: false, error: 'No permit tab configured for project: ' + (payload.project || '(blank)') };

    var headers = ensureHeaders(sheet);
    var row = headers.map(function (h) {
      for (var key in FIELD_TO_HEADER) {
        if (FIELD_TO_HEADER[key] === h) return payload[key] != null ? payload[key] : '';
      }
      if (h === 'Logged By') return authName;
      if (h === 'Logged At') return payload.clientLoggedAt || new Date().toISOString();
      if (h === 'Verified')  return 'YES';
      return '';
    });

    sheet.appendRow(row);
    return { ok: true, success: true, loggedBy: authName };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ======================= SHEET HELPERS =======================

function getSpreadsheet_() {
  if (CONFIG.SPREADSHEET_ID) return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No spreadsheet: set CONFIG.SPREADSHEET_ID.');
  return ss;
}

function getSheetForProject_(project) {
  var ss = getSpreadsheet_();
  var tabName = CONFIG.PROJECT_TABS[project];
  if (tabName) return ss.getSheetByName(tabName) || ss.insertSheet(tabName);
  return ss.getSheetByName(project);   // fallback: a tab named exactly like the project
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
  var ss = getSpreadsheet_();
  var tabName = CONFIG.PROJECT_TABS[project] || project;
  var sheet = ss.getSheetByName(tabName);
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
    if (hasData) rows.push(obj);
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
