/**
 * LOOP — الواجهة الرئيسية
 * SPA خفيفة بـ Vanilla JS: ثلاث شاشات (الرئيسية، اللعب، النتيجة)
 * تعتمد بالكامل على محرك القرارات والمحتوى المنفصلين.
 */
import "./style.css";
import { CHALLENGES, getChallenge, getDailyChallenge } from "./content/index.js";
import { STATS, STAT_KEYS, getTitleByKey } from "./content/titles.js";
import { createRun, applyChoice, buildResult, computeTitle } from "./lib/engine.js";
import { buildShareUrl, buildShareText, decodeResult, whatsappUrl, telegramUrl } from "./lib/share.js";
import { loadProgress, saveProgress, clearProgress, saveResult, getStoredResult, getResultsMap } from "./lib/storage.js";
import { renderShareCard, CanvasToBlob } from "./lib/card.js";

const app = document.getElementById("app");
const toast = document.getElementById("toast");

// ---------- حالة التطبيق ----------
const state = {
  view: "home", // home | game | result
  phase: "intro", // داخل اللعبة: intro | play
  challenge: null,
  run: null,
  result: null,
  friendResult: null, // نتيجة صديق قادمة من رابط مشاركة ?r=
  lastBumpedStats: [],
  shareCardUrl: null,
  shareCardBlob: null,
};

// قراءة باراميترات الرابط عند أول فتح (قادمة من مشاركة صديق)
function readUrlParams() {
  try {
    const params = new URLSearchParams(location.search);
    const r = params.get("r");
    if (r) state.friendResult = decodeResult(r, CHALLENGES);
    const c = params.get("c");
    if (c && getChallenge(c)) state.preselectedChallengeId = c;
    // تنظيف الرابط دون إعادة تحميل حتى لا تُنسخ نتيجة صديق بالخطأ
    if (r || c) history.replaceState(null, "", location.pathname + location.hash);
  } catch {
    /* روابط تالفة تُتجاهل */
  }
}

// ---------- أدوات صغيرة ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let toastTimer = null;
function showToast(msg, ms = 2600) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), ms);
}

function vibrate(ms = 12) {
  try { navigator.vibrate?.(ms); } catch {}
}

