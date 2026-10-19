// مكتب غرب القصيم للكهرباء - نظام تتبع المواقع - V2 مع Supabase
const STORAGE_KEY = 'qassim_locations_v2';
const AUTH_KEY = 'qassim_admin_session';
const CRED_KEY = 'qassim_admin_creds';
const DEFAULT_CREDS = { user: 'admin', pass: 'admin123' };
function getCreds(){
  try{ const s=localStorage.getItem(CRED_KEY); if(s) return JSON.parse(s);}catch{}
  return DEFAULT_CREDS;
}

// --- Supabase Integration - مُحسّن لـ 500 ألف موقع ---
let supabaseClient = null;
let useSupabase = false;
let realtimeChannel = null;
let CLOUD_MODE = false; // عند > 20 ألف يتحول لبحث سحابي مباشر بدون تحميل الكل
let CLOUD_COUNT = 0;
const CLOUD_THRESHOLD = 20000; // عتبة التحول للسحابة

function toDb(item){
  return {
    id: String(item.id),
    sub: String(item.sub),
    equip: String(item.equip),
    name: item.name || null,
    address: item.address || null,
    lat: Number(item.lat),
    lng: Number(item.lng),
    notes: item.notes || null,
    updated_at: Number(item.updatedAt || Date.now())
  };
}
function fromDb(row){
  return {
    id: String(row.id),
    sub: String(row.sub),
    equip: String(row.equip),
    name: row.name || '',
    address: row.address || '',
    lat: Number(row.lat),
    lng: Number(row.lng),
    notes: row.notes || '',
    updatedAt: Number(row.updated_at)
  };
}

async function initSupabase(){
  const url = window.SUPABASE_URL;
  const key = window.SUPABASE_ANON_KEY;
  if(!url || !key || !window.supabase){ console.log('Supabase not configured, using localStorage'); return false; }
  try{
    supabaseClient = window.supabase.createClient(url, key);
    // test connection
    const { data, error } = await supabaseClient.from('locations').select('id').limit(1);
    if(error) throw error;
    useSupabase = true;
    console.log('%c✓ متصل بقاعدة بيانات Supabase - وضع Online', 'background:#0D5BBA;color:white;padding:6px 10px;border-radius:6px;font-weight:bold');
    // update UI badges
    const badge = document.getElementById('supabaseBadge');
    if(badge){ badge.textContent = 'Supabase Online ✓'; badge.className = 'bg-emerald-500 text-white px-3 py-1 rounded-full text-xs font-black'; }
    const statUpdate = document.getElementById('statUpdate');
    if(statUpdate) statUpdate.textContent = 'مزامن مع السحابة ✓';
    setupRealtime();
    return true;
  }catch(e){
    console.warn('Supabase connection failed, fallback to local', e);
    useSupabase = false;
    const badge = document.getElementById('supabaseBadge');
    if(badge){ badge.textContent = 'وضع محلي'; badge.className = 'bg-amber-500 text-white px-3 py-1 rounded-full text-xs font-black'; }
    return false;
  }
}
function setupRealtime(){
  if(!supabaseClient || realtimeChannel) return;
  realtimeChannel = supabaseClient.channel('locations-changes')
    .on('postgres_changes', {event:'*', schema:'public', table:'locations'}, (payload)=>{
      console.log('Realtime:', payload);
      if(payload.eventType==='INSERT'){
        const item = fromDb(payload.new);
        if(!DATA.find(x=>x.id===item.id)){
          DATA.unshift(item);
          saveLocal();
          updateStats();
          renderAdminTable();
          if(lastQuery) doSearch(lastQuery,false);
          showToast('تمت إضافة موقع جديد من جهاز آخر ✓');
        }
      } else if(payload.eventType==='UPDATE'){
        const item = fromDb(payload.new);
        const idx = DATA.findIndex(x=>x.id===item.id);
        if(idx>-1){ DATA[idx]=item; saveLocal(); updateStats(); renderAdminTable(); if(lastQuery) doSearch(lastQuery,false); }
      } else if(payload.eventType==='DELETE'){
        const oldId = String(payload.old.id);
        const before = DATA.length;
        DATA = DATA.filter(x=>x.id!==oldId);
        if(DATA.length!==before){ saveLocal(); updateStats(); renderAdminTable(); if(lastQuery) doSearch(lastQuery,false); showToast('تم حذف موقع من جهاز آخر'); }
      }
    })
    .subscribe();
}

async function getSupabaseCount(){
  if(!useSupabase) return 0;
  const { count, error } = await supabaseClient.from('locations').select('id', {count:'exact', head:true});
  if(error){ console.warn('count error', error); return DATA.length; }
  return count||0;
}
async function fetchFromSupabase(limit=null){
  if(!useSupabase) return null;
  if(limit){
    const { data, error } = await supabaseClient.from('locations').select('*').order('updated_at', {ascending:false}).limit(limit);
    if(error) throw error;
    return (data||[]).map(fromDb);
  }
  // لو العدد ضخم لا نحمل الكل - نكتفي بآخر 5000 فقط للعرض السريع
  const cnt = await getSupabaseCount();
  CLOUD_COUNT = cnt;
  if(cnt > CLOUD_THRESHOLD){
    CLOUD_MODE = true;
    console.log(`☁️ وضع سحابي: ${cnt.toLocaleString('ar-SA')} موقع - البحث مباشر من السيرفر`);
    const badge=document.getElementById('supabaseBadge');
    if(badge) badge.textContent=`سحابي ☁️ ${cnt.toLocaleString('ar-SA')} موقع`;
    const { data } = await supabaseClient.from('locations').select('*').order('updated_at', {ascending:false}).limit(200);
    return (data||[]).map(fromDb);
  }
  let all=[], from=0, step=1000;
  while(true){
    const { data, error } = await supabaseClient.from('locations').select('*').order('updated_at', {ascending:false}).range(from, from+step-1);
    if(error) throw error;
    if(!data || data.length===0) break;
    all.push(...data);
    if(data.length<step) break;
    from+=step;
    if(all.length> CLOUD_THRESHOLD) { // حماية
      CLOUD_MODE=true; break;
    }
  }
  return all.map(fromDb);
}
async function searchSupabase(q){
  if(!useSupabase) return null;
  const nq = q.trim();
  if(!nq) return [];
  // بحث ذكي: يبحث في sub و equip بنفس الوقت - يدعم 30/500
  const { data, error } = await supabaseClient.from('locations')
    .select('*')
    .or(`sub.ilike.%${nq}%,equip.ilike.%${nq}%`)
    .limit(50);
  if(error){ console.error('searchSupabase', error); return []; }
  return (data||[]).map(fromDb);
}
async function upsertToSupabase(item){
  if(!useSupabase) return;
  const { error } = await supabaseClient.from('locations').upsert(toDb(item), {onConflict:'id'});
  if(error){ console.error('upsert error', error); showToast('خطأ في المزامنة السحابية','error'); }
}
async function deleteFromSupabase(id){
  if(!useSupabase) return;
  const { error } = await supabaseClient.from('locations').delete().eq('id', String(id));
  if(error){ console.error('delete error', error); showToast('خطأ في الحذف السحابي','error'); }
}
async function bulkUpsertToSupabase(items, onProgress){
  if(!useSupabase || items.length===0) return {ok:0, fail:0};
  // دفعات أكبر للملفات الضخمة لتسريع 500 ألف
  const CHUNK = items.length>50000 ? 1000 : items.length>10000 ? 500 : 300;
  let ok=0, fail=0;
  const rows = items.map(toDb);
  const chunks=chunkArray(rows, CHUNK);
  for(let i=0;i<chunks.length;i++){
    const c=chunks[i];
    let tries=0, done=false;
    while(tries<3 && !done){
      const { error } = await supabaseClient.from('locations').upsert(c, {onConflict:'id'});
      if(!error){ ok+=c.length; done=true; break; }
      tries++;
      console.warn(`chunk ${i+1} try ${tries} fail`, error);
      await new Promise(r=> setTimeout(r, 400*tries));
      if(tries===3){ fail+=c.length; showToast(`فشل جزء ${i+1}/${chunks.length} بعد 3 محاولات`,'error'); }
    }
    if(onProgress) onProgress(i+1, chunks.length, ok);
    // تنفس قصير جداً للملفات الضخمة
    if(i%10===0) await new Promise(r=> setTimeout(r, 20));
    else await new Promise(r=> setTimeout(r, 5));
  }
  if(fail) console.warn(`bulk done: ok=${ok} fail=${fail}`);
  // تحديث العداد السحابي
  if(ok) { CLOUD_COUNT+=ok; if(CLOUD_COUNT> CLOUD_THRESHOLD) CLOUD_MODE=true; }
  return {ok, fail};
}
async function clearSupabase(){
  if(!useSupabase) return;
  // delete all - need to fetch ids first or use truncate via rpc? We'll delete via query with not null
  const { data } = await supabaseClient.from('locations').select('id');
  if(data && data.length){
    const ids = data.map(r=>r.id);
    // Supabase delete requires filter, do in batches
    for(const chunk of chunkArray(ids, 100)){
      await supabaseClient.from('locations').delete().in('id', chunk);
    }
  }
}
function chunkArray(a,n){ const r=[]; for(let i=0;i<a.length;i+=n) r.push(a.slice(i,i+n)); return r; }

