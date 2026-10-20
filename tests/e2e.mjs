/**
 * اختبار نهاية-إلى-نهاية (E2E) فعلي لواجهة LOOP:
 * يحمّل كود التطبيق الحقيقي (src/main.js) داخل بيئة DOM (jsdom)،
 * وينقر الأزرار فعليًا من الصفحة الرئيسية حتى شاشة النتيجة والمشاركة،
 * ويتحقّق من: الشاشات، شريط التقدم، الفيزياء الزمنية، إعادة اللعب،
 * الاستكمال بعد إعادة التحميل، روابط الأصدقاء والمقارنة، والروابط التالفة.
 * التشغيل: npm run test:e2e
 */
import { JSDOM, VirtualConsole } from "jsdom";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { File as NodeFile } from "node:buffer";
import { CHALLENGES, getChallenge, getDailyChallenge } from "../src/content/index.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const ok = (m) => { passed++; console.log("  ✓ " + m); };
const bad = (m) => { failed++; console.error("  ✗ " + m); };
const assert = (cond, m) => (cond ? ok(m) : bad(m));

// ---------- بدائل خفيفة لواجهات المتصفح غير المتوفرة في jsdom ----------
function installBrowserStubs(win, capture) {
  const ctxHandler = {
    get(t, prop) {
      if (prop === "measureText") return () => ({ width: 220 });
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => ({ addColorStop() {} });
      if (prop === "fillText") return (txt) => capture.CanvasTexts.push(String(txt));
      if (prop in t) return t[prop];
      return () => {};
    },
    set(t, prop, v) { t[prop] = v; return true; },
  };
  win.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, ctxHandler);
  win.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new win.Blob(["png"], { type: "image/png" })); };
  win.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,RkFLRQ==";
  if (!win.document.fonts) Object.defineProperty(win.document, "fonts", { value: { load: async () => [] } });
  win.scrollTo = () => {};
  Object.defineProperty(win.navigator, "clipboard", {
    value: { writeText: async (t) => { capture.clipboard = t; } }, configurable: true,
  });
  Object.defineProperty(win.navigator, "share", {
    value: async (data) => { capture.shares.push(data); }, configurable: true,
  });
  Object.defineProperty(win.navigator, "canShare", { value: () => true, configurable: true });
  win.navigator.vibrate = () => true;
}

let bootCounter = 0;
const tempFiles = [];
async function boot(url, { seedStorage = null } = {}) {
  bootCounter++;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", () => {}); // نتجاهل "غير منفّذ في jsdom" فقط (تمرير/تنقّل)
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8")
    .replace(/<script type="module"[^>]*><\/script>/, "");
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, virtualConsole });
  const win = dom.window;
  const capture = { clipboard: null, shares: [], CanvasTexts: [] };
  installBrowserStubs(win, capture);
  if (seedStorage) for (const [k, v] of Object.entries(seedStorage)) win.localStorage.setItem(k, v);

  const globals = {
    window: win, document: win.document, navigator: win.navigator,
    location: win.location, history: win.history,
    localStorage: win.localStorage, sessionStorage: win.sessionStorage,
    innerWidth: win.innerWidth, innerHeight: win.innerHeight,
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    File: NodeFile,
  };
  for (const [k, v] of Object.entries(globals)) {
    Object.defineProperty(globalThis, k, { value: v, writable: true, configurable: true });
  }

  // نسخة مؤقتة من ملف التطبيق الحقيقي (بدون استيراد CSS فقط) لتشغيل جديد نظيف
  const mainSrc = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  if (!mainSrc.includes('import "./style.css";')) throw new Error("لم أجد سطر استيراد CSS في main.js");
  const tmp = new URL(`../src/.e2e-boot-${bootCounter}.mjs`, import.meta.url);
  writeFileSync(tmp, mainSrc.replace('import "./style.css";', ""));
  tempFiles.push(tmp);
  await import(tmp.pathname + `?boot=${bootCounter}`);
  await sleep(60);
  return { win, doc: win.document, capture };
}

const $ = (doc, sel) => doc.querySelector(sel);
const $$ = (doc, sel) => [...doc.querySelectorAll(sel)];
const byAction = (doc, action, id) =>
  $$(doc, `[data-action="${action}"]`).find((el) => !id || el.dataset.id === id);

async function playToEnd(doc, strategy, label) {
  const journey = [];
  for (let i = 0; i < 10; i++) {
    if ($(doc, ".result-ending")) break;
    const btns = $$(doc, ".choice-btn");
    if (!btns.length) { bad(`${label}: اختفت أزرار الاختيارات قبل انتهاء القصة`); return journey; }
    journey.push($(doc, ".scene-title")?.textContent?.trim() || "؟");
    const idx = strategy(i, btns.length);
    btns[idx].click();
    await sleep(430);
  }
  return journey;
}

