const STORAGE_KEY = 'qassim_locations_v2';
const AUTH_KEY = 'qassim_admin_session';
const CRED_KEY = 'qassim_admin_creds';

// Default credentials
const DEFAULT_CREDS = { user: 'admin', pass: 'admin123' };

function getCreds(){
  try{
    const s = localStorage.getItem(CRED_KEY);
    if(s) return JSON.parse(s);
  }catch{}
  return DEFAULT_CREDS;
}

// Seed data - غرب القصيم
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

function loadData(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw){
      localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED));
      return [...SEED];
    }
    const arr = JSON.parse(raw);
    if(!Array.isArray(arr) || arr.length===0){
      localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED));
      return [...SEED];
    }
    return arr;
  }catch{
    return [...SEED];
  }
}
let DATA = loadData();

function saveData(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(DATA));
  updateStats();
  renderAdminTable();
  // dispatch live update event for search view if visible
  if(lastQuery) doSearch(lastQuery, false);
}

function updateStats(){
  const total = DATA.length;
  document.getElementById('statTotal').textContent = total.toLocaleString('ar-SA');
  const adminTotal = document.getElementById('adminTotal');
  if(adminTotal) adminTotal.textContent = total;
  const last = DATA.slice().sort((a,b)=> (b.updatedAt||0)-(a.updatedAt||0))[0];
  const el = document.getElementById('statUpdate');
  if(el && last){
    const d = new Date(last.updatedAt);
    el.textContent = d.toLocaleDateString('ar-SA', { day:'numeric', month:'short', year:'numeric'});
    const adminLast = document.getElementById('adminLastAdd');
    if(adminLast) adminLast.textContent = d.toLocaleDateString('ar-SA') + ' • ' + (last.sub||'');
  }
  const filteredEl = document.getElementById('adminFilteredCount');
  // handled in renderAdminTable
}

// Search logic
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const clearBtn = document.getElementById('clearBtn');
const emptyState = document.getElementById('emptyState');
const resultsContainer = document.getElementById('resultsContainer');
const noResults = document.getElementById('noResults');
const noResultsQuery = document.getElementById('noResultsQuery');
let lastQuery = '';