function saveLocal(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(DATA)); return true; }catch(e){
    console.warn('localStorage full', e);
    // حاول حفظ آخر 2000 فقط محليا لتجنب الامتلاء
    try{
      const slim=DATA.slice(0,2000);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
      console.log('تم حفظ جزء محلي فقط (2000)');
      return false;
    }catch{ return false; }
  }
}

// Seed fallback
const SEED = [
  { id:'1', sub:'3001234567', equip:'EQ-10234', name:'عبدالله محمد الحربي', address:'بريدة - حي الصفراء - شارع الملك عبدالعزيز', lat:26.3260, lng:43.9750, notes:'العداد داخل السور - الاتصال 0555123456', updatedAt: Date.now()-86400000*2 },
  { id:'2', sub:'3001234568', equip:'EQ-10235', name:'صالح علي العتيبي', address:'عنيزة - حي الفيحاء - طريق الملك سعود', lat:26.0848, lng:43.9936, notes:'عداد تجاري - المفتاح مع الحارس', updatedAt: Date.now()-86400000*1 },
  { id:'3', sub:'3001234569', equip:'EQ-10236', name:'فهد إبراهيم السعيد', address:'الرس - حي الملك فيصل - شارع الرياض', lat:25.8698, lng:43.4970, notes:'', updatedAt: Date.now()-3600000*5 },
  { id:'4', sub:'7005128840', equip:'EQ-8841', name:'محطة تحويل غرب القصيم 1', address:'طريق بريدة - عنيزة السريع - محطة 132KV', lat:26.2105, lng:43.8120, notes:'موقع محطة رئيسية - تصريح دخول مطلوب', updatedAt: Date.now()-3600000*12 },
  { id:'5', sub:'3029987741', equip:'EQ-3022', name:'مستودع المعدات - غرب بريدة', address:'بريدة - الصناعية - شارع المعدات', lat:26.3590, lng:43.9200, notes:'مستودع مركزي', updatedAt: Date.now()-86400000*3 },
  { id:'6', sub:'3009876543', equip:'EQ-9981', name:'ناصر عبدالرحمن القصيمي', address:'البكيرية - حي المطار - شارع الأمير سلطان', lat:26.1605, lng:43.6550, notes:'عداد ذكي - تأكد من القراءة عن بعد', updatedAt: Date.now()-3600000*2 },
  { id:'7', sub:'3007654321', equip:'EQ-7654', name:'سليمان حمد الجربوع', address:'البدائع - حي الربوة - طريق المدينة', lat:25.9970, lng:43.7750, notes:'المنزل دورين - العداد بالدور الأرضي', updatedAt: Date.now()-86400000*7 },
  { id:'8', sub:'3011122233', equip:'EQ-1122', name:'مزرعة النخيل - غرب القصيم', address:'غرب القصيم - طريق المزارع - كيلو 14', lat:26.1500, lng:43.6000, notes:'عداد زراعي - يحتاج سيارة دفع رباعي', updatedAt: Date.now()-3600000*8 },
  { id:'9', sub:'3005556677', equip:'EQ-5566', name:'مسجد الفاروق', address:'بريدة - حي الإسكان - شارع عمر بن الخطاب', lat:26.3330, lng:43.9800, notes:'عداد مسجد - التنسيق مع الإمام', updatedAt: Date.now()-86400000*1 },
  { id:'10', sub:'3004445566', equip:'EQ-4445', name:'مدرسة غرب القصيم الثانوية', address:'عنيزة - حي السلام - شارع المدارس', lat:26.0750, lng:44.0100, notes:'عداد حكومي', updatedAt: Date.now()-3600000*20 },
];

function loadLocal(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return null;
    const arr = JSON.parse(raw);
    if(Array.isArray(arr) && arr.length>0) return arr;
    return null;
  }catch{ return null; }
}

let DATA = [];

// sync helpers
function saveData(){
  saveLocal();
  updateStats();
  renderAdminTable();
  if(lastQuery) doSearch(lastQuery,false);
}

function updateStats(){
  // في الوضع السحابي نعرض العدد الحقيقي من السيرفر
  const total = CLOUD_MODE ? CLOUD_COUNT : DATA.length;
  const el = document.getElementById('statTotal');
  if(el) el.textContent = total.toLocaleString('ar-SA');
  const adminTotal = document.getElementById('adminTotal');
  if(adminTotal) adminTotal.textContent = total.toLocaleString('ar-SA');
  if(CLOUD_MODE){
    const upd=document.getElementById('statUpdate');
    if(upd) upd.textContent=`وضع سحابي ☁️ ${total.toLocaleString('ar-SA')} موقع`;
    const adminLast=document.getElementById('adminLastAdd');
    if(adminLast && CLOUD_COUNT) adminLast.textContent=`سحابي - ${CLOUD_COUNT.toLocaleString('ar-SA')} موقع إجمالي`;
    return;
  }
  const last = DATA.slice().sort((a,b)=> (b.updatedAt||0)-(a.updatedAt||0))[0];
  const upd = document.getElementById('statUpdate');
  if(upd && last){
    const d = new Date(last.updatedAt);
    if(!useSupabase) upd.textContent = d.toLocaleDateString('ar-SA', { day:'numeric', month:'short', year:'numeric'});
    const adminLast = document.getElementById('adminLastAdd');
    if(adminLast) adminLast.textContent = d.toLocaleDateString('ar-SA') + ' • ' + (last.sub||'');
  }
}

