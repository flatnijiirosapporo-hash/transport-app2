'use strict';

const APP_VERSION = '本番統合版 1.7.0';
const STORAGE_KEY = 'nijiiro.transport.settings.v62';
const CACHE_PREFIX = 'nijiiro.transport.fiscal.';
const WEEK = ['日','月','火','水','木','金','土'];
const pad = n => String(n).padStart(2,'0');
const today = new Date();
const todayYmd = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
const todayYm = todayYmd.slice(0,7);

const app = document.getElementById('app');
const state = {
  view: (location.hash || '#dashboard').replace('#',''),
  month: todayYm,
  date: todayYmd,
  mode: 'day',
  fiscalYear: fiscalYearFromYm(todayYm),
  fiscalData: null,
  data: null,
  loading: false,
  lastLoaded: '',
  notice: null,
  autoRefresh: false,
  dirty: false,
  filters: { child:'', staff:'', status:'予定', range:'month', date: todayYmd },
  staffPage: { staff:'', range:'day' },
  addForms: [{ id: uid('add') }],
  nextPreview: null,
  editingStaffId: '',
  editingChildId: ''
};

function uid(prefix='id'){ return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`; }
function esc(v){ return String(v ?? '').replace(/[&<>"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s])); }
function ymd(date){ return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`; }
function ymFromDate(date){ return ymd(date).slice(0,7); }
function jpDate(v){ const d=new Date(`${v}T00:00:00`); return `${Number(v.slice(5,7))}/${Number(v.slice(8,10))}（${WEEK[d.getDay()]}）`; }
function addMonths(ym, delta){ const d=new Date(`${ym}-01T00:00:00`); d.setMonth(d.getMonth()+delta); return ymd(d).slice(0,7); }
function fiscalYearFromYm(ym){ const [y,m]=ym.split('-').map(Number); return m>=4 ? y : y-1; }
function fiscalMonths(fy){ return Array.from({length:12},(_,i)=>{ const m=i+4; const y=m<=12?fy:fy+1; const mm=m<=12?m:m-12; return `${y}-${pad(mm)}`; }); }
function fiscalLabel(fy){ return `${fy}年度（${fy}/4〜${fy+1}/3）`; }
function daysInMonth(ym){ const [y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate(); }
function monthDays(ym){ return Array.from({length:daysInMonth(ym)},(_,i)=>`${ym}-${pad(i+1)}`); }
function getWeekday(date){ return WEEK[new Date(`${date}T00:00:00`).getDay()]; }
function activeSchedule(s){ return !['欠席','休み','取消','削除'].includes(String(s.status||'')); }
function getSettings(){ try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')}catch{return{}} }
function saveSettings(v){ localStorage.setItem(STORAGE_KEY, JSON.stringify(v||{})); }
function configured(){ const s=getSettings(); return Boolean(s.gasUrl && s.appToken); }
function cacheKey(fiscalYear){ return CACHE_PREFIX + fiscalYear; }
function readCache(fiscalYear){ try{return JSON.parse(localStorage.getItem(cacheKey(fiscalYear))||'null')}catch{return null} }
function writeCache(fiscalYear,data){ try{localStorage.setItem(cacheKey(fiscalYear), JSON.stringify(data));}catch{} }

function normalizeName(o){ return o?.displayName || o?.name || o?.childName || o?.staffName || o?.id || ''; }
function normalizeMasters(m={}){
  const children=(m.children||[]).map((c,i)=>({
    ...c,
    id:c.id||c.childId||`child_${i+1}`,
    displayName:normalizeName(c),
    enabled:c.enabled!==false && c.active!==false,
    routes:normalizeRoutes(c)
  }));
  const staff=(m.staff||[]).map((s,i)=>({
    ...s,
    id:s.id||s.staffId||`staff_${i+1}`,
    displayName:normalizeName(s),
    role:s.role||'',
    order:Number(s.order||s.sortOrder||999),
    canDrive:Boolean(s.canDrive||s.drive),
    canRide:Boolean(s.canRide||s.ride||s.canSupport),
    enabled:s.enabled!==false && s.active!==false
  })).sort((a,b)=>(a.order-b.order)||a.displayName.localeCompare(b.displayName,'ja'));
  const places=(m.places||[]).map((p,i)=>({...p,id:p.id||`place_${i+1}`,name:p.name||p.displayName||'',type:p.type||'両方',enabled:p.enabled!==false}));
  return {...m,children,staff,places};
}
function normalizeRoutes(c){
  if(Array.isArray(c.routes)) return c.routes;
  const routes=[];
  const add=(type,mode,text)=>parseRouteText(text).forEach(r=>routes.push({type,mode,...r,enabled:true}));
  add('pickup','normal', c.normalPickup || c.usualPickup || c.defaultPickup || line(c.defaultPickupTime,c.defaultPickupPlace,c.defaultPickupStaff));
  add('dropoff','normal', c.normalDropoff || c.usualDropoff || c.defaultDropoff || line(c.defaultDropoffTime,c.defaultDropoffPlace,c.defaultDropoffStaff));
  add('pickup','longHoliday', c.longHolidayPickup || c.holidayPickup || c.longPickup);
  add('dropoff','longHoliday', c.longHolidayDropoff || c.holidayDropoff || c.longDropoff);
  add('pickup','event', c.eventPickup);
  add('dropoff','event', c.eventDropoff);
  return routes;
}
function line(time,place,staff){ return [time,place,staff].filter(Boolean).join('|'); }
function parseRouteText(text){
  if(Array.isArray(text)) return text;
  return String(text||'').split(/\n+/).map(x=>x.trim()).filter(Boolean).map(row=>{
    const p=row.includes('|')?row.split('|').map(x=>x.trim()):row.split(/\s+/);
    return {days:p[0]?.match(/^[月火水木金土日]+$/)?p[0].split(''):[], time:p[0]?.match(/^\d{1,2}:\d{2}$/)?p[0]:(p[1]?.match(/^\d{1,2}:\d{2}$/)?p[1]:''), place:p[0]?.match(/^\d{1,2}:\d{2}$/)?(p[1]||''):(p[2]||p[1]||''), staff:p[0]?.match(/^\d{1,2}:\d{2}$/)?(p[2]||''):(p[3]||''), note:p.slice(4).join(' ')};
  });
}
function routeText(child,type,mode){
  return (child.routes||[]).filter(r=>r.type===type&&r.mode===mode&&r.enabled!==false).map(r=>`${(r.days||[]).join('')}|${r.time||''}|${r.place||''}|${r.staff||''}|${r.note||''}`.replace(/^\|/,'')).join('\n');
}
function normalizeSchedule(s={}){ return {
  ...s,
  id:s.id||uid('sch'),
  child:s.child||s.childName||s.childDisplayName||s.name||'',
  childId:s.childId||'',
  status:s.status||'予定',
  pickupTime:s.pickupTime||s.pickupAt||'',
  pickupPlace:s.pickupPlace||s.from||s.fromPlace||'',
  pickupStaff:s.pickupStaff||s.pickupStaffName||'',
  dropoffTime:s.dropoffTime||s.dropoffAt||'',
  dropoffPlace:s.dropoffPlace||s.to||s.toPlace||'',
  dropoffStaff:s.dropoffStaff||s.dropoffStaffName||'',
  note:s.note||s.memo||''
}; }
function normalizeData(raw={}){
  const masters=normalizeMasters(raw.masters||{});
  const schedules=(raw.schedules?.items||raw.schedules||[]).map(normalizeSchedule).map(s=>{
    const c=masters.children.find(x=>x.id===s.childId || x.displayName===s.child);
    return {...s, childId:s.childId||c?.id||'', child:s.child||c?.displayName||''};
  });
  return {
    meta:raw.meta||raw.schedules?.meta||{},
    masters,
    holidays:raw.holidays||{items:[]},
    schedules,
    trips:raw.trips?.items||raw.trips||[],
    changes:raw.changes?.items||raw.changes||[],
    logs:raw.logs?.items||raw.logs||[],
    config:raw.config||{},
    backups:raw.backups||[]
  };
}
function normalizeFiscalData(raw={}){
  const source = raw.fiscal || raw;
  const masters = normalizeMasters(raw.masters || source.masters || {});
  const holidays = raw.holidays || source.holidays || {items:[]};
  const config = raw.config || source.config || {};
  const months = {};
  Object.entries(source.months || {}).forEach(([month, val])=>{
    const pack = Array.isArray(val) ? {schedules:val} : (val || {});
    months[month] = {
      schedules:(pack.schedules?.items || pack.schedules || []).map(normalizeSchedule),
      trips:pack.trips?.items || pack.trips || [],
      changes:pack.changes?.items || pack.changes || [],
      logs:pack.logs?.items || pack.logs || [],
      meta:pack.meta || {}
    };
  });
  return {
    meta:source.meta || {},
    fiscalYear:Number(source.fiscalYear || state?.fiscalYear || fiscalYearFromYm(todayYm)),
    months,
    masters,
    holidays,
    config,
    logs:source.logs || []
  };
}
function ensureFiscalMonth(fiscal, month){
  fiscal.months = fiscal.months || {};
  if(!fiscal.months[month]) fiscal.months[month] = {schedules:[],trips:[],changes:[],logs:[],meta:{}};
  return fiscal.months[month];
}
function setMonthFromFiscal(month){
  const fiscal = state.fiscalData || normalizeFiscalData({fiscalYear:state.fiscalYear,months:{},masters:{children:[],staff:[],places:[]}});
  const pack = ensureFiscalMonth(fiscal, month);
  const raw = {
    meta: pack.meta || fiscal.meta || {},
    masters: fiscal.masters,
    holidays: fiscal.holidays,
    config: fiscal.config,
    schedules: pack.schedules || [],
    trips: pack.trips || [],
    changes: pack.changes || [],
    logs: pack.logs || []
  };
  state.month = month;
  state.fiscalYear = fiscalYearFromYm(month);
  state.data = normalizeData(raw);
}
function writeCurrentMonthToFiscal(){
  if(!state.fiscalData) state.fiscalData = normalizeFiscalData({fiscalYear:state.fiscalYear,months:{},masters:{children:[],staff:[],places:[]}});
  const d = currentData();
  state.fiscalData.masters = d.masters;
  state.fiscalData.holidays = d.holidays;
  state.fiscalData.config = d.config;
  state.fiscalData.months[state.month] = {
    schedules:d.schedules || [],
    trips:d.trips || [],
    changes:d.changes || [],
    logs:d.logs || [],
    meta:d.meta || {}
  };
  return state.fiscalData;
}
function currentData(){ return state.data || normalizeData({masters:{children:[],staff:[],places:[]},schedules:[]}); }

async function request(action,payload={}){
  const s=getSettings();
  if(!s.gasUrl || !s.appToken) throw new Error('データ設定をしてください。');
  const res=await fetch(s.gasUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,token:s.appToken,operator:s.operator||'未設定',payload})});
  const text=await res.text();
  let json; try{json=JSON.parse(text)}catch{throw new Error('GASの応答を読み取れません。URLと公開設定を確認してください。')}
  if(!json.ok) throw new Error(json.message||'処理に失敗しました。');
  return json;
}
const api={
  ping:()=>request('ping'),
  setupDrive:()=>request('setupDrive'),
  getFiscalData:(fiscalYear)=>request('getFiscalData',{fiscalYear}),
  saveFiscalData:(fiscalYear,data,expectedVersion)=>request('saveFiscalData',{fiscalYear,data,expectedVersion}),
  importFiscalFromMonths:(fiscalYear)=>request('importFiscalFromMonths',{fiscalYear}),
  getMonthData:(month)=>request('getMonthData',{month}),
  saveMonthData:(month,data,expectedVersion)=>request('saveMonthData',{month,data,expectedVersion}),
  saveMasters:(masters,expectedVersion)=>request('saveMasters',{masters,expectedVersion}),
  createBackup:(target,month)=>request('createBackup',{target,month})
};