function scrollTop() {
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

function effectsSummary(effects) {
  const parts = Object.entries(effects || {})
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${STATS[k].icon} ${STATS[k].label} ${v > 0 ? "+" : ""}${v}`);
  return parts.join(" · ");
}

// ---------- المشاركة ----------
function gameShareUrl(challengeId) {
  return buildShareUrl(location.href, { challengeId });
}
function resultShareUrl(result) {
  return buildShareUrl(location.href, { challengeId: result.challengeId, result });
}

async function copyText(text, successMsg) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMsg || "اتنسخ الرابط ✅ الصقه لصحابك في أي مكان");
    return true;
  } catch {
    // بديل للمتصفحات القديمة/السياقات غير الآمنة
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast(successMsg || "اتنسخ الرابط ✅");
      return true;
    } catch {
      showToast("انسخ الرابط يدويًا: " + text, 5000);
      return false;
    }
  }
}

async function nativeShare({ title, text, url, file }) {
  // ١) مشاركة بالصورة إن أمكن (أجمل للأصدقاء)
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ title, text, url, files: [file] });
      return true;
    } catch (e) {
      if (e?.name === "AbortError") return true; // المستخدم ألغى بنفسه
    }
  }
  // ٢) مشاركة نصية بنافذة النظام
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return true;
    } catch (e) {
      if (e?.name === "AbortError") return true;
    }
  }
  // ٣) البديل الأخير: النسخ
  return copyText(text + "\n" + url);
}

// ---------- التنقل وبدء اللعب ----------
function goHome() {
  state.view = "home";
  state.challenge = null;
  state.run = null;
  state.result = null;
  render();
  scrollTop();
}

function openChallenge(challengeId, { resume = false } = {}) {
  const ch = getChallenge(challengeId);
  if (!ch) { showToast("التحدي ده مش موجود 😅"); return; }
  state.challenge = ch;
  state.view = "game";
  const saved = resume ? loadProgress(challengeId) : null;
  if (saved) {
    state.run = saved;
    state.phase = "play";
  } else {
    state.run = createRun(ch);
    state.phase = "intro";
  }
  state.result = null;
  render();
  scrollTop();
}

function startFresh(challengeId) {
  clearProgress(challengeId);
  openChallenge(challengeId);
}

function beginPlay() {
  state.phase = "play";
  saveProgress(state.challenge.id, state.run);
  render();
  scrollTop();
}

function choose(index) {
  if (state.choosing) return; // منع أي إدخال مكرر أثناء الانتقال
  const ch = state.challenge;
  const run = state.run;
  if (!ch || !run || run.done || state.phase !== "play") return;
  const node = ch.nodes[run.nodeId];
  const choice = node?.choices[index];
  if (!choice) return;
  state.choosing = true;

  vibrate(14);
  // إبراز الزر المختار لحظة قبل الانتقال
  const btns = document.querySelectorAll(".choice-btn");
  btns.forEach((b, i) => {
    b.disabled = true;
    if (i === index) b.classList.add("picked");
  });
  state.lastBumpedStats = Object.keys(choice.effects || {}).filter((k) => choice.effects[k] !== 0);

  setTimeout(() => {
    try {
      const nextRun = applyChoice(ch, run, index);
      state.run = nextRun;
      if (nextRun.done) {
        clearProgress(ch.id);
        state.result = saveResult(buildResult(ch, nextRun));
        state.view = "result";
        state.shareCardUrl = null;
        state.shareCardBlob = null;
        render();
        scrollTop();
        confetti();
        prepareShareCard();
      } else {
        saveProgress(ch.id, nextRun);
        render();
        scrollTop();
      }
    } catch (e) {
      console.error(e);
      showToast("حصل خطأ غير متوقع — جرّب من جديد 🙏");
      render();
    } finally {
      state.choosing = false;
    }
  }, 360);
}

function confirmModal({ title, text, confirmLabel, onConfirm }) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal card" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>
      <div class="btn-row">
        <button class="btn" data-act="cancel">إلغاء</button>
        <button class="btn btn-primary" data-act="ok">${esc(confirmLabel)}</button>
      </div>
    </div>`;
  backdrop.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "ok") { document.body.removeChild(backdrop); onConfirm(); }
    else if (act === "cancel" || e.target === backdrop) document.body.removeChild(backdrop);
  });
  document.body.appendChild(backdrop);
}

function quitToHome() {
  if (state.phase === "play" && state.run && state.run.history.length > 0) {
    confirmModal({
      title: "ترجع للقائمة؟",
      text: "تقدّمك في الجولة محفوظ، وتقدر تكمل من حيث وقفت في أي وقت.",
      confirmLabel: "أيوه، رجوع",
      onConfirm: goHome,
    });
  } else {
    goHome();
  }
}

function restart() {
  const id = state.challenge.id;
  confirmModal({
    title: "تبدأ من جديد؟",
    text: "هتبدأ القصة من أول مرحلة وتنسى قرارات الجولة الحالية.",
    confirmLabel: "ابدأ من جديد",
    onConfirm: () => { startFresh(id); beginPlay(); },
  });
}

// اختيارات بالكيبورد (1-4) على الكمبيوتر
document.addEventListener("keydown", (e) => {
  if (state.view === "game" && state.phase === "play" && ["1", "2", "3", "4"].includes(e.key)) {
    const idx = Number(e.key) - 1;
    const node = state.challenge?.nodes[state.run?.nodeId];
    if (node && idx < node.choices.length) choose(idx);
  }
  if (e.key === "Enter" && state.view === "game" && state.phase === "intro") beginPlay();
});

// ---------- بطاقة المشاركة ----------
async function prepareShareCard() {
  try {
    const title = getTitleByKey(state.result.titleKey);
    const Canvas = await renderShareCard({
      challenge: state.challenge,
      result: state.result,
      title,
      siteLabel: location.host ? `${location.host} — العب في LOOP` : "العب في LOOP",
    });
    state.shareCardBlob = await CanvasToBlob(Canvas);
    if (state.shareCardUrl) URL.revokeObjectURL(state.shareCardUrl);
    state.shareCardUrl = Canvas.toDataURL("image/png");
    const img = document.getElementById("share-card-img");
    if (img) img.src = state.shareCardUrl;
  } catch (e) {
    console.warn("تعذّر رسم بطاقة المشاركة", e);
  }
}