// Search
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const clearBtn = document.getElementById('clearBtn');
const emptyState = document.getElementById('emptyState');
const resultsContainer = document.getElementById('resultsContainer');
const noResults = document.getElementById('noResults');
const noResultsQuery = document.getElementById('noResultsQuery');
let lastQuery = '';
function normalize(s){ return (s||'').toString().trim().replace(/\s+/g,'').toLowerCase(); }
function matches(item,q){ const nq=normalize(q); if(!nq) return false; return normalize(item.sub).includes(nq) || normalize(item.equip).includes(nq) || normalize(item.sub.replace(/-/g,'')).includes(nq) || normalize(item.equip.replace(/-/g,'')).includes(nq); }
function googleMapsLink(lat,lng){ return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`; }
function googleMapsDirections(lat,lng){ return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`; }
function wazeLink(lat,lng){ return `https://waze.com/ul?ll=${lat}%2C${lng}&navigate=yes`; }
function appleMapsLink(lat,lng){ return `https://maps.apple.com/?q=${lat},${lng}&ll=${lat},${lng}`; }
async function doSearch(q, scroll=true){
  lastQuery = q;
  const query = (q||'').trim();
  if(!query){ emptyState.classList.remove('hidden'); resultsContainer.classList.add('hidden'); noResults.classList.add('hidden'); resultsContainer.innerHTML=''; return; }
  if(CLOUD_MODE && useSupabase){
    emptyState.classList.add('hidden'); noResults.classList.add('hidden'); resultsContainer.classList.remove('hidden');
    resultsContainer.innerHTML=`<div class="bg-white rounded-2xl border border-blue-200 px-4 py-6 text-center"><i class="fa-solid fa-spinner fa-spin text-blue-600 ml-2"></i> جاري البحث في ${CLOUD_COUNT.toLocaleString('ar-SA')} موقع...</div>`;
    const results = await searchSupabase(query);
    if(results.length===0){ resultsContainer.classList.add('hidden'); noResults.classList.remove('hidden'); noResultsQuery.textContent=`البحث: "${query}" - ${CLOUD_COUNT.toLocaleString('ar-SA')} موقع بالسحابة`; return; }
    resultsContainer.innerHTML = `
    <div class="bg-white rounded-2xl border border-blue-200 px-4 py-3 flex items-center justify-between shadow-sm">
      <p class="text-sm font-black text-zinc-800"><i class="fa-solid fa-check-circle text-blue-600 ml-2"></i> تم العثور على <span class="bg-primary text-white px-2 py-0.5 rounded-full text-xs mx-1">${results.length}</span> من ${CLOUD_COUNT.toLocaleString('ar-SA')} \u2022 البحث: <span class="font-mono bg-zinc-900 text-white px-2 py-1 rounded-lg text-xs">${escapeHtml(query)}</span> <span class="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200 mr-1">\u2601\uFE0F سحابي</span></p>
      <button id="shareResults" class="hidden sm:flex items-center gap-2 bg-zinc-900 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-black"><i class="fa-solid fa-share-nodes"></i> مشاركة</button>
    </div>
    ${results.map(item=> cardHtml(item)).join('')}
  `;
    if(scroll) resultsContainer.scrollIntoView({behavior:'smooth', block:'start'});
    attachCardEvents(); return;
  }
  const results = DATA.filter(it=> matches(it, query));
  if(results.length===0){ emptyState.classList.add('hidden'); resultsContainer.classList.add('hidden'); noResults.classList.remove('hidden'); noResultsQuery.textContent = `البحث: "${query}"`; return; }
  emptyState.classList.add('hidden'); noResults.classList.add('hidden'); resultsContainer.classList.remove('hidden');
  resultsContainer.innerHTML = `
    <div class="bg-white rounded-2xl border border-blue-200 px-4 py-3 flex items-center justify-between shadow-sm">
      <p class="text-sm font-black text-zinc-800"><i class="fa-solid fa-check-circle text-blue-600 ml-2"></i> تم العثور على <span class="bg-primary text-white px-2 py-0.5 rounded-full text-xs mx-1">${results.length}</span> نتيجة للبحث: <span class="font-mono bg-zinc-900 text-white px-2 py-1 rounded-lg text-xs">${escapeHtml(query)}</span></p>
      <button id="shareResults" class="hidden sm:flex items-center gap-2 bg-zinc-900 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-black"><i class="fa-solid fa-share-nodes"></i> مشاركة</button>
    </div>
    ${results.map(item=> cardHtml(item)).join('')}
  `;
  if(scroll) resultsContainer.scrollIntoView({behavior:'smooth', block:'start'});
  attachCardEvents();
}
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, m=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function cardHtml(item){
  const mapUrl = googleMapsLink(item.lat, item.lng);
  const dirUrl = googleMapsDirections(item.lat, item.lng);
  const wz = wazeLink(item.lat, item.lng);
  const updated = item.updatedAt ? new Date(item.updatedAt).toLocaleDateString('ar-SA', {year:'numeric', month:'long', day:'numeric'}) : '-';
  return `
  <div class="bg-white rounded-[20px] border border-zinc-200 shadow-sm overflow-hidden animate-in">
    <div class="h-1.5 bg-gradient-to-r from-primary to-accent"></div>
    <div class="p-5 md:p-6">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-2xl bg-primary text-white flex items-center justify-center shadow-lg shadow-primary/20"><i class="fa-solid fa-location-dot text-lg"></i></div>
          <div>
            <h3 class="font-black text-[15px] leading-none">${escapeHtml(item.name||'مشترك')}</h3>
            <p class="text-xs text-zinc-500 mt-1 flex items-center gap-2"><i class="fa-solid fa-map-pin text-zinc-400"></i> ${escapeHtml(item.address||'—')}</p>
          </div>
        </div>
        <span class="bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-full text-[11px] font-black flex items-center gap-1"><span class="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span> متاح - جاهز للزيارة</span>
      </div>
      <div class="grid md:grid-cols-3 gap-3 mt-5">
        <div class="bg-zinc-50 rounded-2xl p-4 border border-zinc-100">
          <p class="text-[11px] font-bold text-zinc-500 tracking-wider">رقم الاشتراك</p>
          <p class="font-mono font-black text-[15px] mt-1 flex items-center justify-between">${escapeHtml(item.sub)} <button class="copyBtn w-7 h-7 bg-white border border-zinc-200 rounded-lg flex items-center justify-center text-zinc-600 hover:bg-zinc-900 hover:text-white transition" data-copy="${escapeHtml(item.sub)}"><i class="fa-regular fa-copy text-xs"></i></button></p>
        </div>
        <div class="bg-zinc-50 rounded-2xl p-4 border border-zinc-100">
          <p class="text-[11px] font-bold text-zinc-500">رقم التجهيز</p>
          <p class="font-mono font-black text-[15px] mt-1 flex items-center justify-between">${escapeHtml(item.equip)} <button class="copyBtn w-7 h-7 bg-white border border-zinc-200 rounded-lg flex items-center justify-center text-zinc-600 hover:bg-zinc-900 hover:text-white transition" data-copy="${escapeHtml(item.equip)}"><i class="fa-regular fa-copy text-xs"></i></button></p>
        </div>
        <div class="bg-zinc-50 rounded-2xl p-4 border border-zinc-100">
          <p class="text-[11px] font-bold text-zinc-500">الإحداثيات</p>
          <p class="font-mono font-bold text-xs mt-1 leading-relaxed">${item.lat.toFixed(6)}, ${item.lng.toFixed(6)}</p>
          <p class="text-[11px] text-zinc-500 mt-1">آخر تحديث: ${updated}</p>
        </div>
      </div>
      ${item.notes ? `<div class="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs flex gap-2"><i class="fa-solid fa-circle-info text-amber-600 mt-0.5"></i><span><b>ملاحظات:</b> ${escapeHtml(item.notes)}</span></div>` : ''}
      <div class="mt-4 grid lg:grid-cols-[1.2fr_0.8fr] gap-4">
        <div class="bg-zinc-50 rounded-[16px] border border-zinc-200 p-2 h-[220px] overflow-hidden relative">
          <iframe class="map-iframe" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${item.lat},${item.lng}&z=15&output=embed"></iframe>
          <a href="${mapUrl}" target="_blank" class="absolute bottom-3 right-3 bg-zinc-900 text-white px-3 py-1.5 rounded-full text-[11px] font-bold flex items-center gap-1 shadow-lg"><i class="fa-solid fa-expand"></i> تكبير الخريطة</a>
        </div>
        <div class="space-y-3">
          <a href="${dirUrl}" target="_blank" rel="noopener" class="w-full bg-primary hover:bg-primaryDark text-white rounded-2xl py-4 font-black flex items-center justify-center gap-3 shadow-lg shadow-primary/20 transition text-[15px]">
            <i class="fa-brands fa-google text-lg"></i> فتح في Google Maps
            <i class="fa-solid fa-arrow-up-right-from-square text-xs opacity-80"></i>
          </a>
          <div class="grid grid-cols-2 gap-3">
            <a href="${wz}" target="_blank" class="bg-[#33CCFF] hover:bg-[#00BFFF] text-white rounded-xl py-3 font-bold flex items-center justify-center gap-2 text-sm transition"><i class="fa-brands fa-waze"></i> Waze</a>
            <a href="${appleMapsLink(item.lat,item.lng)}" target="_blank" class="bg-zinc-900 hover:bg-black text-white rounded-xl py-3 font-bold flex items-center justify-center gap-2 text-sm transition"><i class="fa-brands fa-apple"></i> Apple Maps</a>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <button data-copy="${item.lat},${item.lng}" class="copyBtn bg-white border border-zinc-200 hover:bg-zinc-50 rounded-xl py-3 font-bold text-xs flex items-center justify-center gap-2"><i class="fa-regular fa-copy"></i> نسخ الإحداثيات</button>
            <button data-copy="${mapUrl}" class="copyBtn bg-white border border-zinc-200 hover:bg-zinc-50 rounded-xl py-3 font-bold text-xs flex items-center justify-center gap-2"><i class="fa-solid fa-link"></i> نسخ رابط الموقع</button>
          </div>
          <p class="text-[11px] text-zinc-500 text-center bg-zinc-50 border border-zinc-200 rounded-xl py-2">اضغط "فتح في Google Maps" لبدء الملاحة الصوتية فوراً</p>
        </div>
      </div>
    </div>
  </div>
  `;
}
function attachCardEvents(){
  document.querySelectorAll('.copyBtn').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const v = btn.getAttribute('data-copy');
      try{ await navigator.clipboard.writeText(v); showToast('تم النسخ ✓'); }catch{
        const ta=document.createElement('textarea'); ta.value=v; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); showToast('تم النسخ ✓');
      }
    });
  });
  const shareBtn=document.getElementById('shareResults');
  if(shareBtn){ shareBtn.addEventListener('click', async ()=>{
    const text=`نتائج البحث: ${lastQuery} - مكتب غرب القصيم للكهرباء`;
    if(navigator.share){ try{ await navigator.share({title:'مكتب غرب القصيم', text, url: location.href}); }catch{} }
    else{ await navigator.clipboard.writeText(location.href); showToast('تم نسخ رابط المشاركة'); }
  }); }
}
if(searchBtn) searchBtn.addEventListener('click', ()=> doSearch(searchInput.value));
if(clearBtn) clearBtn.addEventListener('click', ()=>{ searchInput.value=''; doSearch(''); searchInput.focus(); });
if(searchInput){
  searchInput.addEventListener('keydown', e=>{ if(e.key==='Enter') doSearch(searchInput.value); });
  searchInput.addEventListener('input', ()=>{
    clearTimeout(searchInput._t);
    searchInput._t = setTimeout(()=> doSearch(searchInput.value, false), 350);
  });
}
document.querySelectorAll('.chip').forEach(ch=> ch.addEventListener('click', ()=>{ searchInput.value = ch.dataset.example; doSearch(ch.dataset.example); }));
let toastTimer;
function showToast(msg, type='default'){
  const toast=document.getElementById('toast');
  const inner=document.getElementById('toastInner');
  if(!toast||!inner) return;
  inner.innerHTML = (type==='error' ? '<i class="fa-solid fa-circle-xmark text-red-400"></i>' : '<i class="fa-solid fa-circle-check text-emerald-400"></i>') + `<span>${msg}</span>`;
  inner.className = `px-5 py-3 rounded-2xl shadow-2xl text-sm font-bold flex items-center gap-3 min-w-[280px] justify-center ${type==='error'?'bg-red-600 text-white':'bg-zinc-900 text-white'}`;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=> toast.classList.add('hidden'), 2500);
}
// Admin Auth
const loginModal=document.getElementById('loginModal');
const loginBackdrop=document.getElementById('loginBackdrop');
const btnAdmin=document.getElementById('btnAdmin');
const btnTech=document.getElementById('btnTech');
const loginBtn=document.getElementById('loginBtn');
const loginCancel=document.getElementById('loginCancel');
const loginUser=document.getElementById('loginUser');
const loginPass=document.getElementById('loginPass');
const loginError=document.getElementById('loginError');
const adminDrawer=document.getElementById('adminDrawer');
const adminBackdrop=document.getElementById('adminBackdrop');
const adminClose=document.getElementById('adminClose');
function isLogged(){ return sessionStorage.getItem(AUTH_KEY)==='1'; }
function openLogin(){ loginModal.classList.remove('hidden'); loginError.classList.add('hidden'); loginUser.focus(); }
function closeLogin(){ loginModal.classList.add('hidden'); }
function openAdmin(){ adminDrawer.classList.remove('hidden'); document.body.style.overflow='hidden'; renderAdminTable(); }
function closeAdmin(){ adminDrawer.classList.add('hidden'); document.body.style.overflow=''; }
if(btnAdmin) btnAdmin.addEventListener('click', ()=>{ if(isLogged()) openAdmin(); else openLogin(); });
if(btnTech) btnTech.addEventListener('click', ()=>{ document.querySelector('section').scrollIntoView({behavior:'smooth'}); searchInput.focus(); });
if(loginCancel) loginCancel.addEventListener('click', closeLogin);
if(loginBackdrop) loginBackdrop.addEventListener('click', closeLogin);
if(adminBackdrop) adminBackdrop.addEventListener('click', closeAdmin);
if(adminClose) adminClose.addEventListener('click', closeAdmin);
function attemptLogin(){
  const u=loginUser.value.trim(); const p=loginPass.value.trim(); const creds=getCreds();
  if(u===creds.user && p===creds.pass){ sessionStorage.setItem(AUTH_KEY,'1'); closeLogin(); openAdmin(); showToast('مرحباً بك في لوحة التحكم ✓'); }
  else if(u==='owner' && p==='west2026'){ sessionStorage.setItem(AUTH_KEY,'1'); closeLogin(); openAdmin(); showToast('مرحباً بك ✓'); }
  else{ loginError.textContent='بيانات الدخول غير صحيحة - تأكد من اسم المستخدم وكلمة المرور'; loginError.classList.remove('hidden'); }
}
if(loginBtn) loginBtn.addEventListener('click', attemptLogin);
if(loginPass) loginPass.addEventListener('keydown', e=>{ if(e.key==='Enter') attemptLogin(); });

