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
    return { bold: 0, coop: 0, caution: 0, sacrifice: 0 };
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
     إرجاع null لو الاختيار أو العقدة غير صالحين. */
  function applyChoice(run, choiceIndex) {
    var challenge = getChallenge(run.challengeId);
    if (!challenge) return null;
    var node = challenge.nodes[run.nodeId];
    if (!node || !node.choices || !node.choices[choiceIndex]) return null;

    var choice = node.choices[choiceIndex];
    var nextNode = challenge.nodes[choice.next];
    if (!nextNode) return null;

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
      effects: effects
    }]);

    return {
      challengeId: run.challengeId,
      nodeId: choice.next,
      stats: stats,
      history: history,
      lastResult: choice.result || '',
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
    return {
      challengeId: run.challengeId,
      challengeTitle: challenge.title,
      endingId: run.endingId,
      endingTitle: ending.title,
      endingIcon: ending.icon,
      endingTone: ending.tone || '',
      endingText: ending.text,
      stats: Object.assign({}, run.stats),
      title: getTitle(run.stats),
      history: run.history.map(function (h) {
        return { nodeId: h.nodeId, label: h.label, choiceIndex: h.choiceIndex, choiceText: h.choiceText };
      })
    };
  }

  var Engine = {
    DATA: DATA,
    getChallenge: getChallenge,
    createRun: createRun,
    applyChoice: applyChoice,
    computeTitleKey: computeTitleKey,
    getTitle: getTitle,
    computeDistances: computeDistances,
    getDailyChallenge: getDailyChallenge,
    summarizeRun: summarizeRun
  };

  global.LOOP_ENGINE = Engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
