/* ============================================================
   LOOP — محرك القرارات (منطق نقي، بدون أي اعتماد على DOM)
   يعمل في المتصفح وفي Node.js (للاختبارات).
   ============================================================ */
(function (global) {
  'use strict';

  var DATA = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./data/challenges.js')
    : global.LOOP_DATA;

  function getChallenge(challengeId) {
    for (var i = 0; i < DATA.CHALLENGES.length; i++) {
      if (DATA.CHALLENGES[i].id === challengeId) return DATA.CHALLENGES[i];
    }
    return null;
  }

  function emptyStats() {
    var s = {};
    Object.keys(DATA.STATS).forEach(function (k) { s[k] = 0; });
    return s;
  }

  /* مفاتيح أبعاد تحدي معين (أو كل الأبعاد لو مش محدد) */
  function statKeysFor(challenge) {
    return (challenge && challenge.stats && challenge.stats.length)
      ? challenge.stats.slice()
      : Object.keys(DATA.STATS);
  }

  /* إنشاء جولة جديدة */
  function createRun(challengeId) {
    var challenge = getChallenge(challengeId);
    if (!challenge) return null;
    return {
      challengeId: challengeId,
      nodeId: challenge.start,
      stats: emptyStats(),
      history: [],        // [{ nodeId, label, choiceIndex, choiceText, effects }]
      lastResult: '',     // سطر نتيجة آخر قرار (يربط القصة ببعضها)
      finished: false,
      endingId: null,
      startedAt: Date.now()
    };
  }

  /* تطبيق اختيار على الجولة وإرجاع حالتها الجديدة.
     meta اختياري: { timeMs: زمن التفكير بالمللي ثانية, timedOut: هل انتهى المؤقّت؟ }
     إرجاع null لو الاختيار أو العقدة غير صالحين. */
  function applyChoice(run, choiceIndex, meta) {
    var challenge = getChallenge(run.challengeId);
    if (!challenge) return null;
    var node = challenge.nodes[run.nodeId];
    if (!node || !node.choices || !node.choices[choiceIndex]) return null;

    var choice = node.choices[choiceIndex];
    var nextNode = challenge.nodes[choice.next];
    if (!nextNode) return null;

    meta = meta || {};
    var timedOut = !!meta.timedOut;
    var timeMs = (typeof meta.timeMs === 'number' && isFinite(meta.timeMs) && meta.timeMs >= 0)
      ? Math.round(meta.timeMs) : null;

    var stats = Object.assign({}, run.stats);
    var effects = choice.effects || {};
    Object.keys(effects).forEach(function (k) {
      stats[k] = (stats[k] || 0) + effects[k];
    });

    var history = run.history.concat([{
      nodeId: run.nodeId,
      label: node.label || '',
      choiceIndex: choiceIndex,
      choiceText: choice.text,
      effects: effects,
      timeMs: timeMs,
      timedOut: timedOut
    }]);

    var lastResult = choice.result || '';
    if (timedOut) {
      lastResult = ('⏱️ انتهى المؤقّت قبل ما تحسم قرارك. التجمّد في اللحظة دي اتسجّل كاختيار... ' + lastResult).trim();
    }

    return {
      challengeId: run.challengeId,
      nodeId: choice.next,
      stats: stats,
      history: history,
      lastResult: lastResult,
      finished: !!nextNode.ending,
      endingId: nextNode.ending ? choice.next : null,
      startedAt: run.startedAt
    };
  }

  /* حساب اللقب الترفيهي من المتغيرات.
     - فرق واضح (>=3) بين الأعلى والتاني → لقب مفرد
     - أعلى تلاتة متقاربين (فرق <=1) → متوازن
     - غير كده → لقب مزدوج من أعلى متغيرين */
  function computeTitleKey(stats) {
    var entries = Object.keys(stats).map(function (k) {
      return { k: k, v: stats[k] || 0 };
    }).sort(function (a, b) { return b.v - a.v; });

    if (!entries.length || entries[0].v <= 0) return 'balanced';
    if (entries[0].v - entries[1].v >= 3) return entries[0].k;
    if (entries[0].v - entries[2].v <= 1) return 'balanced';

    var key = entries[0].k + '+' + entries[1].k;
    var alt = entries[1].k + '+' + entries[0].k;
    if (DATA.TITLES[key]) return key;
    if (DATA.TITLES[alt]) return alt;
    return entries[0].k;
  }

  function getTitle(stats) {
    var key = computeTitleKey(stats);
    var t = DATA.TITLES[key] || DATA.TITLES.balanced;
    return { key: key, name: t.name, icon: t.icon, line: t.line };
  }

  /* أقل عدد قرارات متبقي من كل عقدة لحد نهاية (لشريط التقدم).
     يُحسب بـ BFS عكسية من النهايات. */
  function computeDistances(challenge) {
    var dist = {};
    var queue = [];
    Object.keys(challenge.nodes).forEach(function (id) {
      if (challenge.nodes[id].ending) { dist[id] = 0; queue.push(id); }
    });
    // بناء خريطة عكسية
    var reverse = {};
    Object.keys(challenge.nodes).forEach(function (id) {
      var node = challenge.nodes[id];
      if (!node.choices) return;
      node.choices.forEach(function (c) {
        (reverse[c.next] = reverse[c.next] || []).push(id);
      });
    });
    while (queue.length) {
      var cur = queue.shift();
      (reverse[cur] || []).forEach(function (prev) {
        if (dist[prev] === undefined) {
          dist[prev] = dist[cur] + 1;
          queue.push(prev);
        }
      });
    }
    return dist;
  }

  /* تحدي اليوم: اختيار حتمي حسب تاريخ اليوم (بدون أي خادم) */
  function getDailyChallenge(date) {
    var d = date || new Date();
    var dayNumber = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
    var idx = ((dayNumber % DATA.CHALLENGES.length) + DATA.CHALLENGES.length) % DATA.CHALLENGES.length;
    return DATA.CHALLENGES[idx];
  }

  /* ملخص نتيجة الجولة (يستخدم في شاشة النتيجة والمشاركة) */
  function summarizeRun(run) {
    var challenge = getChallenge(run.challengeId);
    if (!challenge || !run.finished) return null;
    var ending = challenge.nodes[run.endingId];
    var profile = buildProfile(run, challenge);
    var title = profile.archetype
      ? { key: profile.archetype.id, name: profile.archetype.name, icon: profile.archetype.icon, line: profile.archetype.line }
      : getTitle(run.stats);
    return {
      challengeId: run.challengeId,
      challengeTitle: challenge.title,
      endingId: run.endingId,
      endingTitle: ending.title,
      endingIcon: ending.icon,
      endingTone: ending.tone || '',
      endingText: ending.text,
      stats: Object.assign({}, run.stats),
      statKeys: statKeysFor(challenge),
      title: title,
      profile: profile,
      history: run.history.map(function (h) {
        return { nodeId: h.nodeId, label: h.label, choiceIndex: h.choiceIndex, choiceText: h.choiceText };
      })
    };
  }

  /* ==========================================================
     بناء الملف النفسي الترفيهي من سلوك اللعب الفعلي:
     - مستويات الأبعاد وتفسيرها
     - ملاحظات سلوكية (سرعة القرار، التجمد، الثبات، التحولات)
     - أقرب نمط لعب (في وضع "deep")
     ========================================================== */
  function levelOf(value, max) {
    if (max <= 0) return 'mid';
    if (value >= Math.max(4, Math.ceil(max * 0.7))) return 'high';
    if (value <= Math.floor(max * 0.28)) return 'low';
    return 'mid';
  }

  function fillTemplate(tpl, vars) {
    return tpl.replace(/\{(\w+)\}/g, function (m, k) {
      return vars[k] !== undefined ? String(vars[k]) : m;
    });
  }

  function buildProfile(run, challenge) {
    var keys = statKeysFor(challenge);
    var stats = run.stats || {};
    var max = 0;
    keys.forEach(function (k) { max = Math.max(max, stats[k] || 0); });

    var narratives = (DATA.PROFILE && DATA.PROFILE.narratives) || {};
    var levels = {};
    var dimensions = keys.map(function (k) {
      var v = stats[k] || 0;
      var lvl = levelOf(v, max);
      levels[k] = lvl;
      return {
        key: k,
        label: DATA.STATS[k] ? DATA.STATS[k].label : k,
        icon: DATA.STATS[k] ? DATA.STATS[k].icon : '',
        color: DATA.STATS[k] ? DATA.STATS[k].color : '#fff',
        value: v,
        level: lvl,
        narrative: (narratives[k] && narratives[k][lvl]) || ''
      };
    });

    /* --- قياسات سلوكية من السجل --- */
    var history = run.history || [];
    var steps = history.length;
    var timed = history.filter(function (h) { return typeof h.timeMs === 'number'; });
    var timeouts = history.filter(function (h) { return h.timedOut; }).length;
    var avgMs = timed.length
      ? timed.reduce(function (s, h) { return s + h.timeMs; }, 0) / timed.length
      : null;

    var topKey = keys[0], topVal = -1;
    keys.forEach(function (k) { if ((stats[k] || 0) > topVal) { topVal = stats[k] || 0; topKey = k; } });
    var aligned = history.filter(function (h) { return h.effects && (h.effects[topKey] || 0) > 0; }).length;
    var consistency = steps ? aligned / steps : 0;

    function topOfHalves(list) {
      var sums = {};
      list.forEach(function (h) {
        Object.keys(h.effects || {}).forEach(function (k) { sums[k] = (sums[k] || 0) + h.effects[k]; });
      });
      var best = null, bv = -1;
      keys.forEach(function (k) { if ((sums[k] || 0) > bv) { bv = sums[k] || 0; best = k; } });
      return best;
    }
    var shiftFrom = null, shiftTo = null;
    if (steps >= 6) {
      var half = Math.ceil(steps / 2);
      shiftFrom = topOfHalves(history.slice(0, half));
      shiftTo = topOfHalves(history.slice(half));
      if (shiftFrom === shiftTo) { shiftFrom = shiftTo = null; }
    }

    var sacrificePicks = history.filter(function (h) { return h.effects && (h.effects.sacrifice || 0) >= 2; }).length;

    /* --- ملاحظات بصوت «المقيّم المتخفي» --- */
    var OBS = (DATA.PROFILE && DATA.PROFILE.observations) || {};
    var observations = [];
    function add(key, vars) { if (OBS[key]) observations.push(fillTemplate(OBS[key], vars || {})); }

    if (avgMs !== null && timed.length >= Math.max(3, Math.floor(steps * 0.6))) {
      var sec = Math.round(avgMs / 100) / 10;
      if (avgMs < 4000) add('fastDecider', { sec: sec });
      else if (avgMs > 11000) add('slowDecider', { sec: sec });
      else add('measuredDecider', { sec: sec });
    }
    if (timeouts >= 2) add('frozeMany', { n: timeouts });
    else if (timeouts === 1) add('frozeOnce');

    var dimLabel = function (k) { return DATA.STATS[k] ? DATA.STATS[k].label : k; };
    if (shiftFrom && shiftTo) add('shifter', { from: dimLabel(shiftFrom), to: dimLabel(shiftTo) });
    else if (consistency >= 0.55) add('consistent', { pct: Math.round(consistency * 100), dim: dimLabel(topKey) });
    else if (steps >= 5 && consistency <= 0.3) add('flexible');

    if (sacrificePicks >= 3) add('selfless', { n: sacrificePicks });

    var impulseSum = stats.impulse || 0, orderSum = stats.order || 0;
    if ('impulse' in stats && 'order' in stats) {
      if (impulseSum - orderSum >= 4) add('ruleBreaker');
      else if (orderSum - impulseSum >= 4) add('ruleKeeper');
    }

    if (levels.empathy === 'high' && levels.trust === 'high') add('peopleFirst');
    else if (levels.control === 'high' && levels.empathy === 'low') add('controller');
    else if (levels.empathy === 'high' && levels.trust === 'low') add('guardedHeart');

    observations = observations.slice(0, 5);

    /* --- أقرب نمط لعب (وضع deep) --- */
    var archetype = null;
    if (challenge.deep && DATA.PROFILE && DATA.PROFILE.archetypes) {
      var vals = keys.map(function (k) { return stats[k] || 0; });
      var spread = Math.max.apply(null, vals) - Math.min.apply(null, vals);
      if (spread <= 2) {
        DATA.PROFILE.archetypes.forEach(function (a) { if (a.id === 'living-balance') archetype = a; });
      } else {
        var bestScore = -Infinity;
        DATA.PROFILE.archetypes.forEach(function (a) {
          if (a.id === 'living-balance' || !a.weights) return;
          var score = 0;
          Object.keys(a.weights).forEach(function (k) { score += (stats[k] || 0) * a.weights[k]; });
          if (score > bestScore) { bestScore = score; archetype = a; }
        });
      }
      if (archetype) {
        archetype = {
          id: archetype.id, name: archetype.name, icon: archetype.icon,
          line: archetype.line, strength: archetype.strength, blind: archetype.blind
        };
      }
    }

    return {
      dimensions: dimensions,
      observations: observations,
      archetype: archetype,
      disclaimer: (DATA.PROFILE && DATA.PROFILE.disclaimer) || '',
      metrics: {
        steps: steps,
        avgDecisionMs: avgMs !== null ? Math.round(avgMs) : null,
        timeouts: timeouts,
        consistency: Math.round(consistency * 100),
        topKey: topKey
      }
    };
  }

  /* حل مفتاح لقب/نمط قادم من رابط صديق إلى بياناته المعروضة */
  function getTitleByKey(key) {
    if (DATA.TITLES[key]) {
      var t = DATA.TITLES[key];
      return { key: key, name: t.name, icon: t.icon, line: t.line };
    }
    if (DATA.PROFILE && DATA.PROFILE.archetypes) {
      for (var i = 0; i < DATA.PROFILE.archetypes.length; i++) {
        var a = DATA.PROFILE.archetypes[i];
        if (a.id === key) return { key: key, name: a.name, icon: a.icon, line: a.line };
      }
    }
    return null;
  }

  var Engine = {
    DATA: DATA,
    getChallenge: getChallenge,
    createRun: createRun,
    applyChoice: applyChoice,
    computeTitleKey: computeTitleKey,
    getTitle: getTitle,
    getTitleByKey: getTitleByKey,
    statKeysFor: statKeysFor,
    buildProfile: buildProfile,
    computeDistances: computeDistances,
    getDailyChallenge: getDailyChallenge,
    summarizeRun: summarizeRun
  };

  global.LOOP_ENGINE = Engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