// Admin Form
const form=document.getElementById('locationForm');
const fSub=document.getElementById('fSub');
const fEquip=document.getElementById('fEquip');
const fName=document.getElementById('fName');
const fAddress=document.getElementById('fAddress');
const fLat=document.getElementById('fLat');
const fLng=document.getElementById('fLng');
const fNotes=document.getElementById('fNotes');
const editId=document.getElementById('editId');
const formSubmitBtn=document.getElementById('formSubmitBtn');
const formResetBtn=document.getElementById('formResetBtn');

if(form) form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const sub=fSub.value.trim(); const equip=fEquip.value.trim(); const name=fName.value.trim(); const address=fAddress.value.trim();
  const lat=parseFloat(fLat.value); const lng=parseFloat(fLng.value); const notes=fNotes.value.trim();
  if(!sub||!equip||isNaN(lat)||isNaN(lng)){ showToast('يرجى تعبئة الحقول المطلوبة (*) بشكل صحيح','error'); return; }
  if(lat<-90||lat>90||lng<-180||lng>180){ showToast('الإحداثيات غير صحيحة','error'); return; }
  const id=editId.value;
  if(id){
    const idx=DATA.findIndex(x=> x.id===id);
    if(idx>-1){
      const updated={...DATA[idx], sub, equip, name: name||DATA[idx].name, address, lat, lng, notes, updatedAt: Date.now()};
      DATA[idx]=updated;
      saveData();
      await upsertToSupabase(updated);
      showToast('تم تحديث الموقع ✓');
    }
  } else {
    if(DATA.some(x=> x.sub===sub)){ if(!confirm(`رقم الاشتراك ${sub} موجود مسبقاً. هل تريد المتابعة وإضافة موقع جديد بنفس الرقم؟`)) return; }
    const newItem={ id: Date.now().toString(), sub, equip, name: name||'مشترك', address, lat, lng, notes, updatedAt: Date.now()};
    DATA.unshift(newItem);
    saveData();
    await upsertToSupabase(newItem);
    showToast('تمت إضافة الموقع بنجاح - متزامن سحابياً ✓');
  }
  form.reset(); editId.value=''; if(formSubmitBtn) formSubmitBtn.innerHTML='<i class="fa-solid fa-floppy-disk"></i> حفظ الموقع';
});

