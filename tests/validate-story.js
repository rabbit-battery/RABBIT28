/* ============================================================
   LOOP — اختبارات آلية لسلامة القصص والمحرك
   التشغيل:  node tests/validate-story.js
   يفحص:
   1) كل مرجع (next) يشير لعقدة موجودة فعلًا
   2) كل عقدة قرار فيها ٢–٤ اختيارات، والنهايات مفيهاش اختيارات
   3) كل المسارات الممكنة تنتهي بنهاية سليمة، بطول ٥–٧ قرارات
   4) مافيش تكرار لعقدة داخل نفس الجولة
   5) كل العقد قابلة للوصول من البداية، وعندنا ٤ نهايات على الأقل
   6) قيم التأثيرات (effects) سليمة ونطاقاتها معقولة
   7) محاكاة ٥٠٠ جولة عشوائية بمحرك اللعبة نفسه لكل تحدي
   8) ترميز/فك رابط النتيجة (المشاركة والمقارنة)
   ============================================================ */
'use strict';

const path = require('path');
const DATA = require(path.join(__dirname, '..', 'js', 'data', 'challenges.js'));
const Engine = require(path.join(__dirname, '..', 'js', 'engine.js'));
const Share = require(path.join(__dirname, '..', 'js', 'share.js'));

let failures = 0;
function fail(msg) { failures++; console.log('❌ ' + msg); }
function ok(msg) { console.log('✅ ' + msg); }

const VALID_STATS = Object.keys(DATA.STATS);