function showNotice(title,message,type='ok'){ state.notice={title,message,type}; renderNotice(); }
function closeNotice(){ state.notice=null; renderNotice(); }
function renderNotice(){
  document.querySelectorAll('.notice').forEach(e=>e.remove());
  if(!state.notice) return;
  const div=document.createElement('div'); div.className='notice';
  div.innerHTML=`<div class="notice-card"><h2>${esc(state.notice.title)}</h2><p>${esc(state.notice.message)}</p><button class="primary" id="closeNotice">閉じる</button></div>`;
  document.body.appendChild(div); document.getElementById('closeNotice').onclick=closeNotice;
}
async function loadFiscal(fiscalYear=state.fiscalYear,{force=false,silent=false,month=state.month}={}){
  state.fiscalYear=Number(fiscalYear);
  const months=fiscalMonths(state.fiscalYear);
  if(!months.includes(month)) month=months[0];
  state.month=month;
  state.date = state.date?.startsWith(month) ? state.date : `${month}-01`;
  const cached=readCache(state.fiscalYear);
  if(cached && !force){
    state.fiscalData=normalizeFiscalData(cached);
    setMonthFromFiscal(month);
    state.lastLoaded='一時保存データ';
    render();
  }
  if(!configured()) { if(!cached) render(); return; }
  state.loading=true; render();
  try{
    const r=await api.getFiscalData(state.fiscalYear);
    const fiscal=normalizeFiscalData(r.data||{});
    state.fiscalData=fiscal;
    setMonthFromFiscal(month);
    state.lastLoaded=new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
    state.dirty=false;
    writeCache(state.fiscalYear,fiscal);
    if(!silent) showNotice('読み込みました', `${fiscalLabel(state.fiscalYear)} を読み込みました。月切替は画面内で行います。`);
  }catch(e){ showNotice('読み込みできません', e.message, 'bad'); }
  finally{ state.loading=false; render(); }
}
async function loadMonth(month=state.month,{force=false,silent=false}={}){
  const fy=fiscalYearFromYm(month);
  if(fy!==state.fiscalYear || !state.fiscalData || force){ return loadFiscal(fy,{force, silent, month}); }
  state.month=month;
  state.date = state.date?.startsWith(month) ? state.date : `${month}-01`;
  setMonthFromFiscal(month);
  render();
  if(!silent) showNotice('表示しました', `${month} を表示しました。Drive再読み込みはしていません。`);
}
async function saveCurrentMonth(message='保存しました'){
  writeCurrentMonthToFiscal();
  const fiscal=state.fiscalData;
  state.loading=true; render();
  try{
    await api.saveFiscalData(state.fiscalYear, fiscal, fiscal.meta?.version);
    const fresh=await api.getFiscalData(state.fiscalYear);
    state.fiscalData=normalizeFiscalData(fresh.data||fiscal);
    setMonthFromFiscal(state.month);
    state.dirty=false;
    state.lastLoaded=new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
    writeCache(state.fiscalYear,state.fiscalData);
    showNotice(message,'年度データに保存しました。月切替はそのまま表示できます。');
  }catch(e){ showNotice('保存できませんでした', e.message, 'bad'); }
  finally{ state.loading=false; render(); }
}
async function saveMasters(){
  const d=currentData();
  writeCurrentMonthToFiscal();
  state.fiscalData.masters=d.masters;
  state.loading=true; render();
  try{
    await api.saveMasters(d.masters, d.masters?.meta?.version);
    await api.saveFiscalData(state.fiscalYear, state.fiscalData, state.fiscalData.meta?.version);
    await loadFiscal(state.fiscalYear,{force:true,silent:true,month:state.month});
    showNotice('保存しました','マスタと年度データを保存しました。');
  }catch(e){ showNotice('保存できませんでした', e.message, 'bad'); }
  finally{ state.loading=false; render(); }
}
async function importCurrentFiscal(){
  state.loading=true; render();
  try{
    const r=await api.importFiscalFromMonths(state.fiscalYear);
    state.fiscalData=normalizeFiscalData(r.data||{});
    setMonthFromFiscal(state.month);
    writeCache(state.fiscalYear,state.fiscalData);
    showNotice('取込しました', `${fiscalLabel(state.fiscalYear)} を既存の月別データから作成しました。`);
  }catch(e){ showNotice('取込できません', e.message, 'bad'); }
  finally{ state.loading=false; render(); }
}
function Header(){
  const nav=[['dashboard','今日'],['schedule','予定'],['staff','担当'],['changes','変更登録'],['next','翌月作成'],['masters','マスタ'],['print','印刷'],['settings','設定']];
  return `<div class="topbar"><div class="topbar-inner"><div class="brand"><h1>送迎管理</h1><small>${APP_VERSION} ／ ${fiscalLabel(state.fiscalYear)} ／ 最終更新：${esc(state.lastLoaded||'未取得')} ／ 自動更新：${state.autoRefresh?'ON':'OFF'}</small></div><div class="top-actions no-print"><button id="reloadBtn" class="primary">更新</button><button id="autoBtn">自動更新 ${state.autoRefresh?'ON':'OFF'}</button></div></div><div class="mobile-view-switch no-print"><label>画面<select id="mobileViewSelect">${nav.map(([k,l])=>`<option value="${k}" ${state.view===k?'selected':''}>${l}</option>`).join('')}</select></label></div><div class="nav no-print">${nav.map(([k,l])=>`<button data-view="${k}" class="${state.view===k?'active':''}">${l}</button>`).join('')}</div></div>`;
}
function MonthBar(){ const months=fiscalMonths(state.fiscalYear); return `<div class="monthbar no-print"><label>年度<input id="fiscalInput" type="number" value="${esc(state.fiscalYear)}" min="2020" max="2100"></label><button id="applyFiscal">年度読込</button><button id="prevMonth">前月</button><label>表示月<select id="monthInput">${months.map(m=>`<option value="${m}" ${m===state.month?'selected':''}>${m}</option>`).join('')}</select></label><button id="applyMonth">この月を表示</button><button id="nextMonth">翌月</button><label>日付<input id="dateInput" type="date" value="${esc(state.date)}"></label>${state.loading?'<span class="badge warn">読み込み中</span>':''}</div>`; }
function Layout(body){ return `<div class="app-shell">${Header()}${MonthBar()}<main class="container">${body}</main></div>`; }
function Metric(label,value,sub){ return `<div class="metric"><small>${esc(label)}</small><strong>${esc(value)}</strong><small>${esc(sub||'')}</small></div>`; }
function Dashboard(){
  const d=currentData(); const todayRows=d.schedules.filter(s=>s.date===state.date); const active=todayRows.filter(activeSchedule);
  const unset=active.filter(s=>!s.pickupStaff || !s.dropoffStaff).length; const notes=todayRows.filter(s=>s.note).length;
  return `<section class="grid">${Metric('利用予定',`${active.length}名`,jpDate(state.date))}${Metric('迎え',`${active.filter(s=>s.pickupTime||s.pickupPlace).length}件`,'予定データ基準')}${Metric('送り',`${active.filter(s=>s.dropoffTime||s.dropoffPlace).length}件`,'予定データ基準')}${Metric('担当未設定',`${unset}件`,'確認が必要')}${Metric('備考あり',`${notes}件`,'注意事項')}</section>${routeTables(todayRows,'今日の予定')}`;
}
function routeTables(rows,title){
  const pickup=rows.filter(activeSchedule).filter(s=>s.pickupTime||s.pickupPlace||s.pickupStaff).sort((a,b)=>(a.pickupTime||'').localeCompare(b.pickupTime||''));
  const drop=rows.filter(activeSchedule).filter(s=>s.dropoffTime||s.dropoffPlace||s.dropoffStaff).sort((a,b)=>(a.dropoffTime||'').localeCompare(b.dropoffTime||''));
  const table=(type,items)=>`<div class="panel"><div class="panel-head"><div class="panel-title"><h2>${type}</h2><p>${title}</p></div></div><div class="table-wrap"><table><thead><tr><th>時間</th><th>児童名</th><th>場所</th><th>担当</th><th>備考</th></tr></thead><tbody>${items.map(s=>`<tr><td>${esc(type==='迎え'?s.pickupTime:s.dropoffTime)}</td><td>${esc(s.child)}</td><td>${esc(type==='迎え'?s.pickupPlace:s.dropoffPlace)}</td><td>${esc(type==='迎え'?s.pickupStaff:s.dropoffStaff)}</td><td>${esc(s.note)}</td></tr>`).join('')||'<tr><td colspan="5">予定なし</td></tr>'}</tbody></table></div></div>`;
  return `<div class="split">${table('迎え',pickup)}${table('送り',drop)}</div>`;
}
function Schedule(){
  const d=currentData();
  const body=state.mode==='day'?routeTables(d.schedules.filter(s=>s.date===state.date),`${jpDate(state.date)}`):state.mode==='week'?WeekView():MonthView();
  return `<section class="panel no-print"><div class="segmented schedule-mode-tabs"><button data-mode="day" class="${state.mode==='day'?'primary':''}">日</button><button data-mode="week" class="${state.mode==='week'?'primary':''}">週</button><button data-mode="month" class="${state.mode==='month'?'primary':''}">月</button></div></section>${body}`;
}
function WeekView(){ const start=new Date(`${state.date}T00:00:00`); start.setDate(start.getDate()-start.getDay()); const days=Array.from({length:7},(_,i)=>{const x=new Date(start);x.setDate(start.getDate()+i);return ymd(x)}); return `<section class="panel"><div class="grid">${days.map(day=>{const rows=currentData().schedules.filter(s=>s.date===day&&activeSchedule(s));return `<button data-day="${day}" class="ghost"><strong>${jpDate(day)}</strong><br><span class="subtle">${rows.length}名</span></button>`}).join('')}</div></section>${routeTables(currentData().schedules.filter(s=>s.date===state.date),jpDate(state.date))}`; }
function MonthView(){ const days=monthDays(state.month); return `<section class="panel"><div class="grid">${days.map(day=>{const rows=currentData().schedules.filter(s=>s.date===day&&activeSchedule(s)); return `<button data-day="${day}" class="ghost"><strong>${jpDate(day)}</strong><br><span class="subtle">${rows.length}名</span></button>`}).join('')}</div></section>`; }
function rangeLabel(range){ return range==='day' ? jpDate(state.date) : range==='week' ? '選択日の週' : `${state.month}`; }
function staffEventsForRows(rows, staffName){
  const list=[];
  rows.filter(activeSchedule).forEach(s=>{
    if((!staffName || s.pickupStaff===staffName) && (s.pickupTime || s.pickupPlace || s.pickupStaff)){
      list.push({date:s.date,type:'迎え',time:s.pickupTime||'',child:s.child||'',place:s.pickupPlace||'',staff:s.pickupStaff||'',note:s.note||'',status:s.status||'予定'});
    }
    if((!staffName || s.dropoffStaff===staffName) && (s.dropoffTime || s.dropoffPlace || s.dropoffStaff)){
      list.push({date:s.date,type:'送り',time:s.dropoffTime||'',child:s.child||'',place:s.dropoffPlace||'',staff:s.dropoffStaff||'',note:s.note||'',status:s.status||'予定'});
    }
  });
  return list.filter(x=>x.staff).sort((a,b)=>(a.date||'').localeCompare(b.date||'')||(a.time||'').localeCompare(b.time||'')||a.type.localeCompare(b.type,'ja')||(a.child||'').localeCompare(b.child||'','ja'));
}
function staffTargetRows(staffName, range){
  if(range==='day') return staffEventsForRows(rowsForDateAnyMonth(state.date), staffName);
  if(range==='week') return staffEventsForRows(weekDatesFor(state.date).flatMap(day=>rowsForDateAnyMonth(day)), staffName);
  return staffEventsForRows(rowsForMonthAny(state.month), staffName);
}
function StaffView(){
  const masterStaff=staffNames();
  if(!state.staffPage.staff && masterStaff.length) state.staffPage.staff=masterStaff[0];
  const selected=state.staffPage.staff;
  const range=state.staffPage.range || 'day';
  const rows=staffTargetRows(selected, range);
  const pickup=rows.filter(r=>r.type==='迎え');
  const drop=rows.filter(r=>r.type==='送り');
  const days=new Set(rows.map(r=>r.date));
  const title=range==='day' ? jpDate(state.date) : range==='week' ? `${jpDate(weekDatesFor(state.date)[0])} 〜 ${jpDate(weekDatesFor(state.date)[6])}` : state.month;
  const body=range==='day' ? StaffDayView(rows) : range==='week' ? StaffWeekCalendar(selected) : StaffMonthCalendar(selected);
  return `<section class="panel no-print"><div class="panel-head"><div class="panel-title"><h2>担当</h2><p>担当者マスタから選択し、担当になっている予定だけ表示します。</p></div></div><div class="toolbar staff-filter"><label class="field">担当者<select id="staffPageStaff">${options(masterStaff,selected,'担当者を選択')}</select></label><label class="field">選択日<input id="staffDate" type="date" value="${esc(state.date)}"></label><label class="field">表示月<select id="staffMonthInput">${fiscalMonths(state.fiscalYear).map(m=>`<option value="${m}" ${m===state.month?'selected':''}>${m}</option>`).join('')}</select></label><div class="segmented staff-mode-tabs"><button data-staff-range="day" class="${range==='day'?'primary':''}">日</button><button data-staff-range="week" class="${range==='week'?'primary':''}">週</button><button data-staff-range="month" class="${range==='month'?'primary':''}">月</button></div></div></section><section class="grid">${Metric('担当日数',`${days.size}日`,title)}${Metric('迎え',`${pickup.length}件`,selected||'全員')}${Metric('送り',`${drop.length}件`,selected||'全員')}${Metric('合計',`${rows.length}件`,'迎え＋送り')}</section>${body}`;
}
function StaffDayView(rows){
  return `<section class="panel"><div class="panel-head"><div class="panel-title"><h2>日別担当一覧</h2><p>${jpDate(state.date)}</p></div></div>${StaffDetailTable(rows)}</section>`;
}
function StaffWeekCalendar(staffName){
  const days=weekDatesFor(state.date);
  const allEvents=staffTargetRows(staffName,'week');
  return `<section class="panel"><div class="panel-head"><div class="panel-title"><h2>週表示</h2><p>選択日を含む週を表示します。月をまたいでも両方の予定を表示します。</p></div><span class="badge">${allEvents.length}件</span></div><div class="week-calendar"><div class="week-head-row">${days.map(day=>{const events=staffEventsForRows(rowsForDateAnyMonth(day), staffName); return `<button data-day="${day}" class="week-head ${day===state.date?'selected':''}"><strong>${jpDate(day)}</strong><span>${events.length}件</span></button>`;}).join('')}</div><div class="week-body">${days.map(day=>{const events=staffEventsForRows(rowsForDateAnyMonth(day), staffName); return `<div class="week-col ${day===state.date?'selected':''}">${events.map(compactEventCard).join('')||'<div class="empty-mini">担当なし</div>'}</div>`;}).join('')}</div></div></section><section class="panel"><div class="panel-head"><div class="panel-title"><h2>週一覧</h2><p>担当予定を一覧で確認できます。</p></div></div>${StaffDetailTable(allEvents)}</section>`;
}
function StaffMonthCalendar(staffName){
  const days=calendarDays(state.month);
  const monthEvents=staffTargetRows(staffName,'month');
  return `<section class="panel"><div class="panel-head"><div class="panel-title"><h2>月表示</h2><p>${state.month} の担当予定をカレンダーと一覧で表示します。</p></div><span class="badge">${monthEvents.length}件</span></div><div class="month-calendar"><div class="weekday-row">${WEEK.map(w=>`<div>${w}</div>`).join('')}</div><div class="month-grid">${days.map(day=>{const inMonth=day.startsWith(state.month); const events=staffEventsForRows(rowsForDateAnyMonth(day), staffName); const shown=events.slice(0,3); return `<button data-day="${day}" class="month-day ${inMonth?'':'outside'} ${day===state.date?'selected':''}"><div class="day-title"><strong>${Number(day.slice(8,10))}</strong><span>${inMonth?`${events.length}件`:day.slice(5,7)+'月'}</span></div>${shown.map(e=>`<div class="mini-event ${e.type==='迎え'?'pickup':'dropoff'}"><span>${esc(e.time||'--:--')}</span>${esc(e.type)} ${esc(e.child)}</div>`).join('')}${events.length>3?`<div class="more-event">ほか ${events.length-3}件</div>`:''}</button>`;}).join('')}</div></div></section><section class="panel"><div class="panel-head"><div class="panel-title"><h2>月一覧</h2><p>担当予定を一覧で確認できます。</p></div></div>${StaffDetailTable(monthEvents)}</section>`;
}
function StaffDetailTable(rows){
  return `<div class="table-wrap"><table id="staffDetailTable" class="compact-table"><thead><tr><th>日付</th><th>区分</th><th>時間</th><th>児童名</th><th>場所</th><th>担当</th><th>状態</th><th>備考</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(jpDate(r.date))}</td><td><span class="badge ${r.type==='迎え'?'ok':'warn'}">${esc(r.type)}</span></td><td>${esc(r.time)}</td><td>${esc(r.child)}</td><td>${esc(r.place)}</td><td>${esc(r.staff)}</td><td>${esc(r.status)}</td><td>${esc(r.note)}</td></tr>`).join('')||'<tr><td colspan="8">担当予定はありません。</td></tr>'}</tbody></table></div>`;
}
function options(list,value='',empty='選択なし'){ return `<option value="">${empty}</option>${list.map(v=>`<option ${v===value?'selected':''}>${esc(v)}</option>`).join('')}`; }
function childNames(){ return currentData().masters.children.filter(c=>c.enabled!==false).map(c=>c.displayName).filter(Boolean); }
function staffNames(){ return currentData().masters.staff.filter(s=>s.enabled!==false).map(s=>s.displayName).filter(Boolean); }
function placeNames(type){
  const d=currentData(); const a=[];
  d.schedules.forEach(s=>{ if(type!=='dropoff') a.push(s.pickupPlace); if(type!=='pickup') a.push(s.dropoffPlace); });
  d.masters.places.forEach(p=>{ if(p.enabled!==false && (p.type==='両方'||p.type===type||!p.type)) a.push(p.name); });
  d.masters.children.forEach(c=> (c.routes||[]).filter(r=>r.type===type||type==='both').forEach(r=>a.push(r.place)) );
  return [...new Set(a.filter(Boolean))].sort((x,y)=>x.localeCompare(y,'ja'));
}
function AddForms(){ return state.addForms.map((f,i)=>`<div class="add-box" data-add-form="${f.id}"><div class="toolbar"><label class="field">日付<input data-add="date" type="date" value="${esc(state.date)}"></label><label class="field">児童名<select data-add="child">${options(childNames(),'','児童名')}</select></label><label class="field">状態<select data-add="status"><option>予定</option><option>イベント</option><option>欠席</option></select></label><label class="field">送迎区分<select data-add="type"><option>迎え</option><option>送り</option></select></label><label class="field">時間<input data-add="time" type="time"></label><label class="field">場所<input data-add="place" list="allPlaces"></label><label class="field">担当<select data-add="staff">${options(staffNames())}</select></label><label class="field">備考<input data-add="note"></label>${i>0?`<button data-remove-add="${f.id}" class="danger">入力欄を削除</button>`:''}</div></div>`).join(''); }
function Changes(){
  const rows=filterChangeRows();
  return `<section class="panel"><div class="panel-head"><div class="panel-title"><h2>変更登録</h2><p>予定の変更・追加・削除をまとめて保存します。</p></div></div><div class="tabs segmented no-print"><button data-status="予定" class="${state.filters.status==='予定'?'active':''}">予定</button><button data-status="イベント" class="${state.filters.status==='イベント'?'active':''}">イベント</button><button data-status="欠席" class="${state.filters.status==='欠席'?'active':''}">欠席</button></div><div class="toolbar no-print" style="margin-top:10px"><label class="field">児童名<input id="filterChild" value="${esc(state.filters.child)}" placeholder="児童名で検索"></label><label class="field">担当者<select id="filterStaff">${options(staffNames(),state.filters.staff,'全員')}</select></label><label class="field">表示範囲<select id="filterRange"><option value="month" ${state.filters.range==='month'?'selected':''}>月全体</option><option value="day" ${state.filters.range==='day'?'selected':''}>日付</option><option value="week" ${state.filters.range==='week'?'selected':''}>1週間</option></select></label><label class="field">日付<input id="filterDate" type="date" value="${esc(state.filters.date)}"></label><button id="reloadBtn2">再読み込み</button><button id="deleteChecked" class="danger">削除</button></div></section><section class="panel"><div class="panel-head"><div class="panel-title"><h2>送迎を追加</h2><p>初期は1件。増やす場合だけ入力欄を追加します。</p></div><button id="addFormBtn" class="primary">入力欄を追加</button></div>${AddForms()}<datalist id="allPlaces">${placeNames('both').map(p=>`<option value="${esc(p)}">`).join('')}</datalist><button id="addSchedules" class="primary">画面に追加</button></section><section class="panel"><div class="panel-head"><div class="panel-title"><h2>予定一覧</h2><p>変更後、最後に保存してください。</p></div><div class="toolbar no-print"><button id="selectVisible">表示中を全選択</button><button id="clearChecked">選択解除</button><button id="saveSchedules" class="primary">保存する</button></div></div>${ScheduleEditTable(rows)}</section>`;
}
function filterChangeRows(){
  let rows=currentData().schedules.filter(s=>s.date?.startsWith(state.month));
  if(state.filters.status) rows=rows.filter(s=>s.status===state.filters.status);
  if(state.filters.child) rows=rows.filter(s=>String(s.child).includes(state.filters.child));
  if(state.filters.staff) rows=rows.filter(s=>s.pickupStaff===state.filters.staff||s.dropoffStaff===state.filters.staff);
  if(state.filters.range==='day') rows=rows.filter(s=>s.date===state.filters.date);
  if(state.filters.range==='week') { const base=new Date(`${state.filters.date}T00:00:00`); const start=new Date(base); start.setDate(base.getDate()-base.getDay()); const end=new Date(start); end.setDate(start.getDate()+6); rows=rows.filter(s=>{const d=new Date(`${s.date}T00:00:00`); return d>=start&&d<=end;}); }
  return rows.sort((a,b)=>(a.date+a.child).localeCompare(b.date+b.child,'ja'));
}
function ScheduleEditTable(rows){ return `<div class="table-wrap"><table id="changeTable"><thead><tr><th>削除</th><th>日付</th><th>児童名</th><th>状態</th><th>迎え時間</th><th>迎え先</th><th>迎え担当</th><th>送り時間</th><th>送り先</th><th>送り担当</th><th>備考</th></tr></thead><tbody>${rows.map(s=>`<tr data-id="${esc(s.id)}"><td><input type="checkbox" data-del></td><td><input type="date" data-field="date" value="${esc(s.date)}"></td><td><input data-field="child" value="${esc(s.child)}"></td><td><select data-field="status"><option ${s.status==='予定'?'selected':''}>予定</option><option ${s.status==='イベント'?'selected':''}>イベント</option><option ${s.status==='欠席'?'selected':''}>欠席</option></select></td><td><input type="time" data-field="pickupTime" value="${esc(s.pickupTime)}"></td><td><input data-field="pickupPlace" list="pickupPlaces" value="${esc(s.pickupPlace)}"></td><td><select data-field="pickupStaff">${options(staffNames(),s.pickupStaff)}</select></td><td><input type="time" data-field="dropoffTime" value="${esc(s.dropoffTime)}"></td><td><input data-field="dropoffPlace" list="dropoffPlaces" value="${esc(s.dropoffPlace)}"></td><td><select data-field="dropoffStaff">${options(staffNames(),s.dropoffStaff)}</select></td><td><input data-field="note" value="${esc(s.note)}"></td></tr>`).join('')||'<tr><td colspan="11">表示する予定がありません。</td></tr>'}</tbody></table></div><datalist id="pickupPlaces">${placeNames('pickup').map(p=>`<option value="${esc(p)}">`).join('')}</datalist><datalist id="dropoffPlaces">${placeNames('dropoff').map(p=>`<option value="${esc(p)}">`).join('')}</datalist>`; }
function collectScheduleRows(){
  const d=currentData(); const map=new Map(d.schedules.map(s=>[s.id,{...s}]));
  document.querySelectorAll('#changeTable tbody tr[data-id]').forEach(tr=>{
    const id=tr.dataset.id; const item=map.get(id)||{id};
    if(tr.querySelector('[data-del]')?.checked){ map.delete(id); return; }
    tr.querySelectorAll('[data-field]').forEach(el=>item[el.dataset.field]=el.value);
    const child=currentData().masters.children.find(c=>c.displayName===item.child); item.childId=child?.id||item.childId||'';
    map.set(id,item);
  });
  d.schedules=[...map.values()].filter(s=>s.date&&s.child);
  state.dirty=true; return d;
}
function addSchedulesFromForms(){
  const d=currentData(); let added=0;
  document.querySelectorAll('[data-add-form]').forEach(box=>{
    const val=k=>box.querySelector(`[data-add="${k}"]`)?.value||'';
    if(!val('date')||!val('child')) return;
    const type=val('type'), child=d.masters.children.find(c=>c.displayName===val('child'));
    const item={id:uid('sch'),date:val('date'),child:val('child'),childId:child?.id||'',status:val('status'),pickupTime:'',pickupPlace:'',pickupStaff:'',dropoffTime:'',dropoffPlace:'',dropoffStaff:'',note:val('note')};
    if(type==='迎え'){ item.pickupTime=val('time'); item.pickupPlace=val('place'); item.pickupStaff=val('staff'); }
    else { item.dropoffTime=val('time'); item.dropoffPlace=val('place'); item.dropoffStaff=val('staff'); }
    d.schedules.push(item); added++;
  });
  if(added){ state.data=d; state.dirty=true; showNotice('追加しました', `${added}件を画面に追加しました。最後に保存してください。`); }
  else showNotice('追加できません','日付と児童名を入力してください。','bad');
}
function NextMonth(){
  const target=addMonths(state.month,1), source=state.month;
  const form=(i,prefix,label)=>`<div class="toolbar"><label class="field">${label}${i+1} 開始<input type="date" id="${prefix}Start${i}"></label><label class="field">${label}${i+1} 終了<input type="date" id="${prefix}End${i}"></label></div>`;
  const days=Array.from({length:10},(_,i)=>`<label class="field">休業日${i+1}<input type="date" id="closedDay${i}"></label>`).join('');
  return `<section class="panel"><div class="panel-head"><div class="panel-title"><h2>翌月作成</h2><p>条件入力は保存不要です。必要な項目だけ入力してください。</p></div></div><div class="toolbar"><label class="field">コピー元月<input id="sourceMonth" type="month" value="${esc(source)}"></label><label class="field">作成月<input id="targetMonth" type="month" value="${esc(target)}"></label></div></section><section class="panel"><div class="panel-title"><h2>長期休み期間</h2><p>期間内は送迎マスタの長期休み候補を優先します。</p></div>${form(0,'long','長期休み')}<div class="toolbar no-print"><button id="longAll">作成月全体を長期休みにする</button><button id="clearLong">クリア</button></div></section><section class="panel"><div class="panel-title"><h2>事業所休業日</h2><p>選択された日は予定を作成しません。</p></div><div class="grid">${days}</div><h3>休業期間</h3>${[0,1,2].map(i=>form(i,'closed','休業期間')).join('')}</section><section class="panel"><div class="toolbar"><button id="previewNext" class="primary">作成前確認</button><button id="createNext" class="primary">翌月を作成</button></div>${state.nextPreview?PreviewNext():''}</section>`;
}
function readPeriods(prefix,count){ const out=[]; for(let i=0;i<count;i++){const s=document.getElementById(`${prefix}Start${i}`)?.value, e=document.getElementById(`${prefix}End${i}`)?.value; if(s&&e) out.push({start:s,end:e}); } return out; }
function inPeriods(date,periods){ return periods.some(p=>date>=p.start && date<=p.end); }
function selectedClosedDays(){ const days=[]; for(let i=0;i<10;i++){ const v=document.getElementById(`closedDay${i}`)?.value; if(v) days.push(v); } return days; }
async function buildNextPreview(){
  const sourceMonth=document.getElementById('sourceMonth').value, targetMonth=document.getElementById('targetMonth').value;
  const sourceData = (sourceMonth===state.month && fiscalYearFromYm(sourceMonth)===state.fiscalYear) ? currentData() : (()=>{ const fiscal=state.fiscalData; const pack=fiscal?.months?.[sourceMonth]; return normalizeData({masters:fiscal?.masters||currentData().masters,holidays:fiscal?.holidays||currentData().holidays,config:fiscal?.config||{},schedules:pack?.schedules||[],trips:pack?.trips||[],changes:pack?.changes||[],logs:pack?.logs||[]}); })();
  const longPeriods=readPeriods('long',1), closedPeriods=readPeriods('closed',3), closedDays=selectedClosedDays();
  const sourceActive=sourceData.schedules.filter(activeSchedule);
  const byChild={};
  const staffByChildWeek={};
  sourceActive.forEach(s=>{
    const wd=getWeekday(s.date);
    byChild[s.child]=byChild[s.child]||new Set();
    byChild[s.child].add(wd);
    const key=`${s.child}|${wd}`;
    staffByChildWeek[key]=staffByChildWeek[key]||{pickupStaff:'',dropoffStaff:''};
    if(s.pickupStaff) staffByChildWeek[key].pickupStaff=s.pickupStaff;
    if(s.dropoffStaff) staffByChildWeek[key].dropoffStaff=s.dropoffStaff;
  });
  const targetRows=[];
  monthDays(targetMonth).forEach(day=>{
    if(closedDays.includes(day)||inPeriods(day,closedPeriods)) return;
    const wd=getWeekday(day); const mode=inPeriods(day,longPeriods)?'longHoliday':'normal';
    Object.entries(byChild).forEach(([childName,set])=>{
      if(!set.has(wd)) return;
      const child=sourceData.masters.children.find(c=>c.displayName===childName);
      const p=bestRoute(child,'pickup',mode,wd), dr=bestRoute(child,'dropoff',mode,wd);
      const staff=staffByChildWeek[`${childName}|${wd}`]||{};
      targetRows.push({
        id:uid('sch'),date:day,child:childName,childId:child?.id||'',status:'予定',
        pickupTime:p.time||'',pickupPlace:p.place||'',pickupStaff:p.staff||staff.pickupStaff||'',
        dropoffTime:dr.time||'',dropoffPlace:dr.place||'',dropoffStaff:dr.staff||staff.dropoffStaff||'',
        note:mode==='longHoliday'?'長期休み':''
      });
    });
  });
  state.nextPreview={sourceMonth,targetMonth,rows:targetRows,longPeriods,closedDays,closedPeriods}; render();
}
function bestRoute(child,type,mode,wd){ if(!child) return {}; const routes=(child.routes||[]).filter(r=>r.type===type && r.enabled!==false); const exact=routes.find(r=>r.mode===mode && (!(r.days||[]).length || r.days.includes(wd))); if(exact) return exact; return routes.find(r=>r.mode==='normal' && (!(r.days||[]).length || r.days.includes(wd))) || {}; }
function PreviewNext(){ const p=state.nextPreview; return `<div class="subtle">${p.targetMonth} 作成予定：${p.rows.length}件 ／ 休業日：${p.closedDays.length}日</div><div class="table-wrap"><table><thead><tr><th>日付</th><th>児童名</th><th>迎え</th><th>迎え担当</th><th>送り</th><th>送り担当</th><th>備考</th></tr></thead><tbody>${p.rows.slice(0,80).map(s=>`<tr><td>${s.date}</td><td>${esc(s.child)}</td><td>${esc(s.pickupTime)} ${esc(s.pickupPlace)}</td><td>${esc(s.pickupStaff)}</td><td>${esc(s.dropoffTime)} ${esc(s.dropoffPlace)}</td><td>${esc(s.dropoffStaff)}</td><td>${esc(s.note)}</td></tr>`).join('')}</tbody></table></div>`; }
async function createNextMonth(){
  if(!state.nextPreview) await buildNextPreview();
  const p=state.nextPreview; const targetFy=fiscalYearFromYm(p.targetMonth);
  if(targetFy!==state.fiscalYear){ await loadFiscal(targetFy,{force:true,silent:true,month:p.targetMonth}); }
  let targetPack=ensureFiscalMonth(state.fiscalData, p.targetMonth);
  let target=normalizeData({masters:state.fiscalData.masters, holidays:state.fiscalData.holidays, config:state.fiscalData.config, schedules:targetPack.schedules||[], trips:targetPack.trips||[], changes:targetPack.changes||[], logs:targetPack.logs||[], meta:targetPack.meta||{}});
  const closed=new Set(p.closedDays); p.closedPeriods.forEach(period=>monthDays(p.targetMonth).filter(d=>d>=period.start&&d<=period.end).forEach(d=>closed.add(d)));
  target.schedules=target.schedules.filter(s=>!closed.has(s.date));
  const key=s=>`${s.date}|${s.child}`; const existing=new Set(target.schedules.map(key));
  p.rows.forEach(r=>{ if(!existing.has(key(r))) target.schedules.push(r); });
  state.loading=true; render();
  try{ state.fiscalData.months[p.targetMonth]={schedules:target.schedules,trips:target.trips,changes:target.changes,logs:target.logs,meta:target.meta||{}}; await api.saveFiscalData(state.fiscalYear,state.fiscalData,state.fiscalData.meta?.version); state.month=p.targetMonth; state.date=`${p.targetMonth}-01`; await loadFiscal(state.fiscalYear,{force:true,silent:true,month:p.targetMonth}); state.view='changes'; location.hash='changes'; showNotice('作成しました',`${p.targetMonth} の予定を年度データに作成しました。`); }
  catch(e){ showNotice('作成できませんでした',e.message,'bad'); }
  finally{ state.loading=false; render(); }
}
function Masters(){ return `<section class="panel"><div class="panel-head"><div class="panel-title"><h2>マスタ</h2><p>CSVで入出力できます。取り込み後は保存してください。</p></div></div><div class="toolbar"><button id="exportTransport">送迎マスタCSV出力</button><button id="importTransportBtn">送迎マスタCSV取込</button><button id="exportStaff">担当者マスタCSV出力</button><button id="importStaffBtn">担当者マスタCSV取込</button><button id="saveMastersBtn" class="primary">Driveへマスタ保存</button><input id="csvFile" type="file" accept=".csv,text/csv" class="hide"></div></section>${TransportMaster()}${StaffMaster()}`; }
function TransportMaster(){ const rows=currentData().masters.children; return `<section class="panel"><div class="panel-head"><div class="panel-title"><h2>送迎マスタ変更</h2><p>通常・長期休み・イベントを分けて登録します。</p></div><button id="addChild" class="primary">児童を追加</button></div><div class="table-wrap"><table id="childTable"><thead><tr><th>児童名</th><th>通常迎え</th><th>通常送り</th><th>長期休み迎え</th><th>長期休み送り</th><th>イベント迎え</th><th>イベント送り</th><th>状態</th></tr></thead><tbody>${rows.map(c=>`<tr data-child-id="${esc(c.id)}"><td><input data-c="displayName" value="${esc(c.displayName)}"></td><td><textarea data-c="normalPickup">${esc(routeText(c,'pickup','normal'))}</textarea></td><td><textarea data-c="normalDropoff">${esc(routeText(c,'dropoff','normal'))}</textarea></td><td><textarea data-c="longHolidayPickup">${esc(routeText(c,'pickup','longHoliday'))}</textarea></td><td><textarea data-c="longHolidayDropoff">${esc(routeText(c,'dropoff','longHoliday'))}</textarea></td><td><textarea data-c="eventPickup">${esc(routeText(c,'pickup','event'))}</textarea></td><td><textarea data-c="eventDropoff">${esc(routeText(c,'dropoff','event'))}</textarea></td><td><select data-c="enabled"><option value="true" ${c.enabled?'selected':''}>有効</option><option value="false" ${!c.enabled?'selected':''}>非表示</option></select></td></tr>`).join('')}</tbody></table></div><p class="subtle">入力例：月水金|14:20|澄川小学校|担当者名</p></section>`; }
function StaffMaster(){ const rows=currentData().masters.staff; return `<section class="panel"><div class="panel-head"><div class="panel-title"><h2>担当者マスタ変更・複製・削除</h2><p>削除は非表示扱いです。</p></div><button id="addStaff" class="primary">担当者を追加</button></div><div class="table-wrap"><table id="staffTable"><thead><tr><th>担当者名</th><th>役割</th><th>表示順</th><th>運転</th><th>添乗</th><th>状態</th><th>操作</th></tr></thead><tbody>${rows.map(s=>`<tr data-staff-id="${esc(s.id)}"><td><input data-s="displayName" value="${esc(s.displayName)}"></td><td><input data-s="role" value="${esc(s.role)}"></td><td><input data-s="order" type="number" value="${esc(s.order)}"></td><td><select data-s="canDrive"><option value="true" ${s.canDrive?'selected':''}>可</option><option value="false" ${!s.canDrive?'selected':''}>不可</option></select></td><td><select data-s="canRide"><option value="true" ${s.canRide?'selected':''}>可</option><option value="false" ${!s.canRide?'selected':''}>不可</option></select></td><td><select data-s="enabled"><option value="true" ${s.enabled?'selected':''}>有効</option><option value="false" ${!s.enabled?'selected':''}>非表示</option></select></td><td><button data-copy-staff="${esc(s.id)}">複製</button><button data-hide-staff="${esc(s.id)}" class="danger">削除</button></td></tr>`).join('')}</tbody></table></div></section>`; }
function collectMasters(){
  const d=currentData(); const children=[];
  document.querySelectorAll('#childTable tbody tr').forEach(tr=>{ const v=k=>tr.querySelector(`[data-c="${k}"]`)?.value||''; const child={id:tr.dataset.childId||uid('child'),displayName:v('displayName'),name:v('displayName'),enabled:v('enabled')!=='false'}; child.routes=[...parseRouteText(v('normalPickup')).map(r=>({...r,type:'pickup',mode:'normal',enabled:true})),...parseRouteText(v('normalDropoff')).map(r=>({...r,type:'dropoff',mode:'normal',enabled:true})),...parseRouteText(v('longHolidayPickup')).map(r=>({...r,type:'pickup',mode:'longHoliday',enabled:true})),...parseRouteText(v('longHolidayDropoff')).map(r=>({...r,type:'dropoff',mode:'longHoliday',enabled:true})),...parseRouteText(v('eventPickup')).map(r=>({...r,type:'pickup',mode:'event',enabled:true})),...parseRouteText(v('eventDropoff')).map(r=>({...r,type:'dropoff',mode:'event',enabled:true}))]; if(child.displayName) children.push(child); });
  const staff=[]; document.querySelectorAll('#staffTable tbody tr').forEach(tr=>{ const v=k=>tr.querySelector(`[data-s="${k}"]`)?.value||''; const item={id:tr.dataset.staffId||uid('staff'),displayName:v('displayName'),name:v('displayName'),role:v('role'),order:Number(v('order')||999),canDrive:v('canDrive')==='true',canRide:v('canRide')==='true',enabled:v('enabled')!=='false'}; if(item.displayName) staff.push(item); });
  d.masters={...d.masters,children,staff}; state.data=d; state.dirty=true; return d.masters;
}
function csvEscape(v){ const s=String(v??''); return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; }
function download(name,text){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
function exportTransport(){ const d=collectMasters(); const head=['児童名','通常迎え','通常送り','長期休み迎え','長期休み送り','イベント迎え','イベント送り','状態']; const rows=d.children.map(c=>[c.displayName,routeText(c,'pickup','normal'),routeText(c,'dropoff','normal'),routeText(c,'pickup','longHoliday'),routeText(c,'dropoff','longHoliday'),routeText(c,'pickup','event'),routeText(c,'dropoff','event'),c.enabled?'有効':'非表示']); download(`送迎マスタ_${state.month}.csv`,[head,...rows].map(r=>r.map(csvEscape).join(',')).join('\n')); }
function exportStaff(){ const d=collectMasters(); const head=['担当者名','役割','表示順','運転','添乗','状態']; const rows=d.staff.map(s=>[s.displayName,s.role,s.order,s.canDrive?'可':'不可',s.canRide?'可':'不可',s.enabled?'有効':'非表示']); download(`担当者マスタ_${state.month}.csv`,[head,...rows].map(r=>r.map(csvEscape).join(',')).join('\n')); }
function parseCsv(text){ const rows=[]; let row=[],cur='',q=false; for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1]; if(q&&c==='"'&&n==='"'){cur+='"';i++;} else if(c==='"'){q=!q;} else if(!q&&c===','){row.push(cur);cur='';} else if(!q&&(c==='\n'||c==='\r')){ if(c==='\r'&&n==='\n')i++; row.push(cur); rows.push(row); row=[]; cur='';} else cur+=c;} row.push(cur); rows.push(row); return rows.filter(r=>r.some(x=>String(x).trim())); }
function importCsv(kind){ const file=document.getElementById('csvFile'); file.onchange=async()=>{ const text=await file.files[0].text(); const rows=parseCsv(text); const body=rows.slice(1); const d=currentData(); if(kind==='transport'){ d.masters.children=body.map((r,i)=>{const c={id:uid('child'),displayName:r[0],name:r[0],enabled:r[7]!=='非表示'}; c.routes=[...parseRouteText(r[1]).map(x=>({...x,type:'pickup',mode:'normal',enabled:true})),...parseRouteText(r[2]).map(x=>({...x,type:'dropoff',mode:'normal',enabled:true})),...parseRouteText(r[3]).map(x=>({...x,type:'pickup',mode:'longHoliday',enabled:true})),...parseRouteText(r[4]).map(x=>({...x,type:'dropoff',mode:'longHoliday',enabled:true})),...parseRouteText(r[5]).map(x=>({...x,type:'pickup',mode:'event',enabled:true})),...parseRouteText(r[6]).map(x=>({...x,type:'dropoff',mode:'event',enabled:true}))]; return c; }).filter(c=>c.displayName); } else { d.masters.staff=body.map((r,i)=>({id:uid('staff'),displayName:r[0],name:r[0],role:r[1],order:Number(r[2]||999),canDrive:r[3]==='可',canRide:r[4]==='可',enabled:r[5]!=='非表示'})).filter(s=>s.displayName); } state.data=d; state.dirty=true; showNotice('取り込みました','確認後、Driveへマスタ保存を押してください。'); render(); }; file.click(); }
function PrintView(){ const rows=currentData().schedules.filter(s=>s.date.startsWith(state.month)&&activeSchedule(s)); const names=[...new Set(rows.flatMap(s=>[s.pickupStaff,s.dropoffStaff]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ja')); return `<section class="panel"><div class="panel-head"><div class="panel-title"><h2>印刷</h2><p>A4縦に収まるように調整しています。</p></div><button id="printBtn" class="primary">印刷</button></div><div class="table-wrap"><table><thead><tr><th>担当者</th><th>合計日数</th><th>迎え日数</th><th>送り日数</th><th>迎え児童数</th><th>送り児童数</th><th>確認</th></tr></thead><tbody>${names.map(n=>{const p=rows.filter(s=>s.pickupStaff===n),d=rows.filter(s=>s.dropoffStaff===n); return `<tr><td>${esc(n)}</td><td>${new Set([...p,...d].map(s=>s.date)).size}</td><td>${new Set(p.map(s=>s.date)).size}</td><td>${new Set(d.map(s=>s.date)).size}</td><td>${p.length}</td><td>${d.length}</td><td></td></tr>`}).join('')}</tbody></table></div></section>`; }
function Settings(){ const s=getSettings(); return `<section class="panel"><div class="panel-head"><div class="panel-title"><h2>データ設定</h2><p>Google Drive JSONと接続します。</p></div></div><div class="grid"><label class="field">GAS WebアプリURL<input id="gasUrl" value="${esc(s.gasUrl||'')}"></label><label class="field">認証トークン<input id="appToken" value="${esc(s.appToken||'')}"></label><label class="field">操作者名<input id="operator" value="${esc(s.operator||'')}"></label><label class="field">LINE WORKS Webhook<input id="lineWebhook" value="${esc(s.lineWebhook||'')}"></label></div><div class="toolbar" style="margin-top:12px"><button id="saveSettings" class="primary">設定を保存</button><button id="testConnection">接続確認</button><button id="setupDrive">Drive初期化</button><button id="importFiscal">月別データから年度作成</button><button id="reloadFiscal">年度データ再読込</button></div></section>`; }


/* v66: week/month calendar/list rebuild */
function rowsForDateAnyMonth(date){
  const month = String(date||'').slice(0,7);
  if(state.fiscalData && state.fiscalData.months && state.fiscalData.months[month]){
    return (state.fiscalData.months[month].schedules || []).map(normalizeSchedule).filter(s=>s.date===date);
  }
  return currentData().schedules.filter(s=>s.date===date);
}
function rowsForMonthAny(month){
  if(state.fiscalData && state.fiscalData.months && state.fiscalData.months[month]){
    return (state.fiscalData.months[month].schedules || []).map(normalizeSchedule);
  }
  return month===state.month ? currentData().schedules : [];
}
function scheduleEvents(rows){
  const items=[];
  rows.filter(activeSchedule).forEach(s=>{
    if(s.pickupTime || s.pickupPlace || s.pickupStaff) items.push({date:s.date,type:'迎え',time:s.pickupTime||'',child:s.child||'',place:s.pickupPlace||'',staff:s.pickupStaff||'',note:s.note||'',status:s.status||'予定'});
    if(s.dropoffTime || s.dropoffPlace || s.dropoffStaff) items.push({date:s.date,type:'送り',time:s.dropoffTime||'',child:s.child||'',place:s.dropoffPlace||'',staff:s.dropoffStaff||'',note:s.note||'',status:s.status||'予定'});
  });
  return items.sort((a,b)=>(a.date||'').localeCompare(b.date||'')||(a.time||'').localeCompare(b.time||'')||a.type.localeCompare(b.type,'ja')||a.child.localeCompare(b.child,'ja'));
}
function weekDatesFor(date){
  const start=new Date(`${date}T00:00:00`);
  start.setDate(start.getDate()-start.getDay());
  return Array.from({length:7},(_,i)=>{const x=new Date(start); x.setDate(start.getDate()+i); return ymd(x);});
}
function compactEventCard(e){
  const cls=e.type==='迎え'?'pickup':'dropoff';
  return `<div class="cal-event ${cls}" title="${esc(`${e.type} ${e.time} ${e.child} ${e.place} ${e.staff}`)}"><div class="cal-time">${esc(e.time||'時刻なし')}</div><div class="cal-main"><span class="type">${esc(e.type)}</span> ${esc(e.child||'未入力')}</div><div class="cal-sub">${esc(e.place||'場所なし')} ／ ${esc(e.staff||'担当なし')}</div>${e.note?`<div class="cal-note">${esc(e.note)}</div>`:''}</div>`;
}
function Schedule(){
  const labels={day:'日表示',week:'週表示',month:'月表示'};
  const body=state.mode==='day'
    ? routeTables(rowsForDateAnyMonth(state.date),`${jpDate(state.date)}`)
    : state.mode==='week'
      ? WeekView()
      : MonthView();
  return `<section class="panel no-print"><div class="panel-head"><div class="panel-title"><h2>予定</h2><p>${labels[state.mode]||'予定'}。週表示は月をまたいでも同じ週の予定を表示します。</p></div></div><div class="segmented schedule-mode-tabs"><button data-mode="day" class="${state.mode==='day'?'primary':''}">日</button><button data-mode="week" class="${state.mode==='week'?'primary':''}">週</button><button data-mode="month" class="${state.mode==='month'?'primary':''}">月</button></div></section>${body}`;
}
function WeekView(){
  const days=weekDatesFor(state.date);
  const months=[...new Set(days.map(d=>d.slice(0,7)))];
  const title=`${jpDate(days[0])} 〜 ${jpDate(days[6])}`;
  const allEvents=scheduleEvents(days.flatMap(day=>rowsForDateAnyMonth(day)));
  return `<section class="panel"><div class="panel-head"><div class="panel-title"><h2>週表示</h2><p>${title}${months.length>1?` ／ ${months.join('・')} の予定を表示`:''}</p></div><span class="badge">${allEvents.length}件</span></div><div class="week-calendar"><div class="week-head-row">${days.map(day=>`<button data-day="${day}" class="week-head ${day===state.date?'selected':''}"><strong>${jpDate(day)}</strong><span>${scheduleEvents(rowsForDateAnyMonth(day)).length}件</span></button>`).join('')}</div><div class="week-body">${days.map(day=>{const events=scheduleEvents(rowsForDateAnyMonth(day)); return `<div class="week-col ${day===state.date?'selected':''}">${events.map(compactEventCard).join('')||'<div class="empty-mini">予定なし</div>'}</div>`;}).join('')}</div></div></section><section class="panel"><div class="panel-head"><div class="panel-title"><h2>週一覧</h2><p>同じ週の予定を一覧で確認できます。</p></div></div>${eventListTable(allEvents)}</section>`;
}
function calendarDays(month){
  const first=new Date(`${month}-01T00:00:00`);
  const start=new Date(first); start.setDate(1-first.getDay());
  return Array.from({length:42},(_,i)=>{const x=new Date(start); x.setDate(start.getDate()+i); return ymd(x);});
}
function MonthView(){
  const days=calendarDays(state.month);
  const monthRows=rowsForMonthAny(state.month).filter(activeSchedule);
  const monthEvents=scheduleEvents(monthRows);
  return `<section class="panel"><div class="panel-head"><div class="panel-title"><h2>月表示</h2><p>${state.month} のカレンダーと一覧を表示します。</p></div><span class="badge">${monthEvents.length}件</span></div><div class="month-calendar"><div class="weekday-row">${WEEK.map(w=>`<div>${w}</div>`).join('')}</div><div class="month-grid">${days.map(day=>{const inMonth=day.startsWith(state.month); const events=scheduleEvents(rowsForDateAnyMonth(day)); const shown=events.slice(0,3); return `<button data-day="${day}" class="month-day ${inMonth?'':'outside'} ${day===state.date?'selected':''}"><div class="day-title"><strong>${Number(day.slice(8,10))}</strong><span>${inMonth?`${events.length}件`:day.slice(5,7)+'月'}</span></div>${shown.map(e=>`<div class="mini-event ${e.type==='迎え'?'pickup':'dropoff'}"><span>${esc(e.time||'--:--')}</span>${esc(e.type)} ${esc(e.child)}</div>`).join('')}${events.length>3?`<div class="more-event">ほか ${events.length-3}件</div>`:''}</button>`;}).join('')}</div></div></section><section class="panel"><div class="panel-head"><div class="panel-title"><h2>月一覧</h2><p>カレンダー内の予定を一覧で確認できます。</p></div></div>${eventListTable(monthEvents)}</section>`;
}
function eventListTable(events){
  return `<div class="table-wrap"><table class="compact-table"><thead><tr><th>日付</th><th>区分</th><th>時間</th><th>児童名</th><th>場所</th><th>担当</th><th>備考</th></tr></thead><tbody>${events.map(e=>`<tr><td>${esc(jpDate(e.date))}</td><td>${esc(e.type)}</td><td>${esc(e.time)}</td><td>${esc(e.child)}</td><td>${esc(e.place)}</td><td>${esc(e.staff)}</td><td>${esc(e.note)}</td></tr>`).join('')||'<tr><td colspan="7">予定なし</td></tr>'}</tbody></table></div>`;
}

function Body(){ return state.view==='dashboard'?Dashboard():state.view==='schedule'?Schedule():state.view==='staff'?StaffView():state.view==='changes'?Changes():state.view==='next'?NextMonth():state.view==='masters'?Masters():state.view==='print'?PrintView():Settings(); }
function render(){ app.innerHTML=Layout(Body()); bind(); renderNotice(); }
function bind(){
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view; location.hash=state.view; render();});
  document.getElementById('mobileViewSelect')?.addEventListener('change',e=>{state.view=e.target.value; location.hash=state.view; render();});
  document.getElementById('reloadBtn')?.addEventListener('click',()=>loadMonth(state.month,{force:true}));
  document.getElementById('reloadBtn2')?.addEventListener('click',()=>loadMonth(state.month,{force:true}));
  document.getElementById('autoBtn')?.addEventListener('click',()=>{state.autoRefresh=!state.autoRefresh; localStorage.setItem('transport.autoRefresh.v62',state.autoRefresh?'1':'0'); setupAuto(); render();});
  document.getElementById('prevMonth')?.addEventListener('click',()=>loadMonth(addMonths(state.month,-1),{force:false}));
  document.getElementById('nextMonth')?.addEventListener('click',()=>loadMonth(addMonths(state.month,1),{force:false}));
  document.getElementById('applyMonth')?.addEventListener('click',()=>loadMonth(document.getElementById('monthInput').value,{force:false}));
  document.getElementById('applyFiscal')?.addEventListener('click',()=>loadFiscal(Number(document.getElementById('fiscalInput').value),{force:true,month:fiscalMonths(Number(document.getElementById('fiscalInput').value))[0]}));
  document.getElementById('dateInput')?.addEventListener('change',e=>{state.date=e.target.value; state.month=e.target.value.slice(0,7); loadMonth(state.month,{force:false,silent:true});});
  document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{state.mode=b.dataset.mode; render();});
  document.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{state.date=b.dataset.day; state.month=state.date.slice(0,7); state.mode='day'; state.view='schedule'; loadMonth(state.month,{force:false,silent:true});});
  document.querySelectorAll('[data-status]').forEach(b=>b.onclick=()=>{state.filters.status=b.dataset.status; render();});
  ['filterChild','filterStaff','filterRange','filterDate'].forEach(id=>document.getElementById(id)?.addEventListener('input',e=>{const map={filterChild:'child',filterStaff:'staff',filterRange:'range',filterDate:'date'}; state.filters[map[id]]=e.target.value; render();}));
  document.getElementById('staffPageStaff')?.addEventListener('change',e=>{state.staffPage.staff=e.target.value; render();});
  document.getElementById('staffDate')?.addEventListener('change',e=>{state.date=e.target.value||state.date; if(state.date) loadMonth(state.date.slice(0,7),{force:false}); else render();});
  document.getElementById('staffMonthInput')?.addEventListener('change',e=>{loadMonth(e.target.value,{force:false});});
  document.querySelectorAll('[data-staff-range]').forEach(b=>b.onclick=()=>{state.staffPage.range=b.dataset.staffRange; render();});
  document.getElementById('selectVisible')?.addEventListener('click',()=>document.querySelectorAll('#changeTable [data-del]').forEach(x=>x.checked=true));
  document.getElementById('clearChecked')?.addEventListener('click',()=>document.querySelectorAll('#changeTable [data-del]').forEach(x=>x.checked=false));
  document.getElementById('deleteChecked')?.addEventListener('click',()=>{const n=[...document.querySelectorAll('#changeTable [data-del]:checked')].length; showNotice('削除対象にしました',`${n}件を削除対象にしました。最後に保存してください。`);});
  document.getElementById('saveSchedules')?.addEventListener('click',()=>{collectScheduleRows(); saveCurrentMonth('保存しました');});
  document.getElementById('addFormBtn')?.addEventListener('click',()=>{state.addForms.push({id:uid('add')}); render();});
  document.querySelectorAll('[data-remove-add]').forEach(b=>b.onclick=()=>{state.addForms=state.addForms.filter(x=>x.id!==b.dataset.removeAdd); render();});
  document.getElementById('addSchedules')?.addEventListener('click',addSchedulesFromForms);
  document.getElementById('longAll')?.addEventListener('click',()=>{const m=document.getElementById('targetMonth').value; document.getElementById('longStart0').value=`${m}-01`; document.getElementById('longEnd0').value=`${m}-${pad(daysInMonth(m))}`;});
  document.getElementById('clearLong')?.addEventListener('click',()=>{document.getElementById('longStart0').value='';document.getElementById('longEnd0').value='';});
  document.getElementById('previewNext')?.addEventListener('click',buildNextPreview);
  document.getElementById('createNext')?.addEventListener('click',createNextMonth);
  document.getElementById('addChild')?.addEventListener('click',()=>{const d=collectMasters(); d.children.push({id:uid('child'),displayName:'',name:'',enabled:true,routes:[]}); render();});
  document.getElementById('addStaff')?.addEventListener('click',()=>{const d=collectMasters(); d.staff.push({id:uid('staff'),displayName:'',name:'',enabled:true,order:999,canDrive:false,canRide:true}); render();});
  document.querySelectorAll('[data-copy-staff]').forEach(b=>b.onclick=()=>{const d=collectMasters(); const s=d.staff.find(x=>x.id===b.dataset.copyStaff); if(s)d.staff.push({...s,id:uid('staff'),displayName:`${s.displayName} コピー`}); render();});
  document.querySelectorAll('[data-hide-staff]').forEach(b=>b.onclick=()=>{const d=collectMasters(); const s=d.staff.find(x=>x.id===b.dataset.hideStaff); if(s)s.enabled=false; render();});
  document.getElementById('saveMastersBtn')?.addEventListener('click',()=>{collectMasters(); saveMasters();});
  document.getElementById('exportTransport')?.addEventListener('click',exportTransport);
  document.getElementById('exportStaff')?.addEventListener('click',exportStaff);
  document.getElementById('importTransportBtn')?.addEventListener('click',()=>importCsv('transport'));
  document.getElementById('importStaffBtn')?.addEventListener('click',()=>importCsv('staff'));
  document.getElementById('printBtn')?.addEventListener('click',()=>window.print());
  document.getElementById('saveSettings')?.addEventListener('click',()=>{saveSettings({gasUrl:document.getElementById('gasUrl').value.trim(),appToken:document.getElementById('appToken').value.trim(),operator:document.getElementById('operator').value.trim(),lineWebhook:document.getElementById('lineWebhook').value.trim()}); showNotice('保存しました','データ設定を保存しました。');});
  document.getElementById('testConnection')?.addEventListener('click',async()=>{try{await api.ping();showNotice('接続できました','GASと通信できました。')}catch(e){showNotice('接続できません',e.message,'bad')}});
  document.getElementById('setupDrive')?.addEventListener('click',async()=>{try{await api.setupDrive();showNotice('完了しました','Drive初期化を実行しました。')}catch(e){showNotice('実行できません',e.message,'bad')}});
  document.getElementById('importFiscal')?.addEventListener('click',importCurrentFiscal);
  document.getElementById('reloadFiscal')?.addEventListener('click',()=>loadFiscal(state.fiscalYear,{force:true,month:state.month}));
}
let autoTimer=null; function setupAuto(){ clearInterval(autoTimer); if(state.autoRefresh) autoTimer=setInterval(()=>{ if(!state.dirty) loadMonth(state.month,{force:true,silent:true}); },60000); }
state.autoRefresh = localStorage.getItem('transport.autoRefresh.v62') === '1';
window.addEventListener('hashchange',()=>{state.view=(location.hash||'#dashboard').replace('#',''); render();});
render(); loadFiscal(state.fiscalYear,{force:false,silent:true,month:state.month}); setupAuto();

/* v68: PC schedule tab design unified */
function Schedule(){
  const labels={day:'日表示',week:'週表示',month:'月表示'};
  const body=state.mode==='day'
    ? routeTables(rowsForDateAnyMonth(state.date),`${jpDate(state.date)}`)
    : state.mode==='week'
      ? WeekView()
      : MonthView();
  return `<section class="panel no-print schedule-switch-panel"><div class="schedule-switch-head"><div><h2>予定</h2><p>${labels[state.mode]||'予定'}。週表示は月をまたいでも表示します。</p></div><div class="schedule-switch"><button data-mode="day" class="${state.mode==='day'?'primary':''}">日</button><button data-mode="week" class="${state.mode==='week'?'primary':''}">週</button><button data-mode="month" class="${state.mode==='month'?'primary':''}">月</button></div></div></section>${body}`;
}
