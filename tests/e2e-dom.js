/* ============================================================
   LOOP — اختبار متصفح شامل (E2E) باستخدام jsdom [اختياري للمطوّر]
   بيفتح اللعبة الحقيقية، يضغط الأزرار، يلعب جولات كاملة،
   ويتحقق من: البدء، القرارات، التقدم، النهاية، المشاركة،
   إعادة اللعب، الاستكمال، مقارنة الأصدقاء، والروابط الخاطئة.

   المتطلبات (للتطوير فقط — اللعبة نفسها من غير أي مكتبات):
     npm install --no-save jsdom
   التشغيل:
     1) شغّل خادم اللعبة:   npm start
     2) في طرفية تانية:     npm run test:e2e
   ============================================================ */
'use strict';

const path = require('path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');
const Engine = require(path.join(__dirname, '..', 'js', 'engine.js'));
const Share = require(path.join(__dirname, '..', 'js', 'share.js'));
const DATA = require(path.join(__dirname, '..', 'js', 'data', 'challenges.js'));

const BASE = 'http://localhost:8000';
let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; console.log('  ❌ ' + name); }
}
function section(name) { console.log('\n▶ ' + name); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ar2en = (s) => String(s).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

/* اسمح فقط بخادم اللعبة المحلي، وأجب على الطلبات الخارجية (خطوط) بفراغ */
const localOnlyInterceptor = requestInterceptor((request) => {
  if (!request.url.startsWith(BASE)) {
    return new Response('', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  return undefined;
});

async function loadGame(pathAndQuery) {
  const errors = [];
  const clip = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const msg = (e && e.message) || String(e);
    // تجاهل ضوضاء jsdom المعروفة (كانفس/تمرير غير مدعومين في المحاكاة فقط)
    if (/Not implemented: (HTMLCanvasElement|window\.scrollTo|HTMLElement\.prototype\.scrollIntoView)/.test(msg)) return;
    errors.push(msg);
  });
  const dom = await JSDOM.fromURL(BASE + pathAndQuery, {
    resources: { interceptors: [localOnlyInterceptor] },
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = () => {};
      try { Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true }); } catch (e) {}
      try {
        Object.defineProperty(window.navigator, 'clipboard', {
          value: { writeText: (t) => { clip.push(t); return Promise.resolve(); } },
          configurable: true
        });
      } catch (e) {}
      window.addEventListener('error', (ev) => errors.push('window.error: ' + (ev.message || 'unknown')));
    }
  });
  await sleep(250);
  return { dom, win: dom.window, doc: dom.window.document, errors, clip };
}

const $id = (doc, id) => doc.getElementById(id);
const active = (doc, name) => $id(doc, 'screen-' + name).classList.contains('active');

async function playUntilResult(win, pickIdx) {
  const doc = win.document;
  let steps = 0;
  let stalledWaits = 0;
  while (steps < 12) {
    if (active(doc, 'result')) break;
    const btns = [...doc.querySelectorAll('#choicesWrap .choice-btn')].filter((b) => !b.disabled);
    if (!btns.length) {
      if (++stalledWaits > 40) {
        throw new Error('STALL: ما فيش أزرار مفعّلة — الشاشة اللعب؟ ' + active(doc, 'game') +
          ' | العنوان: ' + $id(doc, 'sceneLabel').textContent +
          ' | القرارات: ' + $id(doc, 'historyCount').textContent);
      }
      await sleep(300); continue;
    }
    stalledWaits = 0;
    const idx = Math.max(0, Math.min(pickIdx(steps, btns.length), btns.length - 1));
    btns[idx].click();
    steps++;
    await sleep(1150); // وقت انتقال المشهد في اللعبة (900ms) + هامش
  }
  return steps;
}