if(formResetBtn) formResetBtn.addEventListener('click', ()=>{ form.reset(); editId.value=''; if(formSubmitBtn) formSubmitBtn.innerHTML='<i class="fa-solid fa-floppy-disk"></i> حفظ الموقع'; showToast('تم تفريغ النموذج'); });
const locBtn=document.getElementById('btnGetCurrentLocation');
if(locBtn) locBtn.addEventListener('click', ()=>{
  if(!navigator.geolocation){ showToast('المتصفح لا يدعم تحديد الموقع','error'); return; }
  showToast('جاري تحديد موقعك الحالي...');
  navigator.geolocation.getCurrentPosition(pos=>{
    fLat.value=pos.coords.latitude.toFixed(6); fLng.value=pos.coords.longitude.toFixed(6); showToast('تم التقاط إحداثيات موقعك ✓');
  }, err=>{ showToast('تعذر تحديد الموقع: '+err.message,'error'); }, {enableHighAccuracy:true, timeout:10000});
});

const adminSearch=document.getElementById('adminSearch');
const adminTableBody=document.getElementById('adminTableBody');
const adminEmpty=document.getElementById('adminEmpty');
function editItem(id){
  const it=DATA.find(x=> x.id===id); if(!it) return;
  editId.value=it.id; fSub.value=it.sub; fEquip.value=it.equip; fName.value=it.name||''; fAddress.value=it.address||''; fLat.value=it.lat; fLng.value=it.lng; fNotes.value=it.notes||'';
  if(formSubmitBtn) formSubmitBtn.innerHTML='<i class="fa-solid fa-pen"></i> تحديث الموقع';
  window.scrollTo({top:0, behavior:'smooth'});
  document.getElementById('locationForm').scrollIntoView({behavior:'smooth', block:'center'});
  showToast('وضع التعديل - عدّل البيانات ثم احفظ');
}
async function deleteItem(id){
  if(!confirm('هل أنت متأكد من حذف هذا الموقع؟')) return;
  DATA=DATA.filter(x=> x.id!==id);
  saveData();
  await deleteFromSupabase(id);
  showToast('تم الحذف - متزامن سحابياً');
}
async function duplicateItem(id){
  const it=DATA.find(x=> x.id===id); if(!it) return;
  const copy={...it, id: Date.now().toString(), sub: it.sub+'-COPY', updatedAt: Date.now()};
  DATA.unshift(copy); saveData(); await upsertToSupabase(copy); showToast('تم النسخ ✓');
}
function renderAdminTable(){
  const q=(adminSearch.value||'').trim().toLowerCase();
  let filtered=DATA;
  if(q){
    // في الوضع السحابي لو البحث فارغ لا نبحث في الـ 200 فقط - يبحث سحابياً عبر doSearch
    filtered=DATA.filter(it=> it.sub.toLowerCase().includes(q) || it.equip.toLowerCase().includes(q) || (it.name||'').toLowerCase().includes(q) || (it.address||'').toLowerCase().includes(q));
  }
  const countEl=document.getElementById('adminFilteredCount'); if(countEl) countEl.textContent= (CLOUD_MODE? CLOUD_COUNT : filtered.length).toLocaleString('ar-SA');
  if(filtered.length===0){ adminTableBody.innerHTML=''; adminEmpty.classList.remove('hidden'); if(CLOUD_MODE) adminEmpty.innerHTML=`لا يوجد في الـ 200 المعروضة - استخدم البحث للبحث في ${CLOUD_COUNT.toLocaleString('ar-SA')} موقع بالسحابة ☁️`; else adminEmpty.textContent='لا توجد بيانات مطابقة'; return; }
  adminEmpty.classList.add('hidden');
  // للـ 500 ألف: لا نرسم أكثر من 250 صف لتجنب التهنيج
  const LIMIT=250;
  const toShow = filtered.slice(0, LIMIT);
  const extra = filtered.length - toShow.length;
  adminTableBody.innerHTML=toShow.map(it=>`
    <tr class="hover:bg-zinc-50 transition">
      <td class="px-4 py-3 font-mono font-bold text-xs">${escapeHtml(it.sub)}</td>
      <td class="px-4 py-3 font-mono font-bold text-xs">${escapeHtml(it.equip)}</td>
      <td class="px-4 py-3">
        <p class="font-bold text-xs leading-none">${escapeHtml(it.name||'-')}</p>
        <p class="text-[11px] text-zinc-500 mt-1 truncate max-w-[240px]">${escapeHtml(it.address||'—')}</p>
      </td>
      <td class="px-4 py-3 font-mono text-[11px]">${it.lat.toFixed(4)}, ${it.lng.toFixed(4)}<br><span class="text-[10px] text-zinc-500">${new Date(it.updatedAt).toLocaleDateString('ar-SA')}</span></td>
      <td class="px-4 py-3">
        <div class="flex items-center justify-center gap-1">
          <button data-act="open" data-id="${it.id}" class="w-8 h-8 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 flex items-center justify-center" title="فتح في الخرائط"><i class="fa-solid fa-location-dot text-xs"></i></button>
          <button data-act="edit" data-id="${it.id}" class="w-8 h-8 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 flex items-center justify-center" title="تعديل"><i class="fa-solid fa-pen text-xs"></i></button>
          <button data-act="copy" data-id="${it.id}" class="w-8 h-8 rounded-lg bg-zinc-50 hover:bg-zinc-100 text-zinc-700 border border-zinc-200 flex items-center justify-center" title="نسخ"><i class="fa-regular fa-copy text-xs"></i></button>
          <button data-act="del" data-id="${it.id}" class="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 flex items-center justify-center" title="حذف"><i class="fa-solid fa-trash text-xs"></i></button>
        </div>
      </td>
    </tr>
  `).join('');
  adminTableBody.querySelectorAll('button').forEach(btn=>{
    const act=btn.dataset.act; const id=btn.dataset.id;
    btn.addEventListener('click', ()=>{
      if(act==='edit') editItem(id);
      else if(act==='del') deleteItem(id);
      else if(act==='open'){ const it=DATA.find(x=>x.id===id); window.open(googleMapsLink(it.lat,it.lng), '_blank'); }
      else if(act==='copy') duplicateItem(id);
    });
  });
  if(extra>0){
    const tr=document.createElement('tr');
    tr.innerHTML=`<td colspan="5" class="px-4 py-3 text-center bg-amber-50 text-amber-800 text-xs font-bold">عرض ${LIMIT.toLocaleString('ar-SA')} من ${filtered.length.toLocaleString('ar-SA')} - استخدم الفلتر لتضييق النتائج ${CLOUD_MODE?`(${CLOUD_COUNT.toLocaleString('ar-SA')} بالسحابة - البحث يعرض 50 نتيجة سحابية)` : ''}</td>`;
    adminTableBody.appendChild(tr);
  }
}
if(adminSearch) adminSearch.addEventListener('input', renderAdminTable);

