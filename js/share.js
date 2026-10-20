/* ============================================================
   LOOP — المشاركة الاجتماعية
   ------------------------------------------------------------
   - رابط اللعبة:            ?c=<challengeId>
   - رابط نتيجة صديق:        ?c=<id>&r=<نتيجة مشفرة base64url>
     النتيجة المشفرة تحتوي فقط على: التحدي، النهاية، اللقب،
     القيم الأربعة، ومسار الاختيارات (للمقارنة). بدون أي
     معلومات شخصية، وبدون أي خادم: البيانات تسافر داخل الرابط.
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- ترميز/فك ترميز آمن للرابط ويدعم العربية ----------
     مهم: بنستخدم TextEncoder + btoa (معايير ويب تعمل في المتصفح
     وفي Node معًا). لا تستخدم Buffer هنا أبدًا — Buffer موجودة
     في Node بس، واستخدامها هيكسّر المشاركة على الموبايل/المتصفح. */
  function encodePayload(obj) {
    var json = JSON.stringify(obj);
    var bytes = new TextEncoder().encode(json);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    var b64 = btoa(bin);
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodePayload(str) {
    try {
      var b64 = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var json = new TextDecoder().decode(bytes);
      return JSON.parse(json);
    } catch (e) { return null; }
  }

  /* ---------- بناء الروابط ---------- */
  function baseUrl() {
    if (typeof location === 'undefined') return '';
    // عند فتح الملف مباشرة (file://) تكون origin قيمتها 'null' — نتعامل معاها
    if (location.origin && location.origin !== 'null') return location.origin + location.pathname;
    return location.href.split(/[?#]/)[0];
  }

  function buildGameLink(challengeId) {
    var url = baseUrl();
    return challengeId ? url + '?c=' + encodeURIComponent(challengeId) : url;
  }

  function buildResultLink(result) {
    var payload = {
      v: 1,
      g: result.challengeId,
      e: result.endingId,
      t: result.title.key,
      s: result.stats,
      p: result.history.map(function (h) { return { n: h.nodeId, c: h.choiceIndex }; })
    };
    return baseUrl() + '?c=' + encodeURIComponent(result.challengeId) + '&r=' + encodePayload(payload);
  }

  /* ---------- قراءة بارامترات الرابط عند فتح الصفحة ---------- */
  function parseIncoming() {
    var out = { challengeId: null, friendResult: null, invalidResult: false };
    if (typeof location === 'undefined') return out;
    try {
      var params = new URLSearchParams(location.search);
      out.challengeId = params.get('c');
      var r = params.get('r');
      if (r) {
        var p = decodePayload(r);
        if (p && p.v === 1 && p.g && p.e && p.t && p.s && Array.isArray(p.p)) {
          out.friendResult = {
            challengeId: p.g,
            endingId: p.e,
            titleKey: p.t,
            stats: p.s,
            path: p.p
          };
          if (!out.challengeId) out.challengeId = p.g;
        } else {
          out.invalidResult = true;
        }
      }
    } catch (e) { /* رابط غير صالح: تجاهل بهدوء */ }
    return out;
  }

  /* ---------- مقارنة قراراتك بقرارات صديقك ----------
     نعدّ: كم محطة مررتا بها معًا، وكم مرة اخترتما نفس الاختيار. */
  function compareWithFriend(myHistory, friendResult) {
    var friendMap = {};
    friendResult.path.forEach(function (step) { friendMap[step.n] = step.c; });
    var shared = 0, same = 0, diff = 0;
    myHistory.forEach(function (h) {
      if (friendMap[h.nodeId] !== undefined) {
        shared++;
        if (friendMap[h.nodeId] === h.choiceIndex) same++; else diff++;
      }
    });
    var sameEnding = false; // تُحسب في الواجهة من endingId
    return { shared: shared, same: same, diff: diff, sameEnding: sameEnding };
  }

  /* ---------- نسخ النص (Clipboard API + بديل قديم) ---------- */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; })
        .catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  /* ---------- مشاركة عامة: Web Share API أو نسخ ---------- */
  function shareLink(url, text, title) {
    if (navigator.share) {
      return navigator.share({ title: title || 'LOOP', text: text, url: url })
        .then(function () { return 'shared'; })
        .catch(function (err) {
          if (err && err.name === 'AbortError') return 'cancelled';
          return copyText(url).then(function (ok) { return ok ? 'copied' : 'failed'; });
        });
    }
    return copyText(url).then(function (ok) { return ok ? 'copied' : 'failed'; });
  }

  function whatsappLink(url, text) {
    return 'https://wa.me/?text=' + encodeURIComponent(text + '\n' + url);
  }
  function telegramLink(url, text) {
    return 'https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(text);
  }

  /* ---------- نصوص مشاركة جاهزة (بدون أرقام أو إحصاءات وهمية) ---------- */
  function gameShareText(challenge) {
    return challenge
      ? 'بيلّعبوا تحدي «' + challenge.title + '» في لعبة LOOP 🎮 قراراتك فيها بتحكي قصتك... جرب توصل لأي نهاية!'
      : 'لعبة LOOP 🎮 لعبة قرارات، قرار واحد ممكن يغيّر كل حاجة. اختياراتك بتحكي قصتك... جرّب بنفسك!';
  }
  function resultShareText(result) {
    return 'خلّصت تحدي «' + result.challengeTitle + '» في LOOP ' + result.endingIcon + '\n' +
      'وصلت لنهاية «' + result.endingTitle + '» وخدت لقب «' + result.title.name + '» ' + result.title.icon + '\n' +
      'تفتكر قراراتك هتوصلك لفين؟ العب وقارن نتيجتك بنتيجتي 👇';
  }

  /* ============================================================
     بطاقة النتيجة كصورة (Canvas — بدون مكتبات خارجية)
     ============================================================ */
  function drawResultCard(canvas, result, statsMeta) {
    var W = 1080, H = 1350;
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    if (!ctx) return canvas; // بيئة من غير كانفس: ما نكسّرش أي حاجة

    // خلفية متدرجة داكنة
    var bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#150a33');
    bg.addColorStop(0.55, '#0a0618');
    bg.addColorStop(1, '#062a3a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // توهجات
    function glow(x, y, r, color) {
      var g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    glow(150, 150, 520, 'rgba(139,92,246,0.45)');
    glow(980, 1150, 520, 'rgba(34,211,238,0.30)');

    // شعار LOOP
    ctx.direction = 'ltr';
    ctx.textAlign = 'center';
    var logoGrad = ctx.createLinearGradient(300, 0, 780, 0);
    logoGrad.addColorStop(0, '#a78bfa');
    logoGrad.addColorStop(1, '#22d3ee');
    ctx.fillStyle = logoGrad;
    ctx.font = '900 150px Cairo, Tahoma, sans-serif';
    ctx.fillText('LOOP', W / 2, 230);

    ctx.direction = 'rtl';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '600 44px Cairo, Tahoma, sans-serif';
    ctx.fillText('اختياراتك بتحكي قصتك', W / 2, 310);

    // اسم التحدي
    ctx.fillStyle = '#22d3ee';
    ctx.font = '700 52px Cairo, Tahoma, sans-serif';
    ctx.fillText('تحدي «' + result.challengeTitle + '»', W / 2, 430);

    // النهاية
    ctx.font = '120px serif';
    ctx.fillText(result.endingIcon, W / 2, 600);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 96px Cairo, Tahoma, sans-serif';
    ctx.fillText(result.endingTitle, W / 2, 720);

    // اللقب
    ctx.fillStyle = '#ffd166';
    ctx.font = '800 64px Cairo, Tahoma, sans-serif';
    ctx.fillText(result.title.icon + ' ' + result.title.name, W / 2, 830);

    // أشرطة القيم
    var keys = Object.keys(statsMeta);
    var max = 1;
    keys.forEach(function (k) { max = Math.max(max, result.stats[k] || 0); });
    var barX = 140, barW = 560, labelX = 760, y = 920;
    keys.forEach(function (k) {
      var meta = statsMeta[k];
      var val = result.stats[k] || 0;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '700 46px Cairo, Tahoma, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(meta.icon + ' ' + meta.label, labelX + 180, y + 16);
      ctx.textAlign = 'center';
      // خلفية الشريط
      roundRect(ctx, barX, y - 28, barW, 40, 20);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fill();
      // قيمة الشريط
      var w = Math.max(40, (val / max) * barW);
      roundRect(ctx, barX, y - 28, w, 40, 20);
      ctx.fillStyle = meta.color;
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '800 44px Cairo, Tahoma, sans-serif';
      ctx.fillText(String(val), barX - 55, y + 16); // يسار الشريط — عشان ما يزحمش اسم القيمة
      y += 92;
    });

    // سطر التحدي أصدقائك
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '700 50px Cairo, Tahoma, sans-serif';
    ctx.fillText('قرار واحد ممكن يغيّر كل حاجة... دورك دلوقتي', W / 2, y + 70);

    return canvas;
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

  function canvasToBlob(canvas) {
    return new Promise(function (resolve) {
      if (canvas.toBlob) canvas.toBlob(function (b) { resolve(b); }, 'image/png');
      else resolve(null);
    });
  }

  var Share = {
    encodePayload: encodePayload,
    decodePayload: decodePayload,
    buildGameLink: buildGameLink,
    buildResultLink: buildResultLink,
    parseIncoming: parseIncoming,
    compareWithFriend: compareWithFriend,
    copyText: copyText,
    shareLink: shareLink,
    whatsappLink: whatsappLink,
    telegramLink: telegramLink,
    gameShareText: gameShareText,
    resultShareText: resultShareText,
    drawResultCard: drawResultCard,
    canvasToBlob: canvasToBlob
  };

  global.LOOP_SHARE = Share;
  if (typeof module !== 'undefined' && module.exports) module.exports = Share;
})(typeof window !== 'undefined' ? window : globalThis);
