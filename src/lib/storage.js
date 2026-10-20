/**
 * التخزين المحلي (localStorage) — تقدم الجولة والنتائج السابقة.
 * كل البيانات تبقى على جهاز اللاعب فقط في هذه النسخة.
 *
 * نقطة التوسع المستقبلية: لاستبدال/توسيع التخزين بقاعدة بيانات
 * مركزية (مثل Supabase)، نفّذ واجهة الدوال نفسها هنا
 * (saveResult/getResults...) دون تعديل باقي الكود.
 */
const RESULT_KEY = "loop.results.v1";
const PROGRESS_PREFIX = "loop.progress.v1.";

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

/** حفظ تقدم جولة جارية ليتمكن اللاعب من الاستكمال */
export function saveProgress(challengeId, run) {
  try {
    if (!run || run.done) {
      localStorage.removeItem(PROGRESS_PREFIX + challengeId);
      return;
    }
    localStorage.setItem(PROGRESS_PREFIX + challengeId, JSON.stringify(run));
  } catch {
    /* التخزين ممتلئ أو محظور — نتجاوز بصمت */
  }
}

export function loadProgress(challengeId) {
  try {
    const run = safeParse(localStorage.getItem(PROGRESS_PREFIX + challengeId), null);
    if (!run || run.challengeId !== challengeId || run.done || !run.nodeId) return null;
    return run;
  } catch {
    return null;
  }
}

export function clearProgress(challengeId) {
  try {
    localStorage.removeItem(PROGRESS_PREFIX + challengeId);
  } catch {}
}

/** حفظ نتيجة جولة منتهية (آخر نتيجة لكل تحدي + عدد مرات اللعب) */
export function saveResult(result) {
  try {
    const all = getResultsMap();
    const prev = all[result.challengeId];
    all[result.challengeId] = {
      ...result,
      plays: (prev?.plays || 0) + 1,
      endingsSeen: Array.from(new Set([...(prev?.endingsSeen || []), result.endingId])),
    };
    localStorage.setItem(RESULT_KEY, JSON.stringify(all));
    return all[result.challengeId];
  } catch {
    return result;
  }
}

export function getResultsMap() {
  try {
    return safeParse(localStorage.getItem(RESULT_KEY), {}) || {};
  } catch {
    return {};
  }
}

export function getStoredResult(challengeId) {
  return getResultsMap()[challengeId] || null;
}