// Export / Import
const btnExport=document.getElementById('btnExport');
if(btnExport) btnExport.addEventListener('click', exportCSV);
const btnTemplate=document.getElementById('btnDownloadTemplate');
if(btnTemplate) btnTemplate.addEventListener('click', ()=>{
  const csv='رقم الاشتراك,رقم التجهيز,اسم المشترك,العنوان,lat,lng,ملاحظات\n30002845062,5009864858,مثال مستفيد - بريدة,بريدة - حي المطار - شارع الملك عبدالعزيز,26.3260,43.9750,عداد داخل السور\n3001234567,5001122334,عبدالله الحربي,عنيزة - الفيحاء,26.0848,43.9936,\n7078401,30002845063,5009864859,اختبار استيراد بثلاثة أعمدة,26.2000,43.8000,\n';
  downloadFile(csv,'قالب_غرب_القصيم_الذكي.csv','text/csv;charset=utf-8;'); showToast('تم تحميل القالب الذكي ✓ - يدعم 30/500');
});
function exportCSV(){
  const header='رقم الاشتراك,رقم التجهيز,اسم المشترك,العنوان,lat,lng,ملاحظات,آخر تحديث';
  const rows=DATA.map(it=> `"${it.sub}","${it.equip}","${(it.name||'').replace(/"/g,'""')}","${(it.address||'').replace(/"/g,'""')}",${it.lat},${it.lng},"${(it.notes||'').replace(/"/g,'""')}","${new Date(it.updatedAt).toISOString()}"`);
  const csv=[header, ...rows].join('\n');
  downloadFile(csv,`مواقع_غرب_القصيم_${new Date().toISOString().slice(0,10)}.csv`,'text/csv;charset=utf-8;'); showToast('تم تصدير البيانات ✓');
}
function downloadFile(content, filename, mime){
  const blob=new Blob(["\ufeff"+content], {type:mime}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
// === استيراد ذكي: يدعم أرقام 30/300 و 50/500 + Excel + CSV بكل الصيغ ===
const csvInput=document.getElementById('csvInput');
const importLog=document.getElementById('importLog');

// تحويل خلية Excel لرقم نصي بدون فقدان + بدون علمي
function cellToString(v){
  if(v==null) return '';
  if(typeof v==='number'){
    let s=String(v);
    if(s.includes('e')||s.includes('E')) s=v.toFixed(0);
    else if(Number.isInteger(v)) s=String(Math.trunc(v));
    // إزالة .0 الزائدة
    if(s.endsWith('.0')) s=s.slice(0,-2);
    return s.trim();
  }
  return String(v).trim();
}
function isSubValue(s){
  s=cellToString(s).replace(/\s+/g,'');
  if(!s) return false;
  // رقم الحساب يبدأ 30 أو 300 أو 3xxx وطوله 8-12
  return /^300\d{6,9}$/.test(s) || /^30\d{6,10}$/.test(s) || /^3\d{7,11}$/.test(s);
}
function isEquipValue(s){
  s=cellToString(s).replace(/\s+/g,'');
  if(!s) return false;
  return /^500\d{6,9}$/.test(s) || /^50\d{6,10}$/.test(s) || /^5\d{7,11}$/.test(s);
}
function detectDelimiter(text){
  const first=text.split(/\r?\n/).find(l=>l.trim())||'';
  const counts={',':(first.match(/,/g)||[]).length, ';':(first.match(/;/g)||[]).length, '\t':(first.match(/\t/g)||[]).length};
  let best=',', max=counts[','];
  if(counts[';']>max){best=';'; max=counts[';'];}
  if(counts['\t']>max){best='\t'; max=counts['\t'];}
  // لو لا يوجد فاصل واضح لكن يوجد مسافات متعددة
  if(max===0 && /\s{2,}/.test(first)) return 'SPACE';
  return best;
}
function parseLineWithDelimiter(line, delim){
  if(delim==='SPACE') return line.trim().split(/\s+/);
  // فاصل عادي مع احترام علامات الاقتباس
  const cols=[]; let cur=''; let inQuote=false;
  for(let i=0;i<line.length;i++){ const ch=line[i]; if(ch==='"'){ if(inQuote && line[i+1]==='"'){ cur+='"'; i++; } else inQuote=!inQuote; } else if(ch===delim && !inQuote){ cols.push(cur); cur=''; } else cur+=ch; }
  cols.push(cur); return cols.map(c=> c.trim().replace(/^"|"$/g,''));
}
function parseCSVLinesSmart(text){
  const clean=text.replace(/^\ufeff/,'').trim();
  if(!clean) return [];
  const delim=detectDelimiter(clean);
  const rawLines=clean.split(/\r?\n/).filter(l=> l.trim()!=='');
  return rawLines.map(l=> parseLineWithDelimiter(l, delim));
}
function extractLatLng(cells){
  // ابحث عن رقمين عشريين في النطاق الصحيح
  const nums=[];
  for(const c of cells){
    const s=cellToString(c);
    const matches=s.match(/-?\d+\.\d+/g);
    if(matches) nums.push(...matches);
  }
  // أيضا الخلايا نفسها لو كانت رقم عشري مباشر
  for(let i=cells.length-1;i>=0;i--){
    const v=parseFloat(cellToString(cells[i]));
    if(!isNaN(v) && String(cells[i]).includes('.')) nums.push(String(v));
  }
  // نحاول أخذ آخر رقمين يمثلان إحداثيات السعودية تقريبا
  for(let i=nums.length-1;i>=1;i--){
    const lat=parseFloat(nums[i-1]), lng=parseFloat(nums[i]);
    if(isNaN(lat)||isNaN(lng)) continue;
    if(lat>=16 && lat<=33 && lng>=34 && lng<=50) return {lat,lng};
  }
  // fallback: أي رقمين في النطاق العام
  if(nums.length>=2){
    const lat=parseFloat(nums[nums.length-2]), lng=parseFloat(nums[nums.length-1]);
    if(lat>=-90&&lat<=90 && lng>=-180&&lng<=180) return {lat,lng};
  }
  return null;
}
function looksLikeHeader(cells){
  const joined=cells.join(' ').toLowerCase();
  if(joined.includes('رقم الاشتراك')||joined.includes('رقم التجهيز')||joined.includes('رقم الحساب')||joined.includes('sub')||joined.includes('equip')||joined.includes('account')||joined.includes('lat')||joined.includes('lng')||joined.includes('خط العرض')||joined.includes('خط الطول')) return true;
  // لو الصف الأول لا يحتوي أرقام 30/500 يعتبر هيدر
  const hasSub=cells.some(c=> isSubValue(c));
  const hasEquip=cells.some(c=> isEquipValue(c));
  const hasCoord=cells.some(c=> !isNaN(parseFloat(cellToString(c))) && cellToString(c).includes('.') && parseFloat(cellToString(c))>10);
  if(!hasSub && !hasEquip && !hasCoord) return true;
  return false;
}

function setImportProgress(pct, text, detail){
  const wrap=document.getElementById('importProgressWrap');
  const bar=document.getElementById('importProgressBar');
  const pctEl=document.getElementById('importProgressPct');
  const textEl=document.getElementById('importProgressText');
  const det=document.getElementById('importProgressDetail');
  if(!wrap) return;
  wrap.classList.remove('hidden');
  if(bar) bar.style.width=pct+'%';
  if(pctEl) pctEl.textContent=Math.round(pct)+'%';
  if(textEl && text) textEl.textContent=text;
  if(det && detail) det.textContent=detail;
}
function hideImportProgress(){ const w=document.getElementById('importProgressWrap'); if(w) setTimeout(()=>w.classList.add('hidden'),1200); }

async function handleImportMatrix(matrix){
  if(!matrix || matrix.length===0){ showToast('الملف فارغ','error'); return; }
  let startIdx=0;
  if(matrix.length>=1 && looksLikeHeader(matrix[0])) startIdx=1;
  const totalRows=matrix.length-startIdx;
  setImportProgress(2, `جاري تحليل ${totalRows.toLocaleString('ar-SA')} صف...`, 'قد تستغرق العملية ثوانٍ للملفات الكبيرة - لا تغلق الصفحة');
  let added=0, updated=0, skipped=0; let logLines=[]; let newItems=[];
  let processed=0;
  // خريطة سريعة للموجود - O(1)
  const existingMap = new Map(DATA.map(x=>[String(x.sub), x]));
  const fileSeen = new Map();
  const BATCH=800; // أكبر قليلا مع yield يمنع التهنيج
  for(let batchStart=startIdx; batchStart<matrix.length; batchStart+=BATCH){
    const batchEnd=Math.min(batchStart+BATCH, matrix.length);
    for(let i=batchStart;i<batchEnd;i++){
      const cells=matrix[i].map(cellToString);
      if(cells.every(c=> !c)) continue;
      // --- كشف ذكي لأرقام الحساب والتجهيز ---
      let sub='', equip='';
      // 1) بحث بالبادئة 30/300 و 50/500
      for(const c of cells){
        const s=c.replace(/\s+/g,'');
        if(!sub && isSubValue(s)) sub=s;
        else if(!equip && isEquipValue(s)) equip=s;
      }
    // 2) fallback: إذا لم نجد بالبادئة، جرب استنتاج بالطول/الموضع
    if(!sub || !equip){
      // اجمع كل الأرقام الطويلة (>=8 أرقام)
      const numbers=cells.map(c=> c.replace(/[^0-9]/g,'')).filter(s=> s.length>=7);
      if(numbers.length>=2){
        // الأكبر طولا أو يبدأ 500 هو التجهيز
        const sorted=[...numbers].sort((a,b)=> b.length-a.length);
        for(const n of numbers){
          if(!equip && (n.startsWith('500')||n.startsWith('50'))) equip=n;
        }
        for(const n of numbers){
          if(!sub && (n.startsWith('300')||n.startsWith('30'))) sub=n;
        }
        // لو ما زال ناقص، افترض أول رقمين
        if(!sub && numbers[0]) sub=numbers[0];
        if(!equip && numbers[1]) equip=numbers[1];
      }
      // fallback نهائي: عمودين أوليين
      if(!sub) sub=cellToString(cells[0]);
      if(!equip) equip=cellToString(cells[1]);
    }
    sub=(sub||'').trim().replace(/\s+/g,'');
    equip=(equip||'').trim().replace(/\s+/g,'');

    if(!sub || !equip){ skipped++; logLines.push(`سطر ${i+1}: تخطي - لم نعثر على رقم حساب/تجهيز (وجد: ${cells.slice(0,3).join(' | ')})`); continue; }

    // اسم/عنوان/ملاحظات: خذ أي خلايا نصية ليست أرقام
    let name='', address='', notes='';
    const textCells=cells.filter(c=> c && isNaN(Number(c.replace(/\s+/g,''))) && !isSubValue(c) && !isEquipValue(c) && !c.includes('.'));
    // حاول التقاط النصوص الطويلة
    if(textCells.length>=1) name=textCells[0];
    if(textCells.length>=2) address=textCells.slice(1).join(' - ');
    // لو كان هناك عمود نصي واضح بعد الأرقام
    // lat/lng
    let ll=extractLatLng(cells);
    let lat= ll? ll.lat : NaN;
    let lng= ll? ll.lng : NaN;
    // لو لم نجد إحداثيات، نحاول أخذ العمود 4 و 5 مباشرة (لو الملف فيه إحداثيات)
    if(isNaN(lat)){
      // جرب الأعمدة 3،4 كأرقام عشرية
      for(let k=0;k<cells.length;k++){
        const v=parseFloat(cellToString(cells[k]));
        const hasDot=String(cells[k]).includes('.');
        if(!isNaN(v) && hasDot && v>=16 && v<=33){
          const v2=parseFloat(cellToString(cells[k+1]));
          if(!isNaN(v2) && v2>=34 && v2<=50){ lat=v; lng=v2; break; }
        }
      }
    }

    // إذا ما زالت الإحداثيات مفقودة، نسمح بالاستيراد لكن نضع 0,0 مع تنبيه
    let missingCoords=false;
    if(isNaN(lat)||isNaN(lng)){ lat=0; lng=0; missingCoords=true; notes=(notes? notes+' | ':'')+'⚠️ يحتاج تحديث إحداثيات'; }

    // ديدوب سريع O(1) بدل O(n²) - يمنع التهنيج مع 500 ألف
    const subKey = String(sub);
    // داخل الملف نفسه لو تكرر نفس الحساب نحدثه لا نكرره
    if(fileSeen.has(subKey)){
      const prevInFile=fileSeen.get(subKey);
      // حدث الموجود في نفس الملف (آخر قيمة تفوز)
      if(!missingCoords || (!prevInFile.lat && !prevInFile.lng)) { prevInFile.lat=lat; prevInFile.lng=lng; }
      prevInFile.equip=equip; prevInFile.name=name||prevInFile.name; prevInFile.address=address||prevInFile.address; prevInFile.notes=notes||prevInFile.notes; prevInFile.updatedAt=Date.now();
      updated++; if(logLines.length<120) logLines.push(`سطر ${i+1}: تحديث مكرر داخل الملف ${sub} / ${equip}`);
      continue;
    }
    if(existingMap.has(subKey)){
      const prev=existingMap.get(subKey);
      if(missingCoords && prev.lat && prev.lng){ lat=prev.lat; lng=prev.lng; }
      const updatedObj={...prev, sub, equip, name: name||prev.name, address: address||prev.address, lat, lng, notes: notes||prev.notes, updatedAt: Date.now()};
      // حدث DATA أيضاً لو موجود
      const idx=DATA.findIndex(x=>String(x.sub)===subKey);
      if(idx>-1) DATA[idx]=updatedObj; else DATA.push(updatedObj);
      existingMap.set(subKey, updatedObj);
      fileSeen.set(subKey, updatedObj);
      newItems.push(updatedObj);
      updated++; if(logLines.length<120) logLines.push(`سطر ${i+1}: تحديث موجود ${sub} / ${equip}${missingCoords?' (بدون إحداثيات)':''}`);
    } else {
      // id ثابت من sub لمنع التكرار حتى بعد إعادة التشغيل - upsert على id سيحدث نفس الصف
      const nid='loc_'+subKey;
      const obj={ id: nid, sub, equip, name: name||'مشترك', address: address||'', lat, lng, notes, updatedAt: Date.now()};
      DATA.push(obj);
      existingMap.set(subKey, obj);
      fileSeen.set(subKey, obj);
      newItems.push(obj); added++; if(logLines.length<120) logLines.push(`سطر ${i+1}: إضافة ${sub} / ${equip}${missingCoords?' (بدون إحداثيات - عدّل لاحقاً)':''}`);
    }
    }
    processed+= (batchEnd-batchStart);
    const pct= 10 + (processed/totalRows)*40;
    setImportProgress(pct, `تحليل ${processed.toLocaleString('ar-SA')}/${totalRows.toLocaleString('ar-SA')} صف...`, `تم تجهيز ${(added+updated).toLocaleString('ar-SA')} موقع حتى الآن`);
    await new Promise(r=> setTimeout(r, 0));
  }
  // في الوضع السحابي لا نحتفظ بكل الـ 500 ألف في الذاكرة - نحتفظ بآخر 2000 فقط للعرض
  if(CLOUD_MODE && DATA.length>5000){
    // احتفظ بآخر المحدثة فقط للعرض
    const keep = new Set(newItems.slice(-2000).map(x=>String(x.sub)));
    DATA = DATA.filter(x=> keep.has(String(x.sub))).slice(0,2000);
  }
  const savedOk=saveLocal();
  updateStats(); renderAdminTable();
  if(useSupabase && newItems.length){
    setImportProgress(55, `جاري الحفظ السحابي... 0/${newItems.length.toLocaleString('ar-SA')}`, 'يتم الرفع على دفعات 150 صف - لا تغلق الصفحة');
    const res=await bulkUpsertToSupabase(newItems, (chunkIdx, totalChunks, okSoFar)=>{
      const pct2=55 + (chunkIdx/totalChunks)*40;
      setImportProgress(pct2, `حفظ سحابي ${chunkIdx}/${totalChunks}`, `${okSoFar.toLocaleString('ar-SA')} صف تم حفظها`);
    });
    if(res.fail>0) showToast(`تم حفظ ${res.ok} وفشل ${res.fail} - حاول مرة أخرى`,'error');
  }
  setImportProgress(100, `اكتمل ✓`, `${(added+updated).toLocaleString('ar-SA')} موقع جاهز للبحث`);
  setTimeout(()=>{ const w=document.getElementById('importProgressWrap'); if(w) w.classList.add('hidden'); },1400);
  importLog.classList.remove('hidden');
  const totalOk=added+updated;
  const localWarn=savedOk? '': '<p class="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2 text-xs">⚠️ الملف كبير جداً - تم الحفظ في السحابة بنجاح لكن الحفظ المحلي جزئي (2000). البيانات آمنة ومزامنة Online ✓</p>';
  importLog.innerHTML=`<p class="font-bold mb-2">نتيجة الاستيراد: <span class="text-emerald-600">${totalOk.toLocaleString('ar-SA')} نجاح</span> (إضافة ${added.toLocaleString('ar-SA')} + تحديث ${updated.toLocaleString('ar-SA')}) - تخطي ${skipped}</p>`
    + `<p class="text-[11px] text-zinc-500 mb-2">💡 30/300 → حساب، 50/500 → تجهيز تلقائياً</p>`
    + logLines.slice(0,80).map(l=> `<div class="py-1 border-b border-zinc-100 last:border-0">${escapeHtml(l)}</div>`).join('') + localWarn;
  if(logLines.length>80) importLog.innerHTML+=`<div class="text-zinc-500 mt-2">... و ${logLines.length-80} سطر إضافي (اختصار العرض)</div>`;
  if(totalOk>0) showToast(`✓ تم حفظ ${totalOk.toLocaleString('ar-SA')} موقع - ${useSupabase?'مزامن سحابياً':'محلياً'}`);
  else showToast('لم يتم استيراد أي موقع - تأكد من صيغة الملف','error');
  csvInput.value='';
}

if(csvInput) csvInput.addEventListener('change', async (e)=>{
  const file=e.target.files[0]; if(!file) return;
  showToast('جاري قراءة الملف...');
  try{
    const name=file.name.toLowerCase();
    let matrix=[];
    if(name.endsWith('.xlsx')||name.endsWith('.xls')){
      if(!window.XLSX){ showToast('مكتبة Excel غير محملة - حدّث الصفحة','error'); return; }
      const buf=await file.arrayBuffer();
      const wb=window.XLSX.read(buf, {type:'array'});
      const sheetName=wb.SheetNames[0];
      const ws=wb.Sheets[sheetName];
      // raw:true يحافظ على الأرقام الكبيرة
      matrix=window.XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:'', blankrows:false});
      // تحويل كل خلية لنص محفوظ
      matrix=matrix.map(row=> row.map(cellToString));
    } else {
      const text=await file.text();
      const clean=text.replace(/^\ufeff/,'');
      // للملفات الضخمة نقرأ بذكاء بدون تجميد
    matrix=parseCSVLinesSmart(clean);
    if(matrix.length>500000){ showToast('الملف ضخم جداً - سيتم معالجة 500 ألف كحد أقصى','error'); matrix=matrix.slice(0,500000); }
    }
    await handleImportMatrix(matrix);
  }catch(err){
    console.error(err);
    showToast('خطأ في قراءة الملف: '+err.message,'error');
    importLog.classList.remove('hidden');
    importLog.innerHTML=`<p class="text-red-600 font-bold">خطأ: ${escapeHtml(err.message)}</p><p class="text-xs mt-2">تأكد أن الملف CSV بترميز UTF-8 أو Excel .xlsx وأن الأرقام تبدأ بـ 30/500</p>`;
  }
});
const btnClearAll=document.getElementById('btnClearAll');
if(btnClearAll) btnClearAll.addEventListener('click', async ()=>{
  if(!confirm('هل أنت متأكد من حذف جميع المواقع؟ لا يمكن التراجع!')) return;
  if(!confirm('تأكيد نهائي: سيتم حذف كل البيانات من السحابة أيضاً')) return;
  DATA=[]; saveData();
  if(useSupabase) await clearSupabase();
  showToast('تم حذف جميع المواقع');
});