DATA.CHALLENGES.forEach((ch) => {
  console.log('\n=== تحدي: ' + ch.title + ' (' + ch.id + ') ===');
  const nodes = ch.nodes;
  const ids = Object.keys(nodes);

  if (!nodes[ch.start]) fail('عقدة البداية "' + ch.start + '" غير موجودة');

  // --- فحص بنية العقد ---
  let endingCount = 0;
  ids.forEach((id) => {
    const node = nodes[id];
    if (node.ending) {
      endingCount++;
      if (!node.title) fail(id + ': نهاية من غير عنوان');
      if (!node.text) fail(id + ': نهاية من غير نص');
      if (!node.icon) fail(id + ': نهاية من غير أيقونة');
      if (node.choices && node.choices.length) fail(id + ': نهاية وعندها اختيارات؟!');
    } else {
      if (!node.text) fail(id + ': عقدة قرار من غير نص قصصي');
      if (!node.label) fail(id + ': عقدة قرار من غير label');
      if (!node.choices || node.choices.length < 2 || node.choices.length > 4) {
        fail(id + ': عدد الاختيارات لازم يكون ٢–٤ (الفعلي: ' + (node.choices ? node.choices.length : 0) + ')');
      } else {
        node.choices.forEach((c, i) => {
          if (!c.text) fail(id + '[' + i + ']: اختيار من غير نص');
          if (!nodes[c.next]) fail(id + '[' + i + ']: بيشير لعقدة غير موجودة "' + c.next + '"');
          const fx = c.effects || {};
          Object.keys(fx).forEach((k) => {
            if (!VALID_STATS.includes(k)) fail(id + '[' + i + ']: تأثير غير معروف "' + k + '"');
            if (ch.stats && !ch.stats.includes(k)) fail(id + '[' + i + ']: تأثير خارج أبعاد التحدي "' + k + '"');
            if (!Number.isInteger(fx[k]) || fx[k] < 1 || fx[k] > 3) fail(id + '[' + i + ']: قيمة تأثير غريبة لـ ' + k + ' = ' + fx[k]);
          });
          if (!Object.keys(fx).length) fail(id + '[' + i + ']: اختيار بدون أي تأثير على المتغيرات');
        });
        if (ch.timer) {
          const hesitant = node.choices.filter((c) => c.hesitate === true).length;
          if (hesitant !== 1) fail(id + ': تحدي المؤقّت لازم اختيار "تجمد/تردد" واحد بس لكل عقدة (الفعلي: ' + hesitant + ')');
        }
      }
    }
  });
  if (endingCount < 4) fail('عدد النهايات ' + endingCount + ' أقل من ٤');
  else ok('عدد النهايات المعرفة: ' + endingCount);

  // --- تتبّع كل المسارات الممكنة (DFS) ---
  const reached = new Set();
  const reachedEndings = new Set();
  let totalPaths = 0, minLen = Infinity, maxLen = 0;
  function dfs(nodeId, visited, depth) {
    const node = nodes[nodeId];
    if (!node) { fail('وصلنا لعقدة مش موجودة: ' + nodeId); return; }
    reached.add(nodeId);
    if (node.ending) {
      reachedEndings.add(nodeId);
      totalPaths++;
      minLen = Math.min(minLen, depth);
      maxLen = Math.max(maxLen, depth);
      const st = ch.stages || { min: 5, max: 7 };
      if (depth < st.min || depth > st.max) fail('مسار طوله ' + depth + ' قرارات (المطلوب ' + st.min + '–' + st.max + ') ينتهي عند ' + nodeId);
      return;
    }
    if (depth > 14) { fail('مسار أطول من اللازم عند ' + nodeId + ' — احتمال لوب لا نهائي'); return; }
    (node.choices || []).forEach((c) => {
      if (visited.has(c.next)) { fail('تكرار عقدة داخل جولة واحدة: ' + c.next); return; }
      const v2 = new Set(visited); v2.add(c.next);
      dfs(c.next, v2, depth + 1);
    });
  }
  dfs(ch.start, new Set([ch.start]), 0);

  const unreached = ids.filter((id) => !reached.has(id));
  if (unreached.length) fail('عقد لا يمكن الوصول لها: ' + unreached.join(', '));
  else ok('كل العقد (' + ids.length + ') قابلة للوصول من البداية');

  console.log('   📊 إجمالي المسارات الممكنة: ' + totalPaths +
    ' | أقصر مسار: ' + minLen + ' قرارات | أطول مسار: ' + maxLen + ' قرارات');
  console.log('   🏁 نهايات قابلة للوصول: ' + reachedEndings.size + ' → ' +
    [...reachedEndings].map((e) => nodes[e].title).join(' | '));
  if (reachedEndings.size < 4) fail('نهايات قابلة للوصول أقل من ٤');

  // --- محاكاة جولات عشوائية بالمحرك نفسه ---
  for (let run = 0; run < 500; run++) {
    let state = Engine.createRun(ch.id);
    let guard = 0;
    while (!state.finished && guard++ < 20) {
      const node = ch.nodes[state.nodeId];
      const idx = Math.floor(Math.random() * node.choices.length);
      const next = Engine.applyChoice(state, idx);
      if (!next) { fail('المحرك رجّع null عند ' + state.nodeId + ' اختيار ' + idx); break; }
      state = next;
    }
    if (!state.finished) { fail('جولة عشوائية ما خلصتش'); break; }
    const summary = Engine.summarizeRun(state);
    if (!summary || !summary.endingTitle || !summary.title.name) { fail('ملخص نتيجة ناقص في محاكاة عشوائية'); break; }
    if (!Engine.getTitleByKey(summary.title.key)) { fail('لقب غير معروف: ' + summary.title.key); break; }
    // الملف النفسي لازم يتبني دائمًا بشكل سليم
    const prof = summary.profile;
    const expectedDims = (ch.stats || []).length || Object.keys(DATA.STATS).length;
    if (!prof || !Array.isArray(prof.dimensions) || prof.dimensions.length !== expectedDims) {
      fail('ملف نفسي ناقص الأبعاد (' + (prof && prof.dimensions.length) + ' متوقع ' + expectedDims + ')'); break;
    }
    if (!prof.dimensions.every((d) => d.narrative && d.narrative.length > 10)) { fail('بعد نفسي من غير تفسير'); break; }
    if (!Array.isArray(prof.observations)) { fail('ملاحظات سلوكية مش مصفوفة'); break; }
    if (ch.deep && !prof.archetype) { fail('وضع deep وما طلعش نمط شخصية'); break; }
    if (ch.deep && !DATA.PROFILE.archetypes.some((a) => a.id === prof.archetype.id)) { fail('نمط وهمي: ' + prof.archetype.id); break; }
  }
  ok('٥٠٠ جولة عشوائية اكتملت بنجاح عبر المحرك (شاملة بناء الملف النفسي)');

  // --- فحص المؤقّت والتردد والتوقيتات عبر المحرك نفسه ---
  if (ch.timer) {
    let tRun = Engine.createRun(ch.id);
    let guard = 0;
    while (!tRun.finished && guard++ < 20) {
      tRun = Engine.applyChoice(tRun, 0, { timeMs: 2500, timedOut: guard === 1 });
    }
    const tSum = Engine.summarizeRun(tRun);
    if (!tSum || tSum.profile.metrics.timeouts !== 1) fail('المؤقّت: التجمد ما اتسجلش في القياسات');
    else if (tSum.profile.metrics.avgDecisionMs !== 2500) fail('المؤقّت: متوسط سرعة القرار غلط');
    else ok('قياسات المؤقّت والتجمد وسرعة القرار تُسجَّل صح');
  }

  // --- ترميز/فك رابط النتيجة + المقارنة ---
  let demo = Engine.createRun(ch.id);
  let g2 = 0;
  while (!demo.finished && g2++ < 20) demo = Engine.applyChoice(demo, 0);
  const demoSummary = Engine.summarizeRun(demo);
  const payload = {
    v: 1, g: demoSummary.challengeId, e: demoSummary.endingId,
    t: demoSummary.title.key, s: demoSummary.stats,
    p: demoSummary.history.map((h) => ({ n: h.nodeId, c: h.choiceIndex }))
  };
  const enc = Share.encodePayload(payload);
  const dec = Share.decodePayload(enc);
  if (!dec || dec.e !== payload.e || dec.p.length !== payload.p.length) fail('ترميز/فك رابط النتيجة فشل');
  else ok('رابط النتيجة: ترميز وفك سليم (طول الكود ' + enc.length + ' حرف)');

  const cmp = Share.compareWithFriend(demoSummary.history, { path: payload.p });
  if (cmp.same !== cmp.shared || cmp.shared !== payload.p.length) fail('مقارنة الأصدقاء: اللاعب ضد نفسه لازم اتفاق كامل');
  else ok('مقارنة الأصدقاء تعمل (اتفاق كامل عند تطابق المسار)');
});

// --- تحديات "قريبًا" لا تتعارض مع التحديات الحقيقية ---
DATA.COMING_SOON.forEach((s) => {
  if (Engine.getChallenge(s.id)) fail('تحدي "قريبًا" بمعرّف لعبة حقيقي: ' + s.id);
});
ok('قائمة "قريبًا" منفصلة تمامًا عن التحديات القابلة للعب');

console.log('\n' + (failures ? '💥 فشل ' + failures + ' فحص — لازم يتصلح قبل النشر' : '🎉 كل الفحوصات نجحت. اللعبة سليمة من كل المسارات.'));
process.exit(failures ? 1 : 0);
