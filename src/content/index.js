/**
 * سجلّ التحديات — لإضافة تحدي جديد لاحقًا:
 * 1) أنشئ ملف بيانات يشبه ملفات التحديات الحالية في هذا المجلد.
 * 2) استورده هنا وأضفه إلى القائمة.
 * 3) شغّل `npm test` للتأكد أن كل المسارات تصل إلى نهايات صحيحة.
 * لا حاجة لتعديل أي كود في الواجهة.
 */
import lastDecision from "./last-decision.js";
import forgottenIsland from "./forgotten-island.js";
import millionaireDay from "./millionaire-day.js";

export const CHALLENGES = [lastDecision, forgottenIsland, millionaireDay];

export function getChallenge(id) {
  return CHALLENGES.find((c) => c.id === id) || null;
}

/** تحدي اليوم: يتبدل يوميًا بالتناوب بين التحديات بشكل ثابت لكل يوم */
export function getDailyChallenge(date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 86400000);
  const index = ((dayOfYear % CHALLENGES.length) + CHALLENGES.length) % CHALLENGES.length;
  return CHALLENGES[index];
}