function downloadCard() {
  if (!state.shareCardUrl) { showToast("البطاقة لسه بتتجهز، ثانية واحدة…"); return; }
  const a = document.createElement("a");
  a.href = state.shareCardUrl;
  a.download = `loop-${state.result.challengeId}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast("اتحمّلت بطاقة نتيجتك 📸 شاركها في أي مكان");
}

async function shareResult() {
  const r = state.result;
  const url = resultShareUrl(r);
  const text = buildShareText(r);
  let file = null;
  if (state.shareCardBlob) {
    try { file = new File([state.shareCardBlob], "loop-result.png", { type: "image/png" }); } catch {}
  }
  await nativeShare({ title: "LOOP — نتيجتي", text, url, file });
}

async function shareGame(challengeId) {
  const ch = challengeId ? getChallenge(challengeId) : null;
  const url = gameShareUrl(challengeId);
  const text = ch
    ? `جرّب تحدي «${ch.title}» ${ch.icon} في لعبة LOOP — ${ch.tagline}. قراراتك هتغيّر النهاية!`
    : buildShareText(null);
  await nativeShare({ title: "LOOP — اختياراتك بتحكي قصتك", text, url });
}

// ---------- قصاصات الاحتفال (خفيفة، بدون مكتبات) ----------
function confetti() {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const Canvas = document.createElement("Canvas");
  Canvas.id = "confetti";
  document.body.appendChild(Canvas);
  const ctx = Canvas.getContext("2d");
  const resize = () => { Canvas.width = innerWidth; Canvas.height = innerHeight; };
  resize();
  const colors = ["#a855f7", "#7c3aed", "#38bdf8", "#f472b6", "#f59e0b", "#ffffff"];
  const parts = Array.from({ length: 130 }, () => ({
    x: Math.random() * Canvas.width,
    y: -30 - Math.random() * Canvas.height * 0.35,
    w: 6 + Math.random() * 8,
    h: 8 + Math.random() * 12,
    vy: 2.2 + Math.random() * 3.6,
    vx: -1.6 + Math.random() * 3.2,
    rot: Math.random() * Math.PI,
    vr: -0.12 + Math.random() * 0.24,
    color: colors[(Math.random() * colors.length) | 0],
  }));
  let frames = 0;
  (function tick() {
    ctx.clearRect(0, 0, Canvas.width, Canvas.height);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = frames > 150 ? Math.max(0, 1 - (frames - 150) / 50) : 1;
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    frames++;
    if (frames < 210) requestAnimationFrame(tick);
    else Canvas.remove();
  })();
}

// ============================================================
// العرض
// ============================================================
function headerHTML() {
  return `
  <header class="topbar">
    <button class="logo" data-action="home" aria-label="العودة للصفحة الرئيسية">
      <span class="logo-mark">♾️</span>
      <span class="logo-text">
        <span class="logo-name">LO<span>OP</span></span>
        <span class="logo-tag">اختياراتك بتحكي قصتك</span>
      </span>
    </button>
    <button class="btn" data-action="share-game">🔗 شارك اللعبة</button>
  </header>`;
}

function friendBannerHTML() {
  const f = state.friendResult;
  if (!f) return "";
  const title = getTitleByKey(f.titleKey);
  const mine = getStoredResult(f.challengeId);
  if (mine) {
    return `
    <section class="card banner" style="margin-top:22px">
      <div class="banner-icon">⚔️</div>
      <div class="banner-info">
        <h3>صاحبك تحدّاك في «${esc(f.challengeTitle)}»!</h3>
        <p>هو وصل لنهاية «${esc(f.endingTitle)}» ${f.endingIcon} بلقب «${esc(title.name)}»، وأنت لعبتها قبل كده ووصلت «${esc(mine.endingTitle)}». العبها تاني بخيارات مختلفة وشوف المقارنة كاملة بعد الجولة!</p>
      </div>
      <button class="btn btn-primary" data-action="play" data-id="${f.challengeId}">العب التحدي 🎮</button>
    </section>`;
  }
  return `
  <section class="card banner" style="margin-top:22px">
    <div class="banner-icon">👋</div>
    <div class="banner-info">
      <h3>وصلك تحدّي من صاحبك!</h3>
      <p>هو لعب «${esc(f.challengeTitle)}» ووصل لنهاية «${esc(f.endingTitle)}» ${f.endingIcon} بلقب ${title.icon} «${esc(title.name)}». تفتكر قراراتك هتوصّلك لفين؟ هنقارن لك النتيجتين بعد الجولة 😉</p>
    </div>
    <button class="btn btn-primary" data-action="play" data-id="${f.challengeId}">اقبل التحدي 🔥</button>
  </section>`;
}

function challengeCardHTML(ch) {
  const mine = getStoredResult(ch.id);
  const saved = loadProgress(ch.id);
  const endingsCount = Object.keys(ch.endings).length;
  const isDaily = getDailyChallenge().id === ch.id;
  return `
  <article class="card ch-card">
    <div class="glow" style="background:linear-gradient(90deg, ${ch.gradient[0]}, ${ch.gradient[1]})"></div>
    <div class="ch-icon">${ch.icon}</div>
    <h3 class="ch-title">${esc(ch.title)}</h3>
    <p class="ch-tag">${esc(ch.tagline)}</p>
    <div class="chip-row">
      <span class="chip">⏱️ ${esc(ch.minutes)}</span>
      <span class="chip">🧭 ${ch.steps} قرارات تقريبًا</span>
      <span class="chip">🏁 ${endingsCount} نهايات مختلفة</span>
      <span class="chip">${esc(ch.category)}</span>
      ${isDaily ? `<span class="chip chip-done">⭐ تحدي اليوم</span>` : ""}
      ${mine ? `<span class="chip chip-done">✅ لعبتها ${mine.plays > 1 ? `${mine.plays} مرات` : "مرة"}</span>` : ""}
    </div>
    ${mine ? `<div class="ch-prev-result">آخر نهاية وصلتلها: ${mine.endingIcon} <b>${esc(mine.endingTitle)}</b> · فتحت ${mine.endingsSeen.length} من ${endingsCount} نهايات</div>` : ""}
    ${saved ? `<button class="btn btn-primary btn-block" data-action="resume" data-id="${ch.id}">▶️ أكمل من حيث توقفت (المرحلة ${saved.step})</button>` : ""}
    <button class="btn ${saved ? "" : "btn-primary"} btn-block" data-action="play" data-id="${ch.id}">${saved ? "🔄 ابدأ من جديد" : "ابدأ التحدي 🎮"}</button>
  </article>`;
}

function homeView() {
  const daily = getDailyChallenge();
  const resultsMap = getResultsMap();
  const completed = CHALLENGES.filter((c) => resultsMap[c.id]).length;
  const dailyMine = getStoredResult(daily.id);
  const dailySaved = loadProgress(daily.id);

  return `
  ${headerHTML()}
  <main class="view">
    <section class="hero">
      <span class="hero-badge">🌀 لعبة قرارات تفاعلية بالعربي</span>
      <h1>قرار واحد<br/><span class="grad">ممكن يغيّر كل حاجة</span></h1>
      <p class="hero-sub">ادخل قصة خيالية، واتخذ سلسلة قرارات متتالية… كل قرار تختاره بيغيّر الأحداث اللي بعده والنهاية اللي هتوصّل لها. في الآخر هتاخد لقب وبطاقة نتيجة تتحدى بيها صحابك!</p>
      <div class="hero-actions">
        <button class="btn btn-primary btn-big" data-action="play" data-id="${daily.id}">🔥 ابدأ تحدي اليوم</button>
        <a class="btn btn-big" href="#challenges">تصفّح التحديات 👇</a>
      </div>
      <div class="stat-strip">
        <div class="stat-pill"><b>${CHALLENGES.length}</b><small>تحديات متاحة دلوقتي</small></div>
        <div class="stat-pill"><b>${CHALLENGES.reduce((n, c) => n + Object.keys(c.endings).length, 0)}</b><small>نهاية مختلفة ممكنة</small></div>
        <div class="stat-pill"><b>${completed}/${CHALLENGES.length}</b><small>تحديات خلّصتها أنت</small></div>
      </div>
    </section>

    ${friendBannerHTML()}

    <section class="section" id="daily">
      <div class="section-head">
        <div>
          <h2 class="section-title">⭐ <span class="grad">تحدي اليوم</span></h2>
          <p class="section-sub">بيتبدل كل يوم — ارجع بكره هتلاقي قصة جديدة في المقدمة</p>
        </div>
      </div>
      <div class="card daily-card">
        <div class="daily-inner">
          <div class="daily-icon">${daily.icon}</div>
          <div class="daily-info">
            <div class="daily-kicker">📅 قصة اليوم</div>
            <h3 class="daily-title">${esc(daily.title)}</h3>
            <p class="daily-tag">${esc(daily.tagline)}</p>
            <div class="chip-row">
              <span class="chip">⏱️ ${esc(daily.minutes)}</span>
              <span class="chip">🏁 ${Object.keys(daily.endings).length} نهايات</span>
              <span class="chip">${esc(daily.category)}</span>
              ${dailyMine ? `<span class="chip chip-done">✅ آخر نتيجة لك: ${dailyMine.endingIcon} ${esc(dailyMine.endingTitle)}</span>` : ""}
            </div>
          </div>
          ${dailySaved
            ? `<button class="btn btn-primary btn-big" data-action="resume" data-id="${daily.id}">▶️ أكمل جولتك</button>`
            : `<button class="btn btn-primary btn-big" data-action="play" data-id="${daily.id}">ابدأ التحدي 🚀</button>`}
        </div>
      </div>
    </section>

    <section class="section" id="challenges">
      <div class="section-head">
        <div>
          <h2 class="section-title">🎮 كل <span class="grad">التحديات</span></h2>
          <p class="section-sub">كل تحدي قصة مستقلة بقرارات ونهايات مختلفة — وتحديات جديدة في الطريق</p>
        </div>
      </div>
      <div class="grid">
        ${CHALLENGES.map(challengeCardHTML).join("")}
      </div>
    </section>

    <section class="section" id="how">
      <div class="section-head">
        <h2 class="section-title">❓ كيف <span class="grad">تلعب؟</span></h2>
      </div>
      <div class="steps">
        <div class="card step-card"><div class="step-num">١</div><h3>اختار قصة</h3><p>كل تحدي عالم مختلف: مدينة تنطفئ، جزيرة منسية، أو ثروة مفاجئة!</p></div>
        <div class="card step-card"><div class="step-num">٢</div><h3>خد قراراتك</h3><p>في كل مرحلة اختيارات، وكل اختيار بيأثر في اللي بعده وفي مقاييس شخصيتك في اللعب: الجرأة، التعاون، الحذر والتضحية.</p></div>
        <div class="card step-card"><div class="step-num">٣</div><h3>اكتشف نهايتك</h3><p>قصتك بتنتهي بواحدة من نهايات كتير على حسب قراراتك، ومعها لقب ترفيهي يعكس أسلوب لعبك.</p></div>
        <div class="card step-card"><div class="step-num">٤</div><h3>تحدَّ صحابك</h3><p>شارك بطاقة نتيجتك ورابط التحدي — صاحبك هيشوف نتيجتك ويحاول يوصّل لنهاية مختلفة، والمقارنة بتظهر له بعد لعبه!</p></div>
      </div>
    </section>

    <section class="card footer-note">
      <h3>📌 حدود النسخة الحالية (بكل شفافية)</h3>
      <p>دي نسخة محلية قابلة للعب بالكامل بدون حسابات وبدون أي خادم:</p>
      <ul>
        <li>تقدّمك ونتائجك محفوظة على جهازك أنت بس (مفيش قاعدة بيانات مركزية لسه).</li>
        <li>مقارنة الأصدقاء شغّالة عبر روابط المشاركة: رابطك بيحمل نتيجتك، وصاحبك بيشوف المقارنة بعد ما يلعب.</li>
        <li>الألقاب وملخص أسلوب اللعب للمتعة والمشاركة — مش تقييم نفسي ولا علمي.</li>
        <li>الخطوة التالية في خطة المشروع: قاعدة بيانات مركزية لنتائج جماعية وغرف تحديات بين الأصدقاء.</li>
      </ul>
    </section>

    <p class="copyright">LOOP ♾️ — اتعملت بحب للعب والمشاركة. قراراتك اليوم… حكايات بكره ✨</p>
  </main>`;
}

function gameView() {
  const ch = state.challenge;
  const run = state.run;

  const topBar = `
    <div class="game-top">
      <button class="icon-btn" data-action="quit">🏠 القائمة الرئيسية</button>
      <span class="game-title-chip">${ch.icon} ${esc(ch.title)}</span>
      <button class="icon-btn" data-action="restart" ${state.phase === "intro" ? "disabled style='opacity:.4'" : ""}>🔄 من الأول</button>
    </div>`;

  if (state.phase === "intro") {
    const saved = loadProgress(ch.id);
    return `
    <main class="view game-wrap">
      ${topBar}
      <section class="card intro-card">
        <span class="intro-icon">${ch.icon}</span>
        <h1 class="scene-title" style="font-size:clamp(1.8rem,6vw,2.6rem)">${esc(ch.title)}</h1>
        <div class="chip-row" style="justify-content:center">
          <span class="chip">${esc(ch.category)}</span>
          <span class="chip">⏱️ ${esc(ch.minutes)}</span>
          <span class="chip">🧭 حوالي ${ch.steps} قرارات</span>
          <span class="chip">🏁 ${Object.keys(ch.endings).length} نهايات ممكنة</span>
        </div>
        <p class="scene-text" style="margin-top:16px">${esc(ch.intro)}</p>
        ${state.friendResult?.challengeId === ch.id ? `<div class="echo" style="margin-top:20px"><b>⚔️ تحدّي صاحبك:</b><span>هو وصل لنهاية «${esc(state.friendResult.endingTitle)}». شوف هتوصّل لفين أنت!</span></div>` : ""}
        <div class="btn-row" style="margin-top:24px">
          ${saved ? `<button class="btn btn-big" data-action="resume" data-id="${ch.id}">▶️ أكمل من المرحلة ${saved.step}</button>` : ""}
          <button class="btn btn-primary btn-big" data-action="begin">ابدأ القصة 🎮</button>
        </div>
        <p style="color:var(--text-faint);font-size:.85rem;margin-top:14px">تلميح: مفيش إجابات صح وغلط — في حكايتك أنت وبس ✨</p>
      </section>
    </main>`;
  }

  const node = ch.nodes[run.nodeId];
  const totalSteps = Math.max(ch.steps, run.step);
  const progress = Math.min(100, Math.round(((run.step - 1) / totalSteps) * 100));

  const statsMini = STAT_KEYS.map((k) => `
    <span class="stat-chip ${state.lastBumpedStats.includes(k) ? "bump" : ""}">${STATS[k].icon} ${STATS[k].label} <b>${run.stats[k]}</b></span>
  `).join("");

  return `
  <main class="view game-wrap">
    ${topBar}
    <div class="progress-wrap">
      <div class="progress-meta">
        <span>المرحلة ${run.step} من حوالي ${totalSteps}</span>
        <span>${progress}٪ من القصة</span>
      </div>
      <div class="progress-bar" role="progressbar" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100">
        <div class="progress-fill" style="width:${progress}%"></div>
      </div>
    </div>

    ${run.lastEcho ? `<div class="echo"><b>نتيجة قرارك:</b><span>${esc(run.lastEcho)}</span></div>` : ""}

    <section class="card scene-card">
      <span class="scene-emoji">${node.scene}</span>
      <h2 class="scene-title">${esc(node.title)}</h2>
      <p class="scene-text">${esc(node.text)}</p>
      <div class="choices" role="group" aria-label="الاختيارات المتاحة">
        ${node.choices.map((c, i) => `
          <button class="choice-btn" data-action="choose" data-index="${i}">
            <span class="choice-icon">${c.icon || "👉"}</span>
            <span>${esc(c.text)}</span>
            <span class="choice-key">${i + 1}</span>
          </button>`).join("")}
      </div>
      <div class="stats-mini" aria-label="مؤشرات أسلوب لعبك حتى الآن">${statsMini}</div>
    </section>
  </main>`;
}

function compareHTML(result) {
  const f = state.friendResult;
  if (!f || f.challengeId !== result.challengeId) return "";
  const fTitle = getTitleByKey(f.titleKey);
  const mine = result.stats;
  const sameEnding = f.endingId === result.endingId;
  const rows = STAT_KEYS.map((k) => `
    <div class="row"><span class="v">${mine[k]}</span><span class="lbl">${STATS[k].icon} ${STATS[k].label}</span><span class="v">${f.stats[k]}</span></div>
  `).join("");
  return `
  <section class="card compare-card">
    <h3>⚔️ المقارنة مع صاحب الرابط</h3>
    <div class="compare-grid">
      <div class="compare-side">
        <div class="who">أنت 🙋</div>
        <div class="big">${result.endingIcon}</div>
        <div class="end-name">${esc(result.endingTitle)}</div>
        <div class="ttl">${getTitleByKey(result.titleKey).icon} ${esc(result.titleName)}</div>
      </div>
      <div class="compare-vs">ضد</div>
      <div class="compare-side">
        <div class="who">صاحبك 🧑‍🤝‍🧑</div>
        <div class="big">${f.endingIcon}</div>
        <div class="end-name">${esc(f.endingTitle)}</div>
        <div class="ttl">${fTitle.icon} ${esc(fTitle.name)}</div>
      </div>
    </div>
    <div class="compare-stats">${rows}</div>
    <p class="compare-verdict">${sameEnding ? "😲 نفس النهاية! باين عقلكم شبه بعض… أو كده نحو على التفاهم!" : "🎉 نهايات مختلفة! نفس القصة… وحكايتين على الآخر. دي هي روح LOOP"}</p>
  </section>`;
}

function resultView() {
  const ch = state.challenge;
  const run = state.run;
  const result = state.result;
  const title = getTitleByKey(result.titleKey);
  const ending = ch.endings[result.endingId];
  const maxStat = Math.max(8, ...STAT_KEYS.map((k) => result.stats[k]));
  const url = resultShareUrl(result);
  const text = buildShareText(result);
  const endingsCount = Object.keys(ch.endings).length;
  const totalSteps = Math.max(ch.steps, run.history.length);

  const statBars = STAT_KEYS.map((k) => `
    <div class="stat-bar-row">
      <span class="stat-bar-label">${STATS[k].icon} ${STATS[k].label}</span>
      <span class="stat-bar-track"><span class="stat-bar-fill" data-w="${Math.round((result.stats[k] / maxStat) * 100)}" style="display:block;background:${STATS[k].color}"></span></span>
      <span class="stat-bar-val">${result.stats[k]}</span>
    </div>`).join("");

  const timeline = run.history.map((h) => `
    <li>
      <span class="dot">${h.scene || "•"}</span>
      <div class="t-node">${esc(h.nodeTitle)}</div>
      <div class="t-choice">${h.choiceIcon} ${esc(h.choiceText)}</div>
      <div class="t-effects">${esc(effectsSummary(h.effects))}</div>
    </li>`).join("");

  return `
  <main class="view result-wrap">
    <div class="game-top">
      <button class="icon-btn" data-action="home">🏠 القائمة الرئيسية</button>
      <span class="game-title-chip">${ch.icon} ${esc(ch.title)} — خلّصتها في ${result.decisions} قرارات</span>
      <span></span>
    </div>
    <div class="progress-bar" style="margin-bottom:18px"><div class="progress-fill" style="width:100%"></div></div>

    <section class="card result-hero">
      <div class="result-kicker">🏁 نهايتك في قصة «${esc(ch.title)}»</div>
      <span class="result-emoji">${result.endingIcon}</span>
      <h1 class="result-ending"><span class="grad">${esc(result.endingTitle)}</span></h1>
      ${ending.secret ? `<div><span class="secret-tag">⭐ نهاية سرّية — قليلين اللي بيوصّلوا لها!</span></div>` : ""}
      <p class="result-text">${esc(ending.text)}</p>
    </section>

    <section class="card title-card">
      <div class="title-icon">${title.icon}</div>
      <div class="title-info">
        <div class="title-kicker">🏅 لقب أسلوب لعبك في الجولة دي</div>
        <div class="title-name"><span class="grad">${esc(title.name)}</span></div>
        <p class="title-desc">${esc(title.desc)}</p>
      </div>
    </section>

    ${compareHTML(result)}

    <section class="card stats-card">
      <h3>📊 بصمة قراراتك</h3>
      <p class="stats-hint">ملخص ترفيهي بيعكس اختياراتك في اللعب بس — مش تقييم لشخصيتك الحقيقية 🙂</p>
      ${statBars}
    </section>

    <section class="card history-card">
      <h3>🗺️ رحلة قراراتك</h3>
      <ul class="timeline">${timeline}</ul>
    </section>

    <section class="card share-card">
      <h3>📣 تحدَّ أصحابك</h3>
      <p>شارك بطاقة نتيجتك أو رابط التحدي — الرابط بيحمل نتيجتك (نهايتك ولقبك بس، من غير أي بيانات شخصية) عشان صحابك يقارنوا نفسهم بيك بعد ما يلعبوا.</p>
      <img id="share-card-img" class="share-preview" alt="بطاقة نتيجة LOOP القابلة للمشاركة" ${state.shareCardUrl ? `src="${state.shareCardUrl}"` : ""} />
      <div class="btn-row">
        <button class="btn btn-primary" data-action="share-result">📤 تحدَّ أصحابك</button>
        <button class="btn" data-action="download-card">⬇️ حمّل البطاقة</button>
      </div>
      <div class="btn-row" style="margin-top:11px">
        <a class="btn btn-whatsapp" href="${whatsappUrl(text, url)}" target="_blank" rel="noopener">💬 واتساب</a>
        <a class="btn btn-telegram" href="${telegramUrl(text, url)}" target="_blank" rel="noopener">✈️ تيليجرام</a>
        <button class="btn" data-action="copy-link">🔗 انسخ رابط اللعبة</button>
      </div>
    </section>

    <div class="result-actions">
      <button class="btn btn-primary btn-big" data-action="replay">🔁 العب مرة أخرى — جرّب توصّل لنهاية تانية</button>
      <div class="btn-row">
        <button class="btn" data-action="next-challenge">🎮 جرّب تحدي تاني</button>
        <button class="btn btn-ghost" data-action="home">🏠 القائمة الرئيسية</button>
      </div>
    </div>

    <p class="plays-note">دي المحاولة رقم ${result.plays || 1} لك في التحدي ده · فتحت ${result.endingsSeen?.length || 1} من ${endingsCount} نهايات · الجولة أخدت ${totalSteps} مراحل</p>
  </main>`;
}

function render() {
  state.lastBumpedStats = state.view === "game" ? state.lastBumpedStats : [];
  if (state.view === "home") app.innerHTML = homeView();
  else if (state.view === "game") app.innerHTML = gameView();
  else if (state.view === "result") {
    app.innerHTML = resultView();
    // تحريك أشرطة المؤشرات بعد الرسم
    requestAnimationFrame(() =>
      setTimeout(() => {
        document.querySelectorAll(".stat-bar-fill").forEach((el) => (el.style.width = el.dataset.w + "%"));
      }, 60)
    );
  }
}

// ---------- ربط الأحداث (تفويض واحد على مستوى التطبيق) ----------
app.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  const id = el.dataset.id;

  switch (action) {
    case "home": goHome(); break;
    case "quit": quitToHome(); break;
    case "play": openChallenge(id); break;
    case "resume": openChallenge(id, { resume: true }); break;
    case "begin": beginPlay(); break;
    case "choose": choose(Number(el.dataset.index)); break;
    case "restart": restart(); break;
    case "replay": startFresh(state.challenge.id); beginPlay(); break;
    case "next-challenge": {
      const others = CHALLENGES.filter((c) => c.id !== state.challenge.id);
      const next = others.find((c) => !getStoredResult(c.id)) || others[0];
      openChallenge(next.id);
      break;
    }
    case "share-game": shareGame(id || null); break;
    case "share-result": shareResult(); break;
    case "download-card": downloadCard(); break;
    case "copy-link": copyText(resultShareUrl(state.result), "اتنسخ رابط اللعبة ونتيجتك ✅"); break;
  }
});

// ---------- الإقلاع ----------
readUrlParams();
render();
