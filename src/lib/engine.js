/**
 * محرك القرارات — منطق اللعبة النقي (بدون أي اعتماد على الواجهة).
 * يمكن اختباره تلقائيًا واستخدامه مستقبلًا مع أي واجهة أو قاعدة بيانات.
 */
import { STAT_KEYS, SINGLE_TITLES, PAIR_TITLES, BALANCED_TITLE } from "../content/titles.js";

export const END_PREFIX = "end:";

export function emptyStats() {
  const s = {};
  for (const k of STAT_KEYS) s[k] = 0;
  return s;
}

/** إنشاء جولة جديدة */
export function createRun(challenge) {
  return {
    challengeId: challenge.id,
    nodeId: challenge.startNode,
    stats: emptyStats(),
    step: 1, // رقم المرحلة الحالية المعروضة
    history: [], // [{ nodeId, nodeTitle, choiceText, choiceIcon, effects }]
    lastEcho: null, // جملة أثر آخر قرار
    done: false,
    endingId: null,
    startedAt: Date.now(),
  };
}

function checkWhen(when, stats) {
  if (!when) return true;
  if (when.stat) {
    const v = stats[when.stat] || 0;
    if (when.min != null && v < when.min) return false;
    if (when.max != null && v > when.max) return false;
    return true;
  }
  if (when.sum) {
    const total = when.sum.reduce((acc, s) => acc + (stats[s] || 0), 0);
    if (when.min != null && total < when.min) return false;
    if (when.max != null && total > when.max) return false;
    return true;
  }
  return true;
}

/**
 * حسم وجهة الاختيار التالية بناءً على المتغيرات الحالية
 * (تُطبَّق آثار الاختيار الحالي على stats قبل الحسم).
 * يُعيد سلسلة نصية: معرّف عقدة أو "end:معرّف النهاية".
 */
export function resolveNext(choice, stats) {
  const nx = choice.next;
  if (typeof nx === "string") return nx;
  if (Array.isArray(nx)) {
    for (const rule of nx) {
      if (checkWhen(rule.when, stats)) return rule.go;
    }
    return nx[nx.length - 1]?.go;
  }
  throw new Error("Choice has invalid `next`: " + JSON.stringify(nx));
}

/** كل الوجهات المحتملة نظريًا لأي اختيار (تُستخدم في الاختبارات) */
export function allPossibleNext(choice) {
  const nx = choice.next;
  if (typeof nx === "string") return [nx];
  if (Array.isArray(nx)) return nx.map((r) => r.go);
  return [];
}

/**
 * تطبيق اختيار اللاعب على الجولة الحالية (يُعدّل نسخة ولا يلمس الأصل).
 * @returns الجولة الجديدة بعد الاختيار
 */
export function applyChoice(challenge, run, choiceIndex) {
  if (run.done) throw new Error("Run already finished");
  const node = challenge.nodes[run.nodeId];
  if (!node) throw new Error("Unknown node: " + run.nodeId);
  const choice = node.choices[choiceIndex];
  if (!choice) throw new Error("Choice index out of range");

  const stats = { ...run.stats };
  for (const [k, v] of Object.entries(choice.effects || {})) {
    if (!(k in stats)) throw new Error("Unknown stat: " + k);
    stats[k] += v;
  }

  const next = resolveNext(choice, stats);
  const nextRun = {
    ...run,
    stats,
    history: [
      ...run.history,
      {
        nodeId: run.nodeId,
        nodeTitle: node.title,
        scene: node.scene,
        choiceText: choice.text,
        choiceIcon: choice.icon || "👉",
        effects: choice.effects || {},
      },
    ],
    lastEcho: choice.echo || null,
  };

  if (typeof next === "string" && next.startsWith(END_PREFIX)) {
    nextRun.done = true;
    nextRun.endingId = next.slice(END_PREFIX.length);
    nextRun.nodeId = null;
  } else {
    nextRun.nodeId = next;
    nextRun.step = run.step + 1;
  }
  return nextRun;
}

/**
 * حساب اللقب الترفيهي من المتغيرات.
 * - إن تفوّق متغير واحد بفارق ≥ 3 عن الثاني -> لقب مفرد
 * - غير ذلك -> لقب تركيبي من أعلى متغيرين
 * - تساوي كامل (الكل صفر مثلاً) -> المتوازن
 */
export function computeTitle(stats) {
  const entries = STAT_KEYS.map((k) => ({ key: k, value: stats[k] || 0 })).sort(
    (a, b) => b.value - a.value
  );
  const [first, second] = entries;
  if (first.value <= 0) return BALANCED_TITLE;
  if (first.value - second.value >= 3) return SINGLE_TITLES[first.key];
  const pairKey = [first.key, second.key].sort().join("+");
  return PAIR_TITLES[pairKey] || BALANCED_TITLE;
}

/** أهم قرارات الجولة (حسب مجموع مقدار آثارها) — للاستخدام في ملخص النتيجة */
export function topDecisions(run, limit = 3) {
  return [...run.history]
    .map((h) => ({ ...h, weight: Object.values(h.effects || {}).reduce((a, b) => a + Math.abs(b), 0) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
}

/**
 * نتيجة الجولة الكاملة عند انتهائها (شكل موحّد يصلح للمشاركة والتخزين لاحقًا).
 */
export function buildResult(challenge, run) {
  if (!run.done) throw new Error("Run not finished");
  const title = computeTitle(run.stats);
  const ending = challenge.endings[run.endingId];
  return {
    challengeId: challenge.id,
    challengeTitle: challenge.title,
    endingId: run.endingId,
    endingTitle: ending?.title || "",
    endingIcon: ending?.icon || "🏁",
    titleKey: title.key,
    titleName: title.name,
    stats: { ...run.stats },
    decisions: run.history.length,
    finishedAt: Date.now(),
  };
}
