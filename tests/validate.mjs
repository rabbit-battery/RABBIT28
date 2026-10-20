/**
 * اختبار آلي شامل: يمشي فعليًا في *كل* مسار لعبة ممكن في كل تحدي،
 * ويتحقق من:
 *  - كل مسار ينتهي عند نهاية صحيحة موجودة (لا شاشات فارغة)
 *  - طول الجولة بين 5 و 7 قرارات
 *  - كل مرحلة فيها 2 إلى 4 اختيارات
 *  - كل الإشارات (next) تشير لعقد/نهايات موجودة
 *  - كل عقدة قابلة للوصول، وكل نهاية قابلة للتحقيق فعليًا
 *  - لا تتكرر مرحلة داخل نفس الجولة
 *  - مفاتيح المتغيرات صحيحة، ونظام الألقاب والمشاركة يعمل
 * التشغيل: npm test
 */
import { CHALLENGES, getDailyChallenge } from "../src/content/index.js";
import { createRun, applyChoice, allPossibleNext, resolveNext, computeTitle, buildResult, END_PREFIX } from "../src/lib/engine.js";
import { STAT_KEYS } from "../src/content/titles.js";
import { encodeResult, decodeResult, buildShareUrl } from "../src/lib/share.js";

let failures = 0;
function fail(msg) {
  failures++;
  console.error("  ✗ " + msg);
}
function ok(msg) {
  console.log("  ✓ " + msg);
}

for (const ch of CHALLENGES) {
  console.log(`\n═══ التحدي: ${ch.title} (${ch.id}) ═══`);

  // --- فحوص بنيوية ---
  const nodeIds = Object.keys(ch.nodes);
  const endingIds = Object.keys(ch.endings);
  if (!ch.nodes[ch.startNode]) fail(`عقدة البداية '${ch.startNode}' غير موجودة`);
  if (endingIds.length < 4) fail(`عدد النهايات ${endingIds.length} — المطلوب 4 على الأقل`);
  else ok(`${endingIds.length} نهايات مختلفة`);

  for (const [nid, node] of Object.entries(ch.nodes)) {
    if (!node.text || node.text.length < 20) fail(`عقدة ${nid}: نص القصة قصير/مفقود`);
    if (!node.choices || node.choices.length < 2 || node.choices.length > 4)
      fail(`عقدة ${nid}: الاختيارات يجب أن تكون 2-4 (موجود: ${node.choices?.length})`);
    for (const [i, c] of (node.choices || []).entries()) {
      if (!c.text) fail(`عقدة ${nid} اختيار ${i + 1}: بلا نص`);
      for (const k of Object.keys(c.effects || {}))
        if (!STAT_KEYS.includes(k)) fail(`عقدة ${nid} اختيار ${i + 1}: متغير مجهول '${k}'`);
      for (const dest of allPossibleNext(c)) {
        if (dest.startsWith(END_PREFIX)) {
          if (!ch.endings[dest.slice(END_PREFIX.length)]) fail(`عقدة ${nid}: نهاية مفقودة '${dest}'`);
        } else if (!ch.nodes[dest]) {
          fail(`عقدة ${nid}: وجهة مفقودة '${dest}'`);
        }
      }
    }
  }

  // --- تعداد كل المسارات الممكنة (DFS بقيم متغيرات حقيقية) ---
  let pathCount = 0;
  let minLen = Infinity;
  let maxLen = 0;
  const endingsHit = new Map();
  const nodesVisited = new Set();

  function dfs(run) {
    if (run.done) {
      pathCount++;
      const len = run.history.length;
      minLen = Math.min(minLen, len);
      maxLen = Math.max(maxLen, len);
      endingsHit.set(run.endingId, (endingsHit.get(run.endingId) || 0) + 1);
      if (!ch.endings[run.endingId]) fail(`مسار انتهى عند نهاية غير موجودة: ${run.endingId}`);
      const ids = run.history.map((h) => h.nodeId);
      if (new Set(ids).size !== ids.length) fail(`تكرار مرحلة داخل جولة واحدة: ${ids.join(" -> ")}`);
      if (len < 5 || len > 7) fail(`طول جولة غير مطابق (${len} قرارات): ${ids.join(" -> ")}`);
      // بناء النتيجة واللقب يجب ألا يرمي استثناء
      const result = buildResult(ch, run);
      if (!result.titleName) fail("نتيجة بلا لقب");
      return;
    }
    nodesVisited.add(run.nodeId);
    const node = ch.nodes[run.nodeId];
    node.choices.forEach((_, i) => {
      try {
        dfs(applyChoice(ch, run, i));
      } catch (e) {
        fail(`استثناء أثناء تطبيق اختيار في عقدة ${run.nodeId}: ${e.message}`);
      }
    });
  }

  if (ch.nodes[ch.startNode]) dfs(createRun(ch));

  ok(`تم تعداد ${pathCount} مسارًا كاملًا — طول الجولة من ${minLen} إلى ${maxLen} قرارات`);
  for (const nid of nodeIds) if (!nodesVisited.has(nid)) fail(`عقدة لا يمكن الوصول إليها أبدًا: ${nid}`);
  ok(`كل المراحل (${nodeIds.length}) قابلة للوصول`);
  for (const eid of endingIds)
    if (!endingsHit.has(eid)) fail(`نهاية لا يصل إليها أي مسار فعلي: ${eid} (${ch.endings[eid].title})`);
  for (const [eid, count] of [...endingsHit.entries()].sort((a, b) => b[1] - a[1]))
    ok(`النهاية «${ch.endings[eid].title}» تتحقق في ${count} مسارًا`);
}