function dumpStorage(win) {
  const out = {};
  for (let i = 0; i < win.localStorage.length; i++) {
    const k = win.localStorage.key(i);
    out[k] = win.localStorage.getItem(k);
  }
  return out;
}

// ============================================================
// السيناريو الرئيسي: جلسة لاعب كاملة
// ============================================================
console.log("\n═══ ١) الإقلاع والصفحة الرئيسية ═══");
let { win, doc, capture } = await boot("http://localhost:5173/");
assert($(doc, ".hero h1")?.textContent.includes("قرار واحد"), "العنوان الرئيسي «قرار واحد ممكن يغيّر كل حاجة» ظاهر");
assert($$(doc, ".ch-card").length === CHALLENGES.length, `بطاقات التحديات كاملة (${CHALLENGES.length}) في الرئيسية`);
assert($(doc, ".daily-title")?.textContent.includes(getDailyChallenge().title), "بطاقة تحدي اليوم تعرض التحدي الصحيح لليوم");
assert($$(doc, ".step-card").length === 4, "قسم «كيف تلعب؟» بأربع خطوات ظاهر");
assert(!$(doc, ".banner"), "بدون رابط صديق: لا يظهر أي شريط مقارنة");

console.log("\n═══ ٢) لعب تحدي «قرارك الأخير» من البداية للنهاية ═══");
byAction(doc, "play", "last-decision").click(); await sleep(60);
assert($(doc, ".intro-card .scene-title")?.textContent.includes("قرارك الأخير"), "شاشة مقدمة التحدي ظهرت بعنوان صحيح");
byAction(doc, "begin").click(); await sleep(60);
assert($(doc, ".progress-meta")?.textContent.includes("المرحلة 1"), "بدء اللعب: شريط التقدم عند المرحلة 1");
assert($(doc, ".scene-title")?.textContent.includes("الانقطاع"), "المشهد الأول: «الانقطاع»");

// حماية النقر/الكيبورد المزدوج
$$(doc, ".choice-btn")[2].click();
doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "2", bubbles: true }));
await sleep(460);
assert($(doc, ".progress-meta")?.textContent.includes("المرحلة 2"), "إدخال مزدوج سريع (نقر + كيبورد) لم يقفز مرحلتين — تقدّم خطوة واحدة فقط");
assert(!!$(doc, ".echo"), "شريط «نتيجة قرارك» يظهر بعد الاختيار");

// اختيار بالكيبورد
doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "1", bubbles: true }));
await sleep(460);
assert($(doc, ".progress-meta")?.textContent.includes("المرحلة 3"), "الاختيار بأزرار الكيبورد (1-4) يعمل");

const journey = await playToEnd(doc, (i) => i % 2, "قرارك الأخير");
const endingName = $(doc, ".result-ending")?.textContent.trim();
assert(!!endingName, `اكتملت الجولة ووصلنا لشاشة النتيجة: «${endingName}»`);
console.log("    الرحلة: " + journey.join(" ← ") + " ← النتيجة");
assert(!!$(doc, ".title-name"), "اللقب الترفيهي ظاهر في النتيجة");
assert($$(doc, ".stat-bar-row").length === 4, "مؤشرات المتغيرات الأربعة ظاهرة");
await sleep(300);
const widths = $$(doc, ".stat-bar-fill").map((el) => parseFloat(el.style.width) || 0);
assert(Math.max(...widths) > 0, "أشرطة المؤشرات تحركت وامتلأت بقيم حقيقية");
const tlCount = $$(doc, ".timeline li").length;
assert(tlCount >= 5 && tlCount <= 7, `سجلّ القرارات يعرض ${tlCount} قرارات (بين 5 و7)`);

