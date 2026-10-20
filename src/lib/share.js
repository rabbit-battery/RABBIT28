/**
 * مشاركة النتيجة عبر الرابط نفسه — بدون قاعدة بيانات.
 * تُشفَّر النتيجة (التحدي، النهاية، اللقب، المتغيرات) داخل باراميتر ?r=
 * فيتمكن صديقك عند فتح الرابط من رؤية نتيجتك ومقارنتها بنتيجته.
 * لا تُحفظ أي معلومات شخصية داخل الرابط.
 *
 * ملحوظة للمستقبل: عند إضافة قاعدة بيانات (Supabase/Firebase)
 * يمكن استبدال هذا التشفير بمعرّف قصير يُجلب من الخادم،
 * مع الإبقاء على نفس واجهة الدوال هنا.
 */

function toBase64Url(str) {
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return decodeURIComponent(escape(atob(padded)));
}

export function encodeResult(result) {
  const payload = {
    v: 1,
    c: result.challengeId,
    e: result.endingId,
    t: result.titleKey,
    s: [result.stats.bold | 0, result.stats.coop | 0, result.stats.caution | 0, result.stats.sacrifice | 0],
  };
  return toBase64Url(JSON.stringify(payload));
}

/** إعادة بناء نتيجة صديق من باراميتر الرابط — آمنة ضد الروابط التالفة */
export function decodeResult(param, challenges) {
  try {
    if (!param || typeof param !== "string" || param.length > 512) return null;
    const p = JSON.parse(fromBase64Url(param));
    if (!p || p.v !== 1) return null;
    const ch = challenges.find((c) => c.id === p.c);
    if (!ch) return null;
    const ending = ch.endings[p.e];
    if (!ending) return null;
    const s = Array.isArray(p.s) ? p.s.slice(0, 4).map((n) => Math.max(0, Math.min(99, n | 0))) : [0, 0, 0, 0];
    return {
      challengeId: ch.id,
      challengeTitle: ch.title,
      endingId: p.e,
      endingTitle: ending.title,
      endingIcon: ending.icon,
      titleKey: String(p.t || "balanced"),
      stats: { bold: s[0], coop: s[1], caution: s[2], sacrifice: s[3] },
    };
  } catch {
    return null;
  }
}

/** بناء رابط المشاركة */
export function buildShareUrl(base, { challengeId, result } = {}) {
  const url = new URL(base);
  url.search = "";
  if (challengeId) url.searchParams.set("c", challengeId);
  if (result) url.searchParams.set("r", encodeResult(result));
  return url.toString();
}

/** نص رسالة المشاركة الجاهز لواتساب وتيليجرام وغيرهما */
export function buildShareText(result) {
  if (!result) return "جرّب لعبة LOOP — اختياراتك بتحكي قصتك! 🌀 قرار واحد ممكن يغيّر كل حاجة.";
  return (
    `لعبت «${result.challengeTitle}» في LOOP ووصلت لنهاية «${result.endingTitle}» ${result.endingIcon} ` +
    `وخدت لقب «${result.titleName}»! تفتكر تقدر توصّل لنهاية مختلفة؟ 🎮`
  );
}

export function whatsappUrl(text, url) {
  return `https://wa.me/?text=${encodeURIComponent(text + "\n" + url)}`;
}
export function telegramUrl(text, url) {
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
}
export function twitterUrl(text, url) {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}