// --- نظام الألقاب ---
console.log("\n═══ نظام الألقاب ═══");
const probes = [
  { bold: 10, coop: 0, caution: 0, sacrifice: 0 },
  { bold: 0, coop: 9, caution: 1, sacrifice: 1 },
  { bold: 5, coop: 5, caution: 0, sacrifice: 0 },
  { bold: 0, coop: 0, caution: 0, sacrifice: 0 },
  { bold: 3, coop: 3, caution: 3, sacrifice: 3 },
  { bold: 0, coop: 4, caution: 0, sacrifice: 5 },
];
for (const s of probes) {
  const t = computeTitle(s);
  if (!t || !t.name) fail(`لقب غير صالح للقيم ${JSON.stringify(s)}`);
  else ok(`${JSON.stringify(s)} ← «${t.name}»`);
}

// --- مشاركة النتيجة عبر الرابط (ذهاب وعودة + روابط تالفة) ---
console.log("\n═══ مشاركة الرابط ═══");
{
  const ch = CHALLENGES[0];
  let run = createRun(ch);
  while (!run.done) run = applyChoice(ch, run, 0);
  const result = buildResult(ch, run);
  const encoded = encodeResult(result);
  const decoded = decodeResult(encoded, CHALLENGES);
  if (!decoded || decoded.endingId !== result.endingId || decoded.titleKey !== result.titleKey)
    fail("تشفير/فك تشفير نتيجة المشاركة غير متطابق");
  else ok(`الرابط يحمل النتيجة ويفكّها بنجاح (~${encoded.length} حرفًا في الباراميتر)`);
  if (decodeResult("%%%invalid%%%", CHALLENGES) !== null) fail("رابط التالف يجب أن يُتجاهل");
  if (decodeResult("", CHALLENGES) !== null) fail("رابط فارغ يجب أن يُتجاهل");
  if (decodeResult("AAAA", CHALLENGES) !== null) fail("بيانات عشوائية يجب أن تُرفض");
  ok("الروابط غير الصالحة/التالفة تُتجاهل بأمان دون كسر الموقع");
  const url = buildShareUrl("https://example.com/?foo=1", { challengeId: ch.id, result });
  if (!url.includes("c=" + ch.id) || !url.includes("r=")) fail("بناء رابط المشاركة ناقص");
  else ok("رابط المشاركة يحتوي معرّف التحدي ونتيجة الصديق");
}

// تحدي اليوم ثابت خلال اليوم وصحيح النوع
if (!getDailyChallenge()) fail("تحدي اليوم غير صالح");
else ok(`تحدي اليوم يتبدل تلقائيًا (اليوم: ${getDailyChallenge().title})`);

console.log(failures === 0 ? "\n🎉 كل الاختبارات نجحت!" : `\n💥 فشل ${failures} فحص — يجب الإصلاح قبل النشر`);
process.exit(failures === 0 ? 0 : 1);