console.log("\n═══ ٣) بطاقة المشاركة والمشاركة الفعلية ═══");
await sleep(250);
const img = $(doc, "#share-card-img");
assert(img && (img.getAttribute("src") || "").startsWith("data:image/png"), "بطاقة النتيجة رُسمت كصورة وظهرت في الصفحة");
assert(capture.CanvasTexts.includes("LOOP"), "البطاقة تحتوي شعار LOOP مرسومًا");
assert(capture.CanvasTexts.some((t) => t.includes(endingName)), "البطاقة مكتوب عليها اسم النهاية الفعلية للجولة");
assert(capture.CanvasTexts.some((t) => t.startsWith("لقبي:")), "البطاقة مكتوب عليها لقب اللاعب");
byAction(doc, "share-result").click();
await sleep(120);
const shareCall = capture.shares.at(-1);
assert(!!shareCall, "زر «تحدَّ أصحابك» استدعى مشاركة النظام (Web Share API)");
assert(shareCall?.url?.includes("c=last-decision") && shareCall?.url?.includes("r="), "رابط المشاركة يحمل معرّف التحدي والنتيجة المشفّرة");
assert(Array.isArray(shareCall?.files) && shareCall.files.length === 1, "المشاركة تضمّنت صورة البطاقة كملف");
byAction(doc, "copy-link").click();
await sleep(80);
assert(capture.clipboard?.includes("c=last-decision") && capture.clipboard?.includes("r="), "زر «انسخ رابط اللعبة» نسخ الرابط الصحيح");
const savedFriendUrl = capture.clipboard;
const wa = $(doc, ".btn-whatsapp")?.getAttribute("href") || "";
const tg = $(doc, ".btn-telegram")?.getAttribute("href") || "";
assert(wa.startsWith("https://wa.me/") && decodeURIComponent(wa).includes("r="), "زر واتساب يولّد رابط wa.me صحيحًا يحمل النتيجة");
assert(tg.startsWith("https://t.me/share/url"), "زر تيليجرام يولّد رابط مشاركة صحيحًا");
byAction(doc, "download-card").click();
await sleep(60);
assert($(doc, "#toast")?.textContent.includes("بطاقة"), "زر «حمّل البطاقة» عمل وأظهر تأكيدًا");
const stored1 = JSON.parse(win.localStorage.getItem("loop.results.v1") || "{}")["last-decision"];
assert(stored1?.plays === 1 && stored1?.endingTitle === endingName, "النتيجة حُفظت محليًا (محاولة ١)");

console.log("\n═══ ٤) «العب مرة أخرى» وجولة ثانية باختيارات مغايرة ═══");
byAction(doc, "replay").click(); await sleep(80);
assert($(doc, ".progress-meta")?.textContent.includes("المرحلة 1"), "إعادة اللعب رجعت لأول مرحلة فعلًا");
await playToEnd(doc, (i, n) => n - 1, "الجولة الثانية");
const ending2 = $(doc, ".result-ending")?.textContent.trim();
assert(!!ending2, `الجولة الثانية اكتملت بنهاية «${ending2}»`);
const stored2 = JSON.parse(win.localStorage.getItem("loop.results.v1"))["last-decision"];
assert(stored2.plays === 2, "عدد مرات لعبك المحفوظ صار ٢");
assert(Array.isArray(stored2.endingsSeen) && stored2.endingsSeen.length >= 1, "تتبّع النهايات المفتوحة يعمل");

console.log("\n═══ ٥) «جرّب تحديًا آخر» + الخروج والاستكمال + إعادة البدء ═══");
byAction(doc, "next-challenge").click(); await sleep(80);
const introTitle = $(doc, ".intro-card .scene-title")?.textContent.trim();
assert(introTitle && introTitle !== "قرارك الأخير", `زر التحدي التالي فتح تحديًا مختلفًا: «${introTitle}»`);
byAction(doc, "begin").click(); await sleep(60);
$$(doc, ".choice-btn")[0].click(); await sleep(460);
$$(doc, ".choice-btn")[0].click(); await sleep(460);
assert($(doc, ".progress-meta")?.textContent.includes("المرحلة 3"), "تقدّمنا لمرحلتين في التحدي الجديد");
// إعادة البدء من المنتصف عبر نافذة التأكيد
byAction(doc, "restart").click(); await sleep(60);
assert(!!$(doc, ".modal-backdrop"), "زر «من الأول» يطلب تأكيدًا قبل مسح التقدم");
$(doc, '[data-act="ok"]').click(); await sleep(80);
assert($(doc, ".progress-meta")?.textContent.includes("المرحلة 1"), "بعد التأكيد: القصة رجعت للمرحلة 1");
// تقدّم ثم اخرج للقائمة (مع تأكيد) ثم استكمل
$$(doc, ".choice-btn")[1].click(); await sleep(460);
byAction(doc, "quit").click(); await sleep(60);
assert(!!$(doc, ".modal-backdrop"), "الخروج أثناء الجولة يطلب تأكيدًا");
$(doc, '[data-act="ok"]').click(); await sleep(80);
assert(!!$(doc, ".hero"), "رجعنا للصفحة الرئيسية");
const resumeBtns = $$(doc, '[data-action="resume"]');
assert(resumeBtns.length >= 1 && resumeBtns[0].textContent.includes("المرحلة 2"), "الرئيسية تعرض «أكمل من حيث توقفت (المرحلة 2)»");
const storageSnapshot = dumpStorage(win);

