/**
 * Dentory — ประวัติสียางจัดฟัน (Google Apps Script)
 * ---------------------------------------------------
 * วางไฟล์นี้ใน Extensions > Apps Script ของ Google Sheet "ประวัติสียาง Dentory"
 * แล้ว Deploy เป็น Web app (Execute as: Me, Who has access: Anyone)
 *
 * เว็บเลือกสียาง (dentoryclinic.github.io/Your-choose) ส่งคำขอมาที่นี่ 3 แบบ:
 *   save  — บันทึกรายการเมื่อคนไข้กดยืนยัน
 *   mine  — คนไข้ดูประวัติของตัวเอง (ยืนยันตัวตนกับ LINE ทุกครั้ง)
 *   staff — พนักงานค้นประวัติ (ต้องใช้รหัสพนักงาน)
 */

var SHEET_NAME = 'ประวัติสียาง';
var LINE_CHANNEL_ID = '2012114486';   // LINE Login channel ID (ตัวเลขหน้าขีดของ LIFF ID)
var TZ = 'Asia/Bangkok';
var HEADERS = ['วันที่บันทึก', 'ชื่อ', 'เบอร์', 'ชื่อ LINE', 'LINE userId', 'วันนัด',
               'เบอร์สี', 'สีที่เลือก', 'ฟันบน', 'ฟันล่าง', 'หมายเหตุ', 'ช่องทาง'];
var COL = { ts: 0, name: 1, phone: 2, lineName: 3, uid: 4, appt: 5, colors: 6, colorText: 7, upper: 8, lower: 9, note: 10, src: 11 };

/** รันครั้งเดียวตอนตั้งค่า: สร้างแท็บและหัวตาราง */
function setup() {
  var sh = getSheet_();
  Logger.log('พร้อมใช้งาน: แท็บ "' + SHEET_NAME + '" ' + (sh.getLastRow() - 1) + ' แถว');
  if (!PropertiesService.getScriptProperties().getProperty('STAFF_PIN')) {
    Logger.log('อย่าลืมตั้งรหัสพนักงาน: Project Settings > Script Properties > เพิ่ม STAFF_PIN');
  }
}

function doGet() {
  return out_({ ok: true, service: 'dentory-braces-history' });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return out_({ ok: false, error: 'bad_request' }); }
  try {
    if (req.action === 'save') return out_(save_(req));
    if (req.action === 'mine') return out_(mine_(req));
    if (req.action === 'staff') return out_(staff_(req));
    return out_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    console.error(err);
    return out_({ ok: false, error: 'server_error' });
  }
}

/* ---------- actions ---------- */

function save_(req) {
  if (tooMany_('save', 120, 600)) return { ok: false, error: 'busy' };
  var upper = teeth_(req.upper), lower = teeth_(req.lower);
  var colors = uniq_(upper.concat(lower).filter(function (x) { return x != null; }));
  if (!colors.length) return { ok: false, error: 'no_colors' };
  var user = verifyLine_(req.idToken);
  var names = Array.isArray(req.colorNames) ? req.colorNames : [];
  var colorText = colors.map(function (n, i) { return '#' + n + (names[i] ? ' ' + clean_(names[i], 20) : ''); }).join(', ');
  var row = [
    nowBE_(),
    cell_(req.name, 60) || (user ? user.name : ''),
    cell_(String(req.phone || '').replace(/[^0-9]/g, ''), 15),
    user ? cell_(user.name, 60) : '',
    user ? user.sub : '',
    isoToBE_(req.apptDate),
    colors.join('+'),
    cell_(colorText, 200),
    upper.map(dash_).join(','),
    lower.map(dash_).join(','),
    cell_(req.note, 200),
    user ? 'LINE' : 'เว็บ'
  ];
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { getSheet_().appendRow(row); } finally { lock.releaseLock(); }
  return { ok: true, linked: !!user };
}

function mine_(req) {
  var user = verifyLine_(req.idToken);
  if (!user) return { ok: false, error: 'auth' };
  var rows = readRows_().filter(function (r) { return r[COL.uid] === user.sub; });
  return { ok: true, name: user.name, visits: rows.reverse().slice(0, 30).map(visit_) };
}