async function main() {
  const ch1 = DATA.CHALLENGES.find((c) => c.id === 'last-decision');
  const ch2 = DATA.CHALLENGES.find((c) => c.id === 'last-train');

  /* ---------- A: تحميل الرئيسية ---------- */
  section('A) الصفحة الرئيسية تُحمّل وتُبنى صح');
  let g = await loadGame('/');
  let doc = g.doc;
  check('شاشة الرئيسية نشطة', active(doc, 'home'));
  check('بطاقة تحدي اليوم مبنية', $id(doc, 'dailyCard').innerHTML.includes('ابدأ التحدي'));
  check('تحديان قابلان للعب في الشبكة', doc.querySelectorAll('#challengesGrid [data-start]').length === 2);
  check('بطاقتا "قريبًا" واضحتان', doc.querySelectorAll('#challengesGrid .soon-tag').length === 2);
  check('شارة عدد التحديات صحيحة', $id(doc, 'challengesCount').textContent.includes('تحدّيان'));
  check('مفيش أخطاء جافاسكربت عند التحميل', g.errors.length === 0);
  if (g.errors.length) console.log('   أخطاء:', g.errors);

  /* ---------- L: زر ابدأ اللعب (تحدي اليوم) ---------- */
  section('L) زر «ابدأ اللعب» في الهيرو يشغل تحدي اليوم');
  const daily = Engine.getDailyChallenge();
  $id(doc, 'heroStartBtn').click();
  await sleep(300);
  check('انتقلنا لشاشة اللعب', active(doc, 'game'));
  check('عنوان اللعبة بيعرض التحدي الصحيح', $id(doc, 'gameChallengeTitle').textContent.includes(daily.title));
  // ارجع للرئيسية عبر الشعار
  $id(doc, 'brandBtn').click();
  await sleep(300);
  check('زر الشعار رجع للرئيسية', active(doc, 'home'));
  // فيه جولة محفوظة لأننا بدأنا وطلعنا — البانر لازم يظهر
  check('بانر استكمال الجولة ظهر', !$id(doc, 'resumeBanner').classList.contains('hidden'));
  $id(doc, 'resumeDiscardBtn').click();
  await sleep(200);
  check('نافذة تأكيد المسح ظهرت', !$id(doc, 'modalBackdrop').classList.contains('hidden'));
  $id(doc, 'modalConfirm').click();
  await sleep(300);
  check('بعد التأكيد: التقدم اتمسح والبانر اختفى', $id(doc, 'resumeBanner').classList.contains('hidden'));

  /* ---------- B: جولة كاملة في قرارك الأخير ---------- */
  section('B) لعب «قرارك الأخير» من أول ضغطة لحد النهاية');
  doc.querySelector('[data-start="last-decision"]').click();
  await sleep(300);
  check('بدأنا من المشهد الأول بالنص الصحيح', $id(doc, 'sceneText').textContent === ch1.nodes[ch1.start].text);
  check('أول مشهد فيه ٣ اختيارات', doc.querySelectorAll('#choicesWrap .choice-btn').length === 3);
  check('شريط التقدم بيبدأ من صفر', $id(doc, 'progressFill').style.width === '0%');

  // قرار أول يدوي للتأكد من التغيّر الفوري
  doc.querySelectorAll('#choicesWrap .choice-btn')[0].click();
  await sleep(1150);
  const scene2 = $id(doc, 'sceneText').textContent;
  check('بعد أول قرار المشهد اتغيّر', scene2 !== ch1.nodes[ch1.start].text && scene2.length > 20);
  check('نص "القرار ٢" في التقدم', ar2en($id(doc, 'progressText').textContent).includes('2'));
  check('سجل القرارات بيعد ١', $id(doc, 'historyCount').textContent === '١');
  const statsTxt = $id(doc, 'statsStrip').textContent;
  check('شريط القيم معروض واتأثر (جرأة +٢)', ar2en(statsTxt).includes('2'));

  const moreSteps = await playUntilResult(g.win, () => 0);
  const totalSteps = 1 + moreSteps;
  check('وصلنا لشاشة النتيجة بعد ' + totalSteps + ' قرارات (٥–٧)', active(doc, 'result') && totalSteps >= 5 && totalSteps <= 7);
  const endingTitle = $id(doc, 'endingTitle').textContent.trim();
  const endingIds = Object.values(ch1.nodes).filter((n) => n.ending).map((n) => n.title);
  check('عنوان نهاية سليم ومعروف: «' + endingTitle + '»', endingIds.includes(endingTitle));
  check('نص النهاية معروض', $id(doc, 'endingText').textContent.length > 30);
  check('اللقب الترفيهي معروض', $id(doc, 'playerTitleName').textContent.trim().length > 2);
  check('أربع أشرطة قيم مرسومة', doc.querySelectorAll('#statsBars .stat-row').length === 4);
  check('قائمة أهم القرارات فيها نفس عدد قراراتك', doc.querySelectorAll('#resultHistoryList li').length === totalSteps);
  check('بطاقة المشاركة مملوءة بالنهاية واللقب',
    $id(doc, 'shareCardEnding').textContent === endingTitle &&
    $id(doc, 'shareCardTitle').textContent.trim().length > 2);
  check('النتيجة اتحفظت محليًا', !!g.win.localStorage.getItem('loop_last_result'));
  check('الجولة الجارية اتمسحت بعد الانتهاء', !g.win.localStorage.getItem('loop_current_run'));
  check('عداد الجولات على الجهاز = ١', g.win.localStorage.getItem('loop_finished_count') === '1');

  /* ---------- C: المشاركة من شاشة النتيجة ---------- */
  section('C) أزرار المشاركة تعمل وتنتج روابط صحيحة');
  g.clip.length = 0;
  $id(doc, 'copyLinkBtn').click();
  await sleep(300);
  check('زر نسخ الرابط نسخ رابط نتيجة كامل', g.clip.length === 1 && g.clip[0].includes('c=last-decision') && g.clip[0].includes('&r='));
  const rParam = new URL(g.clip[0]).searchParams.get('r');
  const decoded = Share.decodePayload(rParam);
  check('الرابط المشفر بيتفك صح وبيطابق الجولة',
    decoded && decoded.g === 'last-decision' && decoded.p.length === totalSteps &&
    ch1.nodes[decoded.e] && ch1.nodes[decoded.e].title === endingTitle);
  check('رابط الواتساب سليم وبيشيل الرابط', $id(doc, 'waShareBtn').href.startsWith('https://wa.me/?text=') &&
    decodeURIComponent($id(doc, 'waShareBtn').href).includes('r='));
  check('رابط التيليجرام سليم', $id(doc, 'tgShareBtn').href.startsWith('https://t.me/share/url?url='));
  // زر تحدَّ أصحابك (Web Share غير متاح في المحاكاة → ينسخ)
  g.clip.length = 0;
  $id(doc, 'challengeFriendsBtn').click();
  await sleep(300);
  check('زر «تحدَّ أصحابك» ينسخ عند غياب Web Share', g.clip.length === 1);
  // زر بطاقة الصورة: كانفس غير مدعوم في jsdom — لازم ما يكسّرش أي حاجة
  $id(doc, 'downloadCardBtn').click();
  await sleep(300);
  check('زر البطاقة ما كسّرش الصفحة (برة المحاكاة الكانفس شغال عادي)', g.errors.length === 0);
  if (g.errors.length) console.log('   أخطاء:', g.errors);

  /* ---------- D: العب مرة أخرى + إعادة البدء ---------- */
  section('D) إعادة اللعب وزر "من الأول" بيعملان');
  $id(doc, 'playAgainBtn').click();
  await sleep(300);
  check('«العب مرة أخرى» رجعنا للمشهد الأول', active(doc, 'game') && $id(doc, 'sceneText').textContent === ch1.nodes[ch1.start].text);
  check('عداد القرارات صفّر', $id(doc, 'historyCount').textContent === '٠');

  // خد قرارين ثم إعادة
  for (let i = 0; i < 2; i++) { doc.querySelectorAll('#choicesWrap .choice-btn')[0].click(); await sleep(1150); }
  check('بعد قرارين العداد = ٢', $id(doc, 'historyCount').textContent === '٢');
  $id(doc, 'historyToggle').click();
  await sleep(150);
  check('زر "قراراتي" بيفتح اللوحة وبها قرارين', !$id(doc, 'historyPanel').classList.contains('hidden') &&
    doc.querySelectorAll('#historyList li').length === 2);
  $id(doc, 'gameRestartBtn').click();
  await sleep(200);
  $id(doc, 'modalConfirm').click();
  await sleep(300);
  check('بعد تأكيد الإعادة: رجعنا لأول مشهد والعداد صفّر',
    $id(doc, 'sceneText').textContent === ch1.nodes[ch1.start].text && $id(doc, 'historyCount').textContent === '٠');

  /* ---------- E: الرجوع للرئيسية ثم استكمال ---------- */
  section('E) حفظ التقدم والاستكمال من حيث وقفت');
  doc.querySelectorAll('#choicesWrap .choice-btn')[1].click();
  await sleep(1150);
  const midSceneText = $id(doc, 'sceneText').textContent;
  $id(doc, 'gameHomeBtn').click();
  await sleep(300);
  check('رجعنا للرئيسية وبانر الاستكمال ظاهر', active(doc, 'home') && !$id(doc, 'resumeBanner').classList.contains('hidden'));
  check('كرت آخر نتيجة لسه موجود', $id(doc, 'lastResultWrap').innerHTML.includes(endingTitle));
  $id(doc, 'resumeBtn').click();
  await sleep(300);
  check('الاستكمال رجّع نفس المشهد اللي سيبناه', active(doc, 'game') && $id(doc, 'sceneText').textContent === midSceneText);
  await playUntilResult(g.win, (s, n) => n - 1);
  check('كملت الجولة ووصلنا لنتيجة', active(doc, 'result'));
  $id(doc, 'resultHomeBtn').click();
  await sleep(300);
  check('«القائمة الرئيسية» من النتيجة ترجع للرئيسية', active(doc, 'home'));
  check('عداد الجولات بقى ٢ (دي الجولة المنتهية التانية على نفس الجلسة)', g.win.localStorage.getItem('loop_finished_count') === '2');

  /* ---------- F: مشاركة النتيجة المحفوظة من الرئيسية ---------- */
  section('F) مشاركة آخر نتيجة من الصفحة الرئيسية');
  g.clip.length = 0;
  const shareLast = $id(doc, 'shareLastBtn');
  check('زر مشاركة النتيجة المحفوظة موجود', !!shareLast);
  if (shareLast) { shareLast.click(); await sleep(300); }
  check('انسخ رابط نتيجة صالح', g.clip.length === 1 && g.clip[0].includes('&r='));

  /* ---------- J: الصوت ---------- */
  section('J) زر كتم الصوت');
  const snd = $id(doc, 'soundToggle');
  const before = snd.textContent;
  snd.click(); await sleep(150);
  check('أيقونة الصوت تبدلت واتحفظت', snd.textContent !== before && g.win.localStorage.getItem('loop_sound') === 'false');
  snd.click(); await sleep(150);
  check('واشتغل تاني واتحفظ', g.win.localStorage.getItem('loop_sound') === 'true');
  check('لا أخطاء خلال كل ما سبق على نفس الجلسة', g.errors.length === 0);
  if (g.errors.length) console.log('   أخطاء:', g.errors);
  g.win.close();

  /* ---------- G + H: رابط صديق والمقارنة ---------- */
  section('G/H) رابط نتيجة صديق → لعب → مقارنة قرارات');
  let fr = Engine.createRun('last-train');
  while (!fr.finished) fr = Engine.applyChoice(fr, 0);
  const frSum = Engine.summarizeRun(fr);
  const payload = { v: 1, g: frSum.challengeId, e: frSum.endingId, t: frSum.title.key, s: frSum.stats,
                    p: frSum.history.map((h) => ({ n: h.nodeId, c: h.choiceIndex })) };
  const friendPath = '/?c=last-train&r=' + Share.encodePayload(payload);

  let g2 = await loadGame(friendPath);
  check('بانر الصديق ظهر وبيعرض نهايته', !$id(g2.doc, 'friendBanner').classList.contains('hidden') &&
    $id(g2.doc, 'friendBannerText').textContent.includes(frSum.endingTitle));
  $id(g2.doc, 'friendBannerBtn').click();
  await sleep(300);
  check('بدأ تحدي صديقك «القطار الأخير»', active(g2.doc, 'game') &&
    $id(g2.doc, 'sceneText').textContent === ch2.nodes[ch2.start].text);
  await playUntilResult(g2.win, () => 0); // نفس قرارات الصديق بالظبط
  const cmpHtml = $id(g2.doc, 'compareWrap').innerHTML;
  check('بطاقة المقارنة ظهرت بعد إنهاء نفس التحدي', cmpHtml.includes('قراراتك'));
  check('مسار مطابق ١٠٠٪؜ → "وصلتو لنفس النهاية"', cmpHtml.includes('وصلتوا لنفس النهاية'));
  const subText = ar2en($id(g2.doc, 'compareWrap').textContent);
  const m = subText.match(/(\d+)\s*مرة.*?(\d+).*?واختلفو[^\d]*(\d+)/s) || subText.match(/مره?\D*(\d+)\D+(\d+)\D+(\d+)/s);
  check('أرقام المقارنة متسقة (اتفاق كامل، صفر اختلافات)', !!m && (+m[1]) === frSum.history.length && (+m[2]) === (+m[1]));
  check('نهايتك = نهاية الصديق في المسار المطابق', $id(g2.doc, 'endingTitle').textContent === frSum.endingTitle);
  g2.win.close();

  let g3 = await loadGame(friendPath);
  $id(g3.doc, 'friendBannerBtn').click();
  await sleep(300);
  await playUntilResult(g3.win, (s, n) => n - 1); // اختر آخر اختيار دائمًا
  const sub3 = ar2en($id(g3.doc, 'compareWrap').textContent);
  const nums3 = [...sub3.matchAll(/(\d+)/g)].map((x) => +x[1]);
  check('المقارنة بمسار مختلف: اتفاق+اختلاف = المحطات المشتركة وفيه اختلاف ≥ ١',
    nums3.length >= 3 && (nums3[1] + nums3[2]) === nums3[0] && nums3[2] >= 1);
  if (nums3.length >= 3) console.log('   ↪ اشتراك ' + nums3[0] + ' | اتفاق ' + nums3[1] + ' | اختلاف ' + nums3[2]);
  g3.win.close();

  /* ---------- I: روابط خاطئة ---------- */
  section('I) الروابط غير الصالحة لا تكسّر اللعبة');
  let g4 = await loadGame('/?c=تحدي-مش-موجود');
  await sleep(900);
  check('تحدي وهمي: الرئيسية شغالة عادي', active(g4.doc, 'home') && g4.errors.length === 0);
  check('طلع تنبيه للمستخدم', !$id(g4.doc, 'toast').classList.contains('hidden') &&
    $id(g4.doc, 'toast').textContent.includes('مش موجود'));
  g4.win.close();

  let g5 = await loadGame('/?r=@@%D9%85%D9%87%D8%B1%D8%AC%D8%A7%D9%86!!!');
  await sleep(900);
  check('نتيجة وهمية: لا بانر صديق ولا كراش', $id(g5.doc, 'friendBanner').classList.contains('hidden') && g5.errors.length === 0);
  check('تنبيه بأن رابط النتيجة غير صالح', $id(g5.doc, 'toast').textContent.includes('مش صالح'));
  // ولسه يقدر يلعب عادي
  g5.doc.querySelector('[data-start="last-train"]').click();
  await sleep(300);
  check('ويقدر يبدأ لعب طبيعي', active(g5.doc, 'game'));
  g5.win.close();

  console.log('\n════════════════════════════════════');
  console.log('النتيجة: نجح ' + passed + ' | فشل ' + failed);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('💥 انهار الاختبار:', e); process.exit(2); });
