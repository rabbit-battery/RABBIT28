/**
 * رسم بطاقة النتيجة كصورة (Canvas) بقياس 1080×1350 مناسب للحالات والمنشورات.
 * البطاقة لا تحتوي أي معلومات شخصية — فقط: اللعبة، النهاية، اللقب، وأسلوب اللعب.
 */
import { STATS, STAT_KEYS } from "../content/titles.js";

const W = 1080;
const H = 1350;

export async function renderShareCard({ challenge, result, title, siteLabel }) {
  // التأكد من تحميل الخطوط العربية قبل الرسم حتى تظهر النصوص سليمة
  try {
    await Promise.all([
      document.fonts.load('900 90px Cairo'),
      document.fonts.load('700 44px "IBM Plex Sans Arabic"'),
      document.fonts.load('500 38px "IBM Plex Sans Arabic"'),
    ]);
  } catch {}

  const Canvas = document.createElement("Canvas");
  Canvas.width = W;
  Canvas.height = H;
  const ctx = Canvas.getContext("2d");
  const [c1, c2] = challenge.gradient || ["#7c3aed", "#38bdf8"];

  // الخلفية
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#140b30");
  bg.addColorStop(0.55, "#0a0714");
  bg.addColorStop(1, "#071224");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // توهجات
  glow(ctx, W * 0.15, H * 0.1, 430, c1, 0.5);
  glow(ctx, W * 0.88, H * 0.32, 380, c2, 0.38);
  glow(ctx, W * 0.5, H * 0.95, 460, "#7c3aed", 0.32);

  // نجوم خفيفة
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  for (let i = 0; i < 90; i++) {
    const x = pseudoRand(i * 3 + 1) * W;
    const y = pseudoRand(i * 3 + 2) * H * 0.6;
    const r = 1 + pseudoRand(i * 3 + 3) * 2;
    ctx.globalAlpha = 0.25 + pseudoRand(i + 7) * 0.6;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // إطار
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 3;
  roundRect(ctx, 36, 36, W - 72, H - 72, 46);
  ctx.stroke();

  // الشعار
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = '900 96px Cairo, sans-serif';
  ctx.letterSpacing = "14px";
  ctx.fillText("LOOP", W / 2, 150);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = "rgba(216,205,255,0.85)";
  ctx.font = '600 36px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText("اختياراتك بتحكي قصتك", W / 2, 224);

  // رمز الحلقة ∞
  drawLoop(ctx, W / 2, 330, 92, c1, c2);

  // أيقونة النهاية
  ctx.font = "190px serif";
  ctx.fillText(result.endingIcon || "🏁", W / 2, 520);

  // عبارة النتيجة
  ctx.fillStyle = "#7dd3fc";
  ctx.font = '700 40px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText(`وصلتُ إلى نهاية`, W / 2, 668);

  // اسم النهاية (بتدرّج)
  const grad = ctx.createLinearGradient(W * 0.2, 0, W * 0.8, 0);
  grad.addColorStop(0, "#e9d5ff");
  grad.addColorStop(0.5, "#c084fc");
  grad.addColorStop(1, "#38bdf8");
  ctx.fillStyle = grad;
  ctx.font = '900 104px Cairo, sans-serif';
  ctx.fillText(`«${result.endingTitle}»`, W / 2, 756);

  // اسم التحدي
  ctx.fillStyle = "rgba(245,242,255,0.92)";
  ctx.font = '700 46px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText(`في تحدي «${challenge.title}» ${challenge.icon}`, W / 2, 842);

  // اللقب
  const pillText = `لقبي: ${title.icon} ${title.name}`;
  ctx.font = '800 48px Cairo, "IBM Plex Sans Arabic", sans-serif';
  const pillW = Math.min(W - 180, ctx.measureText(pillText).width + 90);
  const pillX = (W - pillW) / 2;
  const pillGrad = ctx.createLinearGradient(pillX, 0, pillX + pillW, 0);
  pillGrad.addColorStop(0, c1);
  pillGrad.addColorStop(1, c2);
  ctx.fillStyle = pillGrad;
  roundRect(ctx, pillX, 900, pillW, 92, 46);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(pillText, W / 2, 948);

  // أشرطة المتغيرات
  const maxStat = Math.max(8, ...STAT_KEYS.map((k) => result.stats[k] || 0));
  let y = 1064;
  ctx.font = '700 34px "IBM Plex Sans Arabic", sans-serif';
  for (const key of STAT_KEYS) {
    const v = result.stats[key] || 0;
    const meta = STATS[key];
    ctx.fillStyle = "rgba(245,242,255,0.95)";
    ctx.textAlign = "right";
    ctx.fillText(`${meta.icon} ${meta.label}`, W - 120, y);
    ctx.textAlign = "left";
    ctx.fillText(String(v), 120, y);
    const barX = 190;
    const bw = W - 470; // عرض الشريط (بين القيمة يسارًا واسم المتغير يمينًا)
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    roundRect(ctx, barX, y - 11, bw, 22, 11);
    ctx.fill();
    ctx.fillStyle = meta.color;
    if (v > 0) {
      roundRect(ctx, barX, y - 11, Math.max(26, (bw * v) / maxStat), 22, 11);
      ctx.fill();
    }
    y += 56;
  }
  ctx.textAlign = "center";

  // الذيل: دعوة للتحدي + اسم الموقع
  ctx.fillStyle = "rgba(245,242,255,0.95)";
  ctx.font = '700 42px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText("تفتكر تقدر توصّل لنهاية مختلفة؟ 🎮", W / 2, H - 168);
  ctx.fillStyle = "rgba(125,116,163,0.95)";
  ctx.font = '600 32px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText(siteLabel || "العب دلوقتي في LOOP", W / 2, H - 108);

  return Canvas;
}

function glow(ctx, x, y, r, color, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, hexToRgba(color, alpha));
  g.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function drawLoop(ctx, cx, cy, r, c1, c2) {
  ctx.save();
  ctx.lineWidth = 20;
  ctx.lineCap = "round";
  const g = ctx.createLinearGradient(cx - r * 1.6, cy, cx + r * 1.6, cy);
  g.addColorStop(0, c1);
  g.addColorStop(0.5, "#a855f7");
  g.addColorStop(1, c2);
  ctx.strokeStyle = g;
  ctx.shadowColor = "rgba(168,85,247,0.75)";
  ctx.shadowBlur = 34;
  ctx.beginPath();
  // مسار الليمينسكات (رمز اللانهاية ∞)
  for (let t = 0; t <= Math.PI * 2 + 0.01; t += 0.02) {
    const scale = (r * 1.9) / (1 + Math.sin(t) * Math.sin(t));
    const x = cx + scale * Math.cos(t);
    const yy = cy + scale * Math.sin(t) * Math.cos(t) * 0.92;
    if (t === 0) ctx.moveTo(x, yy);
    else ctx.lineTo(x, yy);
  }
  ctx.stroke();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function pseudoRand(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function CanvasToBlob(Canvas) {
  return new Promise((resolve) => Canvas.toBlob(resolve, "image/png", 0.95));
}
