const FOLDER_NAME = '送迎管理データ_JSON';
const APP_TOKEN = 'change-me';

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.token !== APP_TOKEN) return json({ ok:false, message:'認証トークンが違います。' });
    const action = body.action;
    const payload = body.payload || {};
    if (action === 'ping') return json({ ok:true, data:{ time:new Date().toISOString() } });
    if (action === 'setupDrive') return json({ ok:true, data:setupDrive() });
    if (action === 'getFiscalData') return json({ ok:true, data:getFiscalData_(Number(payload.fiscalYear)) });
    if (action === 'saveFiscalData') return json({ ok:true, data:saveFiscalData_(Number(payload.fiscalYear), payload.data || {}) });
    if (action === 'importFiscalFromMonths') return json({ ok:true, data:importFiscalFromMonths_(Number(payload.fiscalYear), true) });
    if (action === 'getMonthData') return json({ ok:true, data:getMonthData_(payload.month) });
    if (action === 'saveMonthData') return json({ ok:true, data:saveMonthData_(payload.month, payload.data || {}) });
    if (action === 'saveMasters') return json({ ok:true, data:saveJson_('masters.json', payload.masters || {}) });
    if (action === 'createBackup') return json({ ok:true, data:createBackup_(payload.target || 'manual', payload.month || '') });
    return json({ ok:false, message:'未対応の処理です: ' + action });
  } catch (err) {
    return json({ ok:false, message:String(err && err.message || err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function setupDrive() {
  const folder = getFolder_();
  if (!getFile_('system.json')) saveJson_('system.json', { version: 1, currentFiscalYear: fiscalYearFromDate_(new Date()) });
  if (!getFile_('masters.json')) saveJson_('masters.json', { children: [], staff: [], places: [] });
  getBackupFolder_();
  return { folderId: folder.getId(), folderName: FOLDER_NAME };
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
  return JSON.parse(txt);
}

function saveJson_(name, data) {
  const folder = getFolder_();
  const payload = JSON.stringify(data, null, 2);
  let f = getFile_(name);
  if (f) f.setContent(payload); else f = folder.createFile(name, payload, MimeType.PLAIN_TEXT);
  return { name: name, updatedAt: new Date().toISOString(), fileId: f.getId() };
}

function fiscalMonths_(fy) {
  const arr = [];
  for (let i = 0; i < 12; i++) {
    const m = i + 4;
    const y = m <= 12 ? fy : fy + 1;
    const mm = m <= 12 ? m : m - 12;
    arr.push(y + '-' + ('0' + mm).slice(-2));
  }
  return arr;
}

function fiscalYearFromMonth_(ym) {
  const parts = String(ym).split('-').map(Number);
  return parts[1] >= 4 ? parts[0] : parts[0] - 1;
}

function fiscalYearFromDate_(d) {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return m >= 4 ? y : y - 1;
}

function fiscalFileName_(fy) { return 'fiscal-' + fy + '.json'; }

function getFiscalData_(fy) {
  if (!fy) fy = fiscalYearFromDate_(new Date());
  let fiscal = readJson_(fiscalFileName_(fy), null);
  if (!fiscal) fiscal = importFiscalFromMonths_(fy, false);
  const masters = readJson_('masters.json', fiscal.masters || { children: [], staff: [], places: [] });
  const holidays = readJson_('holidays.json', fiscal.holidays || { items: [] });
  fiscal.fiscalYear = fy;
  fiscal.months = fiscal.months || {};
  fiscalMonths_(fy).forEach(function(month){
    if (!fiscal.months[month]) fiscal.months[month] = { schedules: [], trips: [], changes: [], logs: [], meta: {} };
  });
  fiscal.masters = masters;
  fiscal.holidays = holidays;
  fiscal.meta = fiscal.meta || {};
  return fiscal;
}

function saveFiscalData_(fy, data) {
  if (!fy) fy = Number(data.fiscalYear) || fiscalYearFromDate_(new Date());
  data.fiscalYear = fy;
  data.updatedAt = new Date().toISOString();
  data.meta = data.meta || {};
  data.meta.version = Number(data.meta.version || 0) + 1;
  if (data.masters) saveJson_('masters.json', data.masters);
  if (data.holidays) saveJson_('holidays.json', data.holidays);
  return saveJson_(fiscalFileName_(fy), data);
}

function importFiscalFromMonths_(fy, persist) {
  if (!fy) fy = fiscalYearFromDate_(new Date());
  const fiscal = {
    fiscalYear: fy,
    createdAt: new Date().toISOString(),
    meta: { version: 1 },
    masters: readJson_('masters.json', { children: [], staff: [], places: [] }),
    holidays: readJson_('holidays.json', { items: [] }),
    config: readJson_('config.json', {}),
    months: {},
    logs: []
  };
  fiscalMonths_(fy).forEach(function(month){
    const legacy = getMonthData_(month);
    fiscal.months[month] = {
      schedules: legacy.schedules || [],
      trips: legacy.trips || [],
      changes: legacy.changes || [],
      logs: legacy.logs || [],
      meta: legacy.meta || {}
    };
  });
  if (persist) saveFiscalData_(fy, fiscal);
  return fiscal;
}

function getMonthData_(month) {
  const fallback = { items: [] };
  const schedules = readJson_('schedules-' + month + '.json', fallback);
  const trips = readJson_('trips-' + month + '.json', fallback);
  const changes = readJson_('changes-' + month + '.json', fallback);
  const logs = readJson_('logs-' + month + '.json', fallback);
  return {
    meta: schedules.meta || {},
    masters: readJson_('masters.json', { children: [], staff: [], places: [] }),
    holidays: readJson_('holidays.json', { items: [] }),
    config: readJson_('config.json', {}),
    schedules: schedules.items || schedules.schedules || schedules || [],
    trips: trips.items || trips.trips || trips || [],
    changes: changes.items || changes.changes || changes || [],
    logs: logs.items || logs.logs || logs || []
  };
}

function saveMonthData_(month, data) {
  saveJson_('schedules-' + month + '.json', { meta: data.meta || {}, items: data.schedules || [] });
  saveJson_('trips-' + month + '.json', { items: data.trips || [] });
  saveJson_('changes-' + month + '.json', { items: data.changes || [] });
  saveJson_('logs-' + month + '.json', { items: data.logs || [] });
  if (data.masters) saveJson_('masters.json', data.masters);
  if (data.holidays) saveJson_('holidays.json', data.holidays);
  if (data.config) saveJson_('config.json', data.config);
  return { month: month, updatedAt: new Date().toISOString() };
}

function createBackup_(target, month) {
  const folder = getBackupFolder_();
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  const name = 'backup-' + target + (month ? '-' + month : '') + '-' + stamp + '.json';
  const data = { target: target, month: month, createdAt: new Date().toISOString() };
  folder.createFile(name, JSON.stringify(data, null, 2), MimeType.PLAIN_TEXT);
  return { name: name };
}