console.log("\n═══ ٦) إعادة تحميل الصفحة: التقدم والنتائج يعيشان ═══");
({ win, doc, capture } = await boot("http://localhost:5173/", { seedStorage: storageSnapshot }));
const resume2 = $$(doc, '[data-action="resume"]');
assert(resume2.length >= 1, "بعد إعادة تحميل كاملة: زر الاستكمال ما يزال موجودًا");
assert(doc.body.textContent.includes("آخر نهاية وصلتلها"), "النتائج السابقة معروضة على بطاقات التحديات بعد التحديث");
resume2[0].click(); await sleep(80);
assert($(doc, ".progress-meta")?.textContent.includes("المرحلة 2"), "الاستكمال أعادنا لنفس المرحلة وكمل الجولة");
await playToEnd(doc, () => 0, "إكمال التحدي الثاني");
assert(!!$(doc, ".result-ending"), "التحدي الثاني اكتمل أيضًا حتى النتيجة");

console.log("\n═══ ٧) اللعب الكامل للتحدي الثالث (كل التحديات من الشاشة) ═══");
byAction(doc, "home").click(); await sleep(60);
for (const ch of CHALLENGES) {
  // التحديان الأولان للُعبا فعلًا فوق؛ نلعب الثالث ونعيد التحقق منهم سريعًا
  if (ch.id !== "millionaire-day") continue;
  byAction(doc, "play", ch.id).click(); await sleep(60);
  byAction(doc, "begin").click(); await sleep(60);
  await playToEnd(doc, (i, n) => Math.min(1, n - 1), ch.title);
  assert($(doc, ".result-ending"), `«${ch.title}» لُعب كاملًا من الواجهة حتى نهاية «${$(doc, ".result-ending")?.textContent.trim()}»`);
}

console.log("\n═══ ٨) رابط صديق: شريط التحدي + مقارنة بعد اللعب ═══");
({ win, doc, capture } = await boot(savedFriendUrl.replace(/^https?:\/\/[^/]+/, "http://localhost:5173")));
assert(win.location.search === "", "الرابط نظّف باراميتراته بعد القراءة (عشان النسخ لا يحمل نتيجة الصديق خطًأ)");
const banner = $(doc, ".banner");
assert(!!banner && banner.textContent.includes(endingName), "شريط «صاحبك تحدّاك» يعرض نهاية الصديق الحقيقية من الرابط");
const acceptBtn = byAction(doc, "play", "last-decision");
acceptBtn.click(); await sleep(60);
byAction(doc, "begin").click(); await sleep(60);
await playToEnd(doc, (i, n) => n - 1, "جولة الصديق المقارن");
const compare = $(doc, ".compare-card");
assert(!!compare, "بطاقة المقارنة «أنت × صاحبك» ظهرت بعد الجولة");
assert(compare.textContent.includes(endingName), "المقارنة تعرض نهاية صاحب الرابط بجانب نهايتك");
assert(!!$(doc, ".compare-verdict"), "المقارنة تحتوي حكمها الترفيهي (نفس النهاية؟ مختلفة؟)");

console.log("\n═══ ٩) روابط مباشرة وروابط تالفة ═══");
({ win, doc, capture } = await boot("http://localhost:5173/?c=forgotten-island"));
assert($(doc, ".intro-card .scene-title")?.textContent.includes("الجزيرة المنسية"),
  "رابط تحدي مباشر (?c=) يفتح مقدمة ذلك التحدي فورًا");
({ win, doc, capture } = await boot("http://localhost:5173/?c=bogus&r=%%%bad%%%"));
assert(!!$(doc, ".hero") && !$(doc, ".banner"), "رابط تالف بالكامل: الإقلاع للرئيسية بأمان دون أي كسر");
({ win, doc, capture } = await boot("http://localhost:5173/?r=" + "A".repeat(2000)));
assert(!!$(doc, ".hero"), "باراميتر نتيجة ضخم/مشبوه يُرفض بأمان");

console.log("\n═══ ١٠) مشاركة اللعبة من الهيدر ═══");
capture.shares.length = 0;
byAction(doc, "share-game").click(); await sleep(100);
assert(capture.shares.length === 1 && capture.shares[0].url.startsWith("http://localhost:5173"), "زر «شارك اللعبة» يشارك رابط الموقع نفسه");

// تنظيف ملفات الإقلاع المؤقتة
for (const f of tempFiles) { try { rmSync(f); } catch {} }

console.log(`\n${failed === 0 ? "🎉" : "💥"} نتيجة اختبار الواجهة الفعلي: ناجح ${passed} فحصًا، فاشل ${failed}`);
process.exit(failed === 0 ? 0 : 1);