function staff_(req) {
  var props = PropertiesService.getScriptProperties();
  var pin = props.getProperty('STAFF_PIN');
  if (!pin) return { ok: false, error: 'no_pin_set' };
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('pinfail') || 0);
  if (fails >= 10) return { ok: false, error: 'locked' };
  if (String(req.pin || '') !== pin) {
    cache.put('pinfail', String(fails + 1), 600);
    return { ok: false, error: 'bad_pin' };
  }
  var all = readRows_();
  var today = todayBE_();
  var todayRows = all.filter(function (r) { return String(r[COL.ts]).indexOf(today) === 0; });
  var q = String(req.q || '').trim().toLowerCase();
  var qDigits = q.replace(/[^0-9]/g, '');
  var hits;
  if (q) {
    hits = all.filter(function (r) {
      var hay = (r[COL.name] + ' ' + r[COL.lineName]).toLowerCase();
      return hay.indexOf(q) !== -1 || (qDigits.length >= 3 && String(r[COL.phone]).indexOf(qDigits) !== -1);
    });
  } else {
    hits = all.filter(function (r) { return r[COL.appt] === today || String(r[COL.ts]).indexOf(today) === 0; });
    if (!hits.length) hits = all.slice(-20);
  }
  // group by person: LINE account first, then phone, then name
  var groups = {}, order = [];
  hits.slice().reverse().forEach(function (r) {
    var key = r[COL.uid] || ('p:' + r[COL.phone]) || ('n:' + r[COL.name]);
    if (!r[COL.uid] && !r[COL.phone]) key = 'n:' + r[COL.name];
    if (!groups[key]) { groups[key] = { name: r[COL.name], phone: r[COL.phone], lineName: r[COL.lineName], uid: r[COL.uid], visits: [] }; order.push(key); }
  });
  // full history for each matched person (not just the matching rows)
  all.slice().reverse().forEach(function (r) {
    order.forEach(function (key) {
      var g = groups[key];
      var same = g.uid ? r[COL.uid] === g.uid : (g.phone ? r[COL.phone] === g.phone : r[COL.name] === g.name);
      if (same && g.visits.length < 20) g.visits.push(visit_(r));
    });
  });
  props.setProperty('STAFF_LAST_LOGIN', nowBE_());
  return {
    ok: true,
    today: today,
    todayCount: uniq_(todayRows.map(function (r) { return r[COL.uid] || r[COL.phone] || r[COL.name]; })).length,
    totalCount: all.length,
    patients: order.slice(0, 30).map(function (k) { var g = groups[k]; delete g.uid; return g; })
  };
}

/* ---------- LINE ID token check ---------- */

function verifyLine_(idToken) {
  if (!idToken || typeof idToken !== 'string' || idToken.length > 4000) return null;
  var cache = CacheService.getScriptCache();
  var key = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)).slice(0, 40);
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post',
    payload: { id_token: idToken, client_id: LINE_CHANNEL_ID },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) return null;
  var j = JSON.parse(res.getContentText());
  if (!j.sub) return null;
  var user = { sub: j.sub, name: j.name || '' };
  cache.put(key, JSON.stringify(user), 300);
  return user;
}

/* ---------- helpers ---------- */

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#f1f3f6');
    sh.setFrozenRows(1);
    sh.getRange('A:L').setNumberFormat('@');   // เก็บเป็นข้อความ เบอร์ขึ้นต้น 0 ไม่หาย
    sh.hideColumns(COL.uid + 1);                 // ซ่อน LINE userId (ใช้จับคู่เท่านั้น)
  }
  return sh;
}

function readRows_() {
  var sh = getSheet_();
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, HEADERS.length).getDisplayValues();
}

function visit_(r) {
  return {
    date: r[COL.ts], appt: r[COL.appt], colors: String(r[COL.colors]).split('+').map(Number).filter(Boolean),
    upper: String(r[COL.upper]).split(',').map(undash_), lower: String(r[COL.lower]).split(',').map(undash_),
    note: r[COL.note]
  };
}

function teeth_(a) {
  var out = [];
  for (var i = 0; i < 8; i++) {
    var v = Array.isArray(a) ? Number(a[i]) : NaN;
    out.push(v >= 1 && v <= 200 && Math.floor(v) === v ? v : null);
  }
  return out;
}
function dash_(x) { return x == null ? '-' : String(x); }
function undash_(x) { var v = Number(x); return v ? v : null; }
function uniq_(a) { var o = []; a.forEach(function (x) { if (o.indexOf(x) === -1) o.push(x); }); return o; }
function clean_(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max); }
function cell_(v, max) { var s = clean_(v, max); return /^[=+\-@]/.test(s) ? "'" + s : s; } // กันสูตรแฝงใน Sheet

function beDate_(d, withTime) {
  var p = Utilities.formatDate(d, TZ, 'dd/MM/yyyy/HH:mm').split('/');
  return p[0] + '/' + p[1] + '/' + (Number(p[2]) + 543) + (withTime ? ' ' + p[3] : '');
}
function nowBE_() { return beDate_(new Date(), true); }
function todayBE_() { return beDate_(new Date(), false); }
function isoToBE_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? m[3] + '/' + m[2] + '/' + (Number(m[1]) + 543) : '';
}

function tooMany_(name, limit, seconds) {
  var cache = CacheService.getScriptCache();
  var k = 'rate_' + name, n = Number(cache.get(k) || 0) + 1;
  cache.put(k, String(n), seconds);
  return n > limit;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