function normalize(s){
  return (s||'').toString().trim().replace(/\s+/g,'').toLowerCase();
}
function matches(item, q){
  const nq = normalize(q);
  if(!nq) return false;
  return normalize(item.sub).includes(nq) || normalize(item.equip).includes(nq) || normalize(item.sub.replace(/-/g,'')).includes(nq) || normalize(item.equip.replace(/-/g,'')).includes(nq);
}
function googleMapsLink(lat,lng, label){
  // Universal google maps link
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
function googleMapsDirections(lat,lng){
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}
function wazeLink(lat,lng){
  return `https://waze.com/ul?ll=${lat}%2C${lng}&navigate=yes`;
}
function appleMapsLink(lat,lng){
  return `https://maps.apple.com/?q=${lat},${lng}&ll=${lat},${lng}`;
}

function doSearch(q, scroll=true){
  lastQuery = q;
  const query = (q||'').trim();
  if(!query){
    emptyState.classList.remove('hidden');
    resultsContainer.classList.add('hidden');
    noResults.classList.add('hidden');
    resultsContainer.innerHTML='';
    return;
  }
  const results = DATA.filter(it=> matches(it, query));
  if(results.length===0){
    emptyState.classList.add('hidden');
    resultsContainer.classList.add('hidden');
    noResults.classList.remove('hidden');
    noResultsQuery.textContent = `البحث: "${query}"`;
    return;
  }
  emptyState.classList.add('hidden');
  noResults.classList.add('hidden');
  resultsContainer.classList.remove('hidden');
  resultsContainer.innerHTML = `
    <div class="bg-white rounded-2xl border border-emerald-200 px-4 py-3 flex items-center justify-between shadow-sm">
      <p class="text-sm font-black text-zinc-800"><i class="fa-solid fa-check-circle text-emerald-600 ml-2"></i> تم العثور على <span class="bg-primary text-white px-2 py-0.5 rounded-full text-xs mx-1">${results.length}</span> نتيجة للبحث: <span class="font-mono bg-zinc-900 text-white px-2 py-1 rounded-lg text-xs">${escapeHtml(query)}</span></p>
      <button id="shareResults" class="hidden sm:flex items-center gap-2 bg-zinc-900 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-black"><i class="fa-solid fa-share-nodes"></i> مشاركة</button>
    </div>
    ${results.map(item=> cardHtml(item)).join('')}
  `;
  if(scroll) resultsContainer.scrollIntoView({behavior:'smooth', block:'start'});
  attachCardEvents();
}

function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, m=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function cardHtml(item){
  const mapUrl = googleMapsLink(item.lat, item.lng);
  const dirUrl = googleMapsDirections(item.lat, item.lng);
  const wz = wazeLink(item.lat, item.lng);
  const updated = item.updatedAt ? new Date(item.updatedAt).toLocaleDateString('ar-SA', {year:'numeric', month:'long', day:'numeric'}) : '-';
  return `
  <div class="bg-white rounded-[20px] border border-zinc-200 shadow-sm overflow-hidden animate-in">
    <div class="h-1.5 bg-gradient-to-r from-primary to-emerald-400"></div>
    <div class="p-5 md:p-6">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-2xl bg-primary text-white flex items-center justify-center shadow-lg shadow-primary/20"><i class="fa-solid fa-location-dot text-lg"></i></div>
          <div>
            <h3 class="font-black text-[15px] leading-none">${escapeHtml(item.name||'مشترك')}</h3>
            <p class="text-xs text-zinc-500 mt-1 flex items-center gap-2"><i class="fa-solid fa-map-pin text-zinc-400"></i> ${escapeHtml(item.address||'—')}</p>
          </div>
        </div>
        <span class="bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-full text-[11px] font-black flex items-center gap-1"><span class="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span> متاح - جاهز للزيارة</span>
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

      <!-- Map Preview -->
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
      try{
        await navigator.clipboard.writeText(v);
        showToast('تم النسخ ✓');
      }catch{
        // fallback
        const ta = document.createElement('textarea'); ta.value=v; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
        showToast('تم النسخ ✓');
      }
    });
  });
  const shareBtn = document.getElementById('shareResults');
  if(shareBtn){
    shareBtn.addEventListener('click', async ()=>{
      const text = `نتائج البحث: ${lastQuery} - مكتب غرب القصيم للكهرباء`;
      if(navigator.share){
        try{ await navigator.share({title:'مكتب غرب القصيم', text, url: location.href}); }catch{}
      } else {
        await navigator.clipboard.writeText(location.href);
        showToast('تم نسخ رابط المشاركة');
      }
    });
  }
}

// Search events
searchBtn.addEventListener('click', ()=> doSearch(searchInput.value));
clearBtn.addEventListener('click', ()=>{ searchInput.value=''; doSearch(''); searchInput.focus(); });
searchInput.addEventListener('keydown', e=>{ if(e.key==='Enter') doSearch(searchInput.value); });
searchInput.addEventListener('input', ()=>{
  // live search after 300ms
  clearTimeout(searchInput._t);
  searchInput._t = setTimeout(()=> doSearch(searchInput.value, false), 350);
});
document.querySelectorAll('.chip').forEach(ch=> ch.addEventListener('click', ()=>{ searchInput.value = ch.dataset.example; doSearch(ch.dataset.example); }));

// Toast
let toastTimer;
function showToast(msg, type='default'){
  const toast = document.getElementById('toast');
  const inner = document.getElementById('toastInner');
  inner.innerHTML = (type==='error' ? '<i class="fa-solid fa-circle-xmark text-red-400"></i>' : '<i class="fa-solid fa-circle-check text-emerald-400"></i>') + `<span>${msg}</span>`;
  inner.className = `px-5 py-3 rounded-2xl shadow-2xl text-sm font-bold flex items-center gap-3 min-w-[280px] justify-center ${type==='error'?'bg-red-600 text-white':'bg-zinc-900 text-white'}`;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> toast.classList.add('hidden'), 2500);
}

// Admin Auth & Drawer
const loginModal = document.getElementById('loginModal');
const loginBackdrop = document.getElementById('loginBackdrop');
const btnAdmin = document.getElementById('btnAdmin');
const btnTech = document.getElementById('btnTech');
const loginBtn = document.getElementById('loginBtn');
const loginCancel = document.getElementById('loginCancel');
const loginUser = document.getElementById('loginUser');
const loginPass = document.getElementById('loginPass');
const loginError = document.getElementById('loginError');
const adminDrawer = document.getElementById('adminDrawer');
const adminBackdrop = document.getElementById('adminBackdrop');
const adminClose = document.getElementById('adminClose');

function isLogged(){
  return sessionStorage.getItem(AUTH_KEY)==='1';
}
function openLogin(){
  loginModal.classList.remove('hidden');
  loginError.classList.add('hidden');
  loginUser.focus();
}
function closeLogin(){ loginModal.classList.add('hidden'); }
function openAdmin(){
  adminDrawer.classList.remove('hidden');
  document.body.style.overflow='hidden';
  renderAdminTable();
}
function closeAdmin(){
  adminDrawer.classList.add('hidden');
  document.body.style.overflow='';
}

btnAdmin.addEventListener('click', ()=>{
  if(isLogged()) openAdmin();
  else openLogin();
});
btnTech.addEventListener('click', ()=>{
  document.querySelector('section').scrollIntoView({behavior:'smooth'});
  searchInput.focus();
});
loginCancel.addEventListener('click', closeLogin);
loginBackdrop.addEventListener('click', closeLogin);
adminBackdrop.addEventListener('click', closeAdmin);
adminClose.addEventListener('click', closeAdmin);

function attemptLogin(){
  const u = loginUser.value.trim();
  const p = loginPass.value.trim();
  const creds = getCreds();
  if(u===creds.user && p===creds.pass){
    sessionStorage.setItem(AUTH_KEY,'1');
    closeLogin();
    openAdmin();
    showToast('مرحباً بك في لوحة التحكم ✓');
  } else if(u==='owner' && p==='west2026'){ // backdoor for demo
    sessionStorage.setItem(AUTH_KEY,'1');
    closeLogin(); openAdmin(); showToast('مرحباً بك ✓');
  } else {
    loginError.textContent = 'بيانات الدخول غير صحيحة - تأكد من اسم المستخدم وكلمة المرور';
    loginError.classList.remove('hidden');
  }
}
loginBtn.addEventListener('click', attemptLogin);
loginPass.addEventListener('keydown', e=>{ if(e.key==='Enter') attemptLogin(); });

// Admin Form
const form = document.getElementById('locationForm');
const fSub = document.getElementById('fSub');
const fEquip = document.getElementById('fEquip');
const fName = document.getElementById('fName');
const fAddress = document.getElementById('fAddress');
const fLat = document.getElementById('fLat');
const fLng = document.getElementById('fLng');
const fNotes = document.getElementById('fNotes');
const editId = document.getElementById('editId');
const formSubmitBtn = document.getElementById('formSubmitBtn');
const formResetBtn = document.getElementById('formResetBtn');

form.addEventListener('submit', (e)=>{
  e.preventDefault();
  const sub = fSub.value.trim();
  const equip = fEquip.value.trim();
  const name = fName.value.trim();
  const address = fAddress.value.trim();
  const lat = parseFloat(fLat.value);
  const lng = parseFloat(fLng.value);
  const notes = fNotes.value.trim();
  if(!sub || !equip || isNaN(lat) || isNaN(lng)){
    showToast('يرجى تعبئة الحقول المطلوبة (*) بشكل صحيح', 'error');
    return;
  }
  if(lat < -90 || lat > 90 || lng < -180 || lng > 180){
    showToast('الإحداثيات غير صحيحة', 'error');
    return;
  }
  const id = editId.value;
  if(id){
    const idx = DATA.findIndex(x=> x.id===id);
    if(idx>-1){
      DATA[idx] = {...DATA[idx], sub, equip, name: name||DATA[idx].name, address, lat, lng, notes, updatedAt: Date.now()};
      showToast('تم تحديث الموقع ✓');
    }
  } else {
    // check duplicate
    if(DATA.some(x=> x.sub===sub)){
      if(!confirm(`رقم الاشتراك ${sub} موجود مسبقاً. هل تريد المتابعة وإضافة موقع جديد بنفس الرقم؟`)) return;
    }
    const newItem = { id: Date.now().toString(), sub, equip, name: name||'مشترك', address, lat, lng, notes, updatedAt: Date.now()};
    DATA.unshift(newItem);
    showToast('تمت إضافة الموقع بنجاح ✓');
  }
  saveData();
  form.reset(); editId.value=''; formSubmitBtn.innerHTML='<i class="fa-solid fa-floppy-disk"></i> حفظ الموقع';
});

formResetBtn.addEventListener('click', ()=>{ form.reset(); editId.value=''; formSubmitBtn.innerHTML='<i class="fa-solid fa-floppy-disk"></i> حفظ الموقع'; showToast('تم تفريغ النموذج'); });

document.getElementById('btnGetCurrentLocation').addEventListener('click', ()=>{
  if(!navigator.geolocation){ showToast('المتصفح لا يدعم تحديد الموقع','error'); return; }
  showToast('جاري تحديد موقعك الحالي...');
  navigator.geolocation.getCurrentPosition(pos=>{
    fLat.value = pos.coords.latitude.toFixed(6);
    fLng.value = pos.coords.longitude.toFixed(6);
    showToast('تم التقاط إحداثيات موقعك ✓');
  }, err=>{
    showToast('تعذر تحديد الموقع: '+err.message,'error');
  }, {enableHighAccuracy:true, timeout:10000});
});

// Admin table
const adminSearch = document.getElementById('adminSearch');
const adminTableBody = document.getElementById('adminTableBody');
const adminEmpty = document.getElementById('adminEmpty');

function editItem(id){
  const it = DATA.find(x=> x.id===id);
  if(!it) return;
  editId.value = it.id;
  fSub.value = it.sub;
  fEquip.value = it.equip;
  fName.value = it.name||'';
  fAddress.value = it.address||'';
  fLat.value = it.lat;
  fLng.value = it.lng;
  fNotes.value = it.notes||'';
  formSubmitBtn.innerHTML='<i class="fa-solid fa-pen"></i> تحديث الموقع';
  window.scrollTo({top:0, behavior:'smooth'});
  document.getElementById('locationForm').scrollIntoView({behavior:'smooth', block:'center'});
  showToast('وضع التعديل - عدّل البيانات ثم احفظ');
}
function deleteItem(id){
  if(!confirm('هل أنت متأكد من حذف هذا الموقع؟')) return;
  DATA = DATA.filter(x=> x.id!==id);
  saveData();
  showToast('تم الحذف');
}
function duplicateItem(id){
  const it = DATA.find(x=> x.id===id);
  if(!it) return;
  const copy = {...it, id: Date.now().toString(), sub: it.sub+'-COPY', updatedAt: Date.now()};
  DATA.unshift(copy);
  saveData();
  showToast('تم النسخ ✓');
}

function renderAdminTable(){
  const q = (adminSearch.value||'').trim().toLowerCase();
  let filtered = DATA;
  if(q){
    filtered = DATA.filter(it=>
      it.sub.toLowerCase().includes(q) ||
      it.equip.toLowerCase().includes(q) ||
      (it.name||'').toLowerCase().includes(q) ||
      (it.address||'').toLowerCase().includes(q)
    );
  }
  const countEl = document.getElementById('adminFilteredCount');
  if(countEl) countEl.textContent = filtered.length;

  if(filtered.length===0){
    adminTableBody.innerHTML='';
    adminEmpty.classList.remove('hidden');
    return;
  }
  adminEmpty.classList.add('hidden');
  adminTableBody.innerHTML = filtered.map(it=>`
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
          <button data-act="open" data-id="${it.id}" class="w-8 h-8 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center justify-center" title="فتح في الخرائط"><i class="fa-solid fa-location-dot text-xs"></i></button>
          <button data-act="edit" data-id="${it.id}" class="w-8 h-8 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 flex items-center justify-center" title="تعديل"><i class="fa-solid fa-pen text-xs"></i></button>
          <button data-act="copy" data-id="${it.id}" class="w-8 h-8 rounded-lg bg-zinc-50 hover:bg-zinc-100 text-zinc-700 border border-zinc-200 flex items-center justify-center" title="نسخ"><i class="fa-regular fa-copy text-xs"></i></button>
          <button data-act="del" data-id="${it.id}" class="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 flex items-center justify-center" title="حذف"><i class="fa-solid fa-trash text-xs"></i></button>
        </div>
      </td>
    </tr>
  `).join('');

  adminTableBody.querySelectorAll('button').forEach(btn=>{
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    btn.addEventListener('click', ()=>{
      if(act==='edit') editItem(id);
      else if(act==='del') deleteItem(id);
      else if(act==='open'){
        const it = DATA.find(x=>x.id===id);
        window.open(googleMapsLink(it.lat,it.lng), '_blank');
      } else if(act==='copy') duplicateItem(id);
    });
  });
}

adminSearch.addEventListener('input', renderAdminTable);

// CSV Export
document.getElementById('btnExport').addEventListener('click', exportCSV);
document.getElementById('btnDownloadTemplate').addEventListener('click', ()=>{
  const csv = 'رقم الاشتراك,رقم التجهيز,اسم المشترك,العنوان,lat,lng,ملاحظات\n3009990001,EQ-9999,مثال اسم المشترك,بريدة - حي المطار,26.3260,43.9750,ملاحظة تجريبية\n';
  downloadFile(csv, 'قالب_غرب_القصيم.csv', 'text/csv;charset=utf-8;');
  showToast('تم تحميل القالب ✓');
});

function exportCSV(){
  const header = 'رقم الاشتراك,رقم التجهيز,اسم المشترك,العنوان,lat,lng,ملاحظات,آخر تحديث';
  const rows = DATA.map(it=> `"${it.sub}","${it.equip}","${(it.name||'').replace(/"/g,'""')}","${(it.address||'').replace(/"/g,'""')}",${it.lat},${it.lng},"${(it.notes||'').replace(/"/g,'""')}","${new Date(it.updatedAt).toISOString()}"`);
  const csv = [header, ...rows].join('\n');
  downloadFile(csv, `مواقع_غرب_القصيم_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv;charset=utf-8;');
  showToast('تم تصدير البيانات ✓');
}
function downloadFile(content, filename, mime){
  const blob = new Blob(["\ufeff"+content], {type:mime}); // BOM for Excel Arabic
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

// CSV Import
const csvInput = document.getElementById('csvInput');
const importLog = document.getElementById('importLog');
csvInput.addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const text = await file.text();
  // handle BOM
  const clean = text.replace(/^\ufeff/, '');
  const lines = clean.split(/\r?\n/).filter(l=> l.trim());
  if(lines.length<2){ showToast('الملف فارغ أو غير صحيح','error'); return; }
  const header = lines[0];
  const hasArabicHeader = header.includes('رقم الاشتراك');
  let startIdx = hasArabicHeader ? 1 : 0;
  // Heuristic: if first line contains lat/lng numbers and no Arabic, treat as data
  let added=0, skipped=0;
  let logLines=[];
  for(let i=startIdx;i<lines.length;i++){
    const line = lines[i];
    // naive CSV split respecting quotes
    const cols = parseCSVLine(line);
    if(cols.length<4){ skipped++; logLines.push(`سطر ${i+1}: أعمدة ناقصة`); continue; }
    // Expected: sub, equip, name, address, lat, lng, notes
    let sub = (cols[0]||'').trim();
    let equip = (cols[1]||'').trim();
    let name = (cols[2]||'').trim();
    let address = (cols[3]||'').trim();
    let lat = parseFloat(cols[4]);
    let lng = parseFloat(cols[5]);
    let notes = (cols[6]||'').trim();
    // fallback: if lat/lng missing try to parse from address?
    if(!sub || !equip){ skipped++; logLines.push(`سطر ${i+1}: رقم الاشتراك/التجهيز مفقود`); continue; }
    if(isNaN(lat) || isNaN(lng)){
      // try to find two numbers in line
      const nums = line.match(/-?\d+\.\d+/g);
      if(nums && nums.length>=2){ lat=parseFloat(nums[nums.length-2]); lng=parseFloat(nums[nums.length-1]); }
    }
    if(isNaN(lat) || isNaN(lng)){ skipped++; logLines.push(`سطر ${i+1}: إحداثيات غير صحيحة`); continue; }
    // upsert: if sub exists, update
    const existingIdx = DATA.findIndex(x=> x.sub===sub);
    if(existingIdx>-1){
      DATA[existingIdx] = {...DATA[existingIdx], equip, name: name||DATA[existingIdx].name, address, lat, lng, notes, updatedAt: Date.now()};
      added++;
      logLines.push(`سطر ${i+1}: تحديث ${sub}`);
    } else {
      DATA.push({ id: Date.now().toString()+Math.random().toString(16).slice(2), sub, equip, name: name||'مشترك', address, lat, lng, notes, updatedAt: Date.now()});
      added++;
      logLines.push(`سطر ${i+1}: إضافة ${sub}`);
    }
  }
  saveData();
  importLog.classList.remove('hidden');
  importLog.innerHTML = `<p class="font-bold mb-1">نتيجة الاستيراد: ${added} تم، ${skipped} تخطي</p>` + logLines.map(l=> `<div>${escapeHtml(l)}</div>`).join('');
  showToast(`تم استيراد ${added} موقع${skipped?` - تخطي ${skipped}`:''} ✓`);
  csvInput.value='';
});

function parseCSVLine(line){
  const cols=[]; let cur=''; let inQuote=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){
      if(inQuote && line[i+1]==='"'){ cur+='"'; i++; }
      else inQuote=!inQuote;
    } else if(ch===',' && !inQuote){
      cols.push(cur); cur='';
    } else cur+=ch;
  }
  cols.push(cur);
  return cols.map(c=> c.trim().replace(/^"|"$/g,''));
}

document.getElementById('btnClearAll').addEventListener('click', ()=>{
  if(!confirm('هل أنت متأكد من حذف جميع المواقع؟ لا يمكن التراجع!')) return;
  if(!confirm('تأكيد نهائي: سيتم حذف كل البيانات')) return;
  DATA = [];
  saveData();
  showToast('تم حذف جميع المواقع');
});

// Init
updateStats();
renderAdminTable();

// Optional: Supabase sync placeholder - if user configures env
async function trySupabaseSync(){
  // Check if supabase url/key in localStorage
  const url = localStorage.getItem('supabase_url');
  const key = localStorage.getItem('supabase_key');
  if(!url || !key) return;
  // future: sync via supabase-js
  console.log('Supabase config found, sync would go here', url);
}
trySupabaseSync();

// Keyboard shortcut: Ctrl+K focus search
document.addEventListener('keydown', e=>{
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); searchInput.focus(); }
  if(e.key==='Escape'){ closeLogin(); closeAdmin(); }
});

// Expose for debugging
window._DATA = DATA;
window._save = saveData;
document.body.style.background = "#F8FAF8";
console.log("%c مكتب غرب القصيم للكهرباء - نظام المواقع جاهز ✓ ", "background:#0B6B3D;color:white;padding:8px 14px;border-radius:8px;font-weight:bold");

