/**
 * نظام الألقاب الترفيهية.
 * اللقب يُحسب من أعلى متغيرين في نهاية الجولة.
 * ملحوظة: هذه ألقاب للمتعة والمشاركة فقط — ليست تشخيصًا نفسيًا.
 */
export const STATS = {
  bold: { label: "الجرأة", icon: "⚡", color: "#f59e0b" },
  coop: { label: "التعاون", icon: "🤝", color: "#38bdf8" },
  caution: { label: "الحذر", icon: "🛡️", color: "#a78bfa" },
  sacrifice: { label: "التضحية", icon: "💛", color: "#f472b6" },
};

export const STAT_KEYS = Object.keys(STATS);

// ألقاب عندما يطغى متغير واحد بفارق واضح
export const SINGLE_TITLES = {
  bold: { key: "single-bold", name: "القلب الجسور", icon: "🦁", desc: "تقتحم المشهد ولا تنتظر إذن أحد. عندك، التردد هو الخطر الحقيقي." },
  coop: { key: "single-coop", name: "صانع الجسور", icon: "🌉", desc: "قوتك الحقيقية في الناس الذين تجمعهم حولك وتحرّكهم كفريق واحد." },
  caution: { key: "single-caution", name: "العقل الحكيم", icon: "🦉", desc: "خطوة محسوبة واحدة عندك تساوي عشرة ندم. تراقب، تحلّل، ثم تضرب ضربتك." },
  sacrifice: { key: "single-sacrifice", name: "القلب الكبير", icon: "💛", desc: "تقدّم غيرك على نفسك من دون أن تفكّر مرتين. الخير عادة عندك لا قرار صعب." },
};

// ألقاب تركيبية (أعلى متغيرين) — المفتاح مرتّب أبجديًا
export const PAIR_TITLES = {
  "bold+coop": { key: "bold-coop", name: "القائد المُلهِم", icon: "🚩", desc: "شجاعتك معدية وتجعل من حولك أبطالًا. الناس يتبعونك لأنك أول من يخطو." },
  "bold+caution": { key: "bold-caution", name: "المغامر المحسوب", icon: "🎯", desc: "تحب المخاطرة… لكن بخريطة وخطة بديلة. الجرأة والعقل في فريق واحد." },
  "bold+sacrifice": { key: "bold-sacrifice", name: "البطل المُقتحِم", icon: "🦸", desc: "حين تشتدّ اللحظة تجدك في المقدمة تحمل عن غيرك. الأبطال في القصص يشبهونك." },
  "caution+coop": { key: "caution-coop", name: "الدبلوماسي الهادئ", icon: "🕊️", desc: "تُصلح وتُنظّم وتهدّئ الجميع بصبر نادر. في زمن الفوضى، أنت صوت العقل الجماعي." },
  "coop+sacrifice": { key: "coop-sacrifice", name: "سند الجميع", icon: "🏔️", desc: "الكتف الذي يتّكئ عليه كل محتاج. من يعرفك يعرف معنى كلمة «سند»." },
  "caution+sacrifice": { key: "caution-sacrifice", name: "الحارس الوفِيّ", icon: "🗼", desc: "تحمي من تحب بهدوء وثبات، وتدفع من راحتك حتى يناموا بأمان." },
};

export const BALANCED_TITLE = {
  key: "balanced",
  name: "الروح المتوازنة",
  icon: "☯️",
  desc: "لا تقودك صفة واحدة؛ توزع جرأتك وحذرك وعطاءك بحسب الموقف. توازنك نفسه قوة.",
};

export const ALL_TITLES = [
  ...Object.values(SINGLE_TITLES),
  ...Object.values(PAIR_TITLES),
  BALANCED_TITLE,
];

export function getTitleByKey(key) {
  return ALL_TITLES.find((t) => t.key === key) || BALANCED_TITLE;
}