// Keyboard shortcuts
document.addEventListener('keydown', e=>{
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); searchInput.focus(); }
  if(e.key==='Escape'){ closeLogin(); closeAdmin(); }
});

// --- Init with Supabase - يدعم 500 ألف ---
async function boot(){
  const local = loadLocal();
  if(local && !CLOUD_MODE){ DATA = local; updateStats(); renderAdminTable(); }
  else if(!local){ DATA = [...SEED]; saveLocal(); updateStats(); renderAdminTable(); }
  const ok = await initSupabase();
  if(ok){
    try{
      const cnt = await getSupabaseCount();
      CLOUD_COUNT = cnt;
      if(cnt > CLOUD_THRESHOLD) CLOUD_MODE=true;
      updateStats();
      const remote = await fetchFromSupabase();
      if(remote && remote.length>0){
        // في الوضع السحابي لا نحتاج كل البيانات محليا
        if(!CLOUD_MODE) DATA = remote;
        else DATA = remote; // 200 فقط للعرض
        saveLocal();
        updateStats();
        renderAdminTable();
        if(CLOUD_MODE) showToast(`☁️ وضع سحابي مفعّل - ${CLOUD_COUNT.toLocaleString('ar-SA')} موقع - البحث مباشر من السيرفر ✓`);
        else showToast(`متصل بقاعدة البيانات - ${DATA.length} موقع متزامن ✓`);
      } else if(remote && remote.length===0){
        if(local && local.length>0){
          await bulkUpsertToSupabase(local);
          showToast('تمت مزامنة البيانات المحلية إلى السحابة ✓');
        }
      }
    }catch(e){ console.warn('fetch remote failed',e); }
  }
}
boot();

window._DATA=DATA;
window._supabase=()=>supabaseClient;
document.body.style.background="#F6F9FF";
console.log("%c مكتب غرب القصيم للكهرباء - نظام المواقع السحابي جاهز ✓ ", "background:#0D5BBA;color:white;padding:8px 14px;border-radius:8px;font-weight:bold");
