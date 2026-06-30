const FOLDER_NAME = '送迎管理データ_JSON';
const APP_TOKEN = 'change-me';

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.token !== APP_TOKEN) return json_({ ok:false, message:'認証トークンが違います。' });
    const action = body.action;
    const payload = body.payload || {};
    if (action === 'ping') return json_({ ok:true, data:{ time:new Date().toISOString() } });
    if (action === 'setupDrive') return json_({ ok:true, data:setupDrive_() });
    if (action === 'getFiscalData') return json_({ ok:true, data:getFiscalData_(Number(payload.fiscalYear)) });
    if (action === 'saveFiscalData') return json_({ ok:true, data:saveFiscalData_(Number(payload.fiscalYear), payload.data || {}) });
    if (action === 'importFiscalFromMonths') return json_({ ok:true, data:importFiscalFromMonths_(Number(payload.fiscalYear), true) });
    return json_({ ok:false, message:'未対応の処理です: ' + action });
  } catch (err) {
    return json_({ ok:false, message:String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function setupDrive_() {
  const folder = getFolder_();
  if (!getFile_('system.json')) saveJson_('system.json', { version:1, currentFiscalYear:fiscalYearFromDate_(new Date()), updatedAt:new Date().toISOString() });
  if (!getFile_('masters.json')) saveJson_('masters.json', { children:[], staff:[], places:[] });
  if (!getFile_('holidays.json')) saveJson_('holidays.json', { items:[] });
  getBackupFolder_();
  return { folderId:folder.getId(), folderName:FOLDER_NAME };
}

function getFolder_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}
function getBackupFolder_() {
  const parent = getFolder_();
  const it = parent.getFoldersByName('backups');
  return it.hasNext() ? it.next() : parent.createFolder('backups');
}
function getFile_(name) {
  const it = getFolder_().getFilesByName(name);
  return it.hasNext() ? it.next() : null;
}
function readJson_(name, fallback) {
  const f = getFile_(name);
  if (!f) return fallback;
  const txt = f.getBlob().getDataAsString('UTF-8');
  if (!txt) return fallback;
  try { return JSON.parse(txt); } catch (err) { throw new Error(name + ' のJSON形式が不正です。'); }
}
function saveJson_(name, data) {
  const payload = JSON.stringify(data, null, 2);
  let f = getFile_(name);
  if (f) f.setContent(payload);
  else f = getFolder_().createFile(name, payload, MimeType.PLAIN_TEXT);
  return { name:name, fileId:f.getId(), updatedAt:new Date().toISOString() };
}
function backupJson_(name, label) {
  const f = getFile_(name);
  if (!f) return null;
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  const backupName = 'backup-' + label + '-' + stamp + '.json';
  getBackupFolder_().createFile(backupName, f.getBlob().getDataAsString('UTF-8'), MimeType.PLAIN_TEXT);
  return backupName;
}
function fiscalYearFromDate_(d) {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return m >= 4 ? y : y - 1;
}
function fiscalYearFromMonth_(ym) {
  const p = String(ym).split('-').map(Number);
  return p[1] >= 4 ? p[0] : p[0] - 1;
}
function fiscalMonths_(fy) {
  const arr = [];
  for (let i=0;i<12;i++) {
    const m = i + 4;
    const y = m <= 12 ? fy : fy + 1;
    const mm = m <= 12 ? m : m - 12;
    arr.push(y + '-' + ('0' + mm).slice(-2));
  }
  return arr;
}
function fiscalFile_(fy) { return 'fiscal-' + fy + '.json'; }

function getFiscalData_(fy) {
  if (!fy) fy = fiscalYearFromDate_(new Date());
  let fiscal = readJson_(fiscalFile_(fy), null);
  if (!fiscal) fiscal = importFiscalFromMonths_(fy, false);
  fiscal.fiscalYear = fy;
  fiscal.months = fiscal.months || {};
  fiscalMonths_(fy).forEach(function(month){
    if (!fiscal.months[month]) fiscal.months[month] = { schedules:[], trips:[], changes:[], logs:[], meta:{} };
  });
  fiscal.masters = readJson_('masters.json', fiscal.masters || { children:[], staff:[], places:[] });
  fiscal.holidays = readJson_('holidays.json', fiscal.holidays || { items:[] });
  fiscal.config = fiscal.config || readJson_('config.json', {});
  fiscal.meta = fiscal.meta || { version:0 };
  return fiscal;
}

function saveFiscalData_(fy, data) {
  if (!fy) fy = Number(data.fiscalYear) || fiscalYearFromDate_(new Date());
  const name = fiscalFile_(fy);
  backupJson_(name, 'fiscal-' + fy);
  data.fiscalYear = fy;
  data.meta = data.meta || {};
  data.meta.version = Number(data.meta.version || 0) + 1;
  data.meta.updatedAt = new Date().toISOString();
  if (data.masters) saveJson_('masters.json', data.masters);
  if (data.holidays) saveJson_('holidays.json', data.holidays);
  return saveJson_(name, data);
}

function importFiscalFromMonths_(fy, persist) {
  if (!fy) fy = fiscalYearFromDate_(new Date());
  const fiscal = {
    fiscalYear:fy,
    meta:{ version:1, createdAt:new Date().toISOString(), source:'legacy-month-json' },
    months:{},
    masters:readJson_('masters.json', { children:[], staff:[], places:[] }),
    holidays:readJson_('holidays.json', { items:[] }),
    config:readJson_('config.json', {}),
    logs:[]
  };
  fiscalMonths_(fy).forEach(function(month){
    fiscal.months[month] = readLegacyMonth_(month);
  });
  if (persist) saveFiscalData_(fy, fiscal);
  return fiscal;
}

function readLegacyMonth_(month) {
  const schedules = readJson_('schedules-' + month + '.json', { items:[] });
  const trips = readJson_('trips-' + month + '.json', { items:[] });
  const changes = readJson_('changes-' + month + '.json', { items:[] });
  const logs = readJson_('logs-' + month + '.json', { items:[] });
  return {
    schedules:schedules.items || schedules.schedules || schedules || [],
    trips:trips.items || trips.trips || trips || [],
    changes:changes.items || changes.changes || changes || [],
    logs:logs.items || logs.logs || logs || [],
    meta:schedules.meta || {}
  };
}
