/* ============================================================
   LOOP — منطق واجهة المستخدم
   المحتوى في js/data/challenges.js | المحرك في js/engine.js
   ============================================================ */
(function () {
  'use strict';

  var Engine = window.LOOP_ENGINE;
  var Storage = window.LOOP_STORAGE;
  var Share = window.LOOP_SHARE;
  var Sound = window.LOOP_SOUND;
  var DATA = Engine.DATA;
  var STATS = DATA.STATS;

  /* ---------- حالة التطبيق ---------- */
  var state = {
    run: null,             // الجولة الجارية
    distances: null,       // خريطة مسافات للتقدم
    friendResult: null,    // نتيجة صديق جاية من الرابط
    currentResult: null,   // نتيجة الجولة المعروضة حاليًا في شاشة النتيجة
    busy: false,           // منع الضغط المزدوج أثناء الانتقالات
    sceneStartedAt: 0      // وقت عرض المشهد الحالي (لقياس سرعة القرار)
  };

  /* ---------- أدوات صغيرة ---------- */
  function $(id) { return document.getElementById(id); }
  function toAr(num) { return String(num).replace(/\d/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[+d]; }); }
  function pluralChallenges(n) {
    if (n === 1) return 'تحدٍّ واحد متاح';
    if (n === 2) return 'تحدّيان متاحان';
    if (n >= 3 && n <= 10) return toAr(n) + ' تحديات متاحة';
    return toAr(n) + ' تحديًا متاحًا';
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 3200);
  }

  function showScreen(name) {
    stopSceneTimer();
    ['home', 'game', 'result'].forEach(function (s) {
      $('screen-' + s).classList.toggle('active', s === name);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- نافذة التأكيد ---------- */
  var modalAction = null;
  function showConfirm(title, text, confirmLabel, onConfirm) {
    $('modalTitle').textContent = title;
    $('modalText').textContent = text;
    $('modalConfirm').textContent = confirmLabel;
    modalAction = onConfirm;
    $('modalBackdrop').classList.remove('hidden');
  }
  function hideConfirm() { $('modalBackdrop').classList.add('hidden'); modalAction = null; }

  /* ============================================================
     مؤقّت الضغط (وضع التوتر) — قرارات بوقت محسوب
     ============================================================ */
  var timerCtl = { id: null, active: false, endsAt: 0, total: 0, pausedRemain: 0, lastTickSec: -1 };

  function currentChallenge() {
    return state.run ? Engine.getChallenge(state.run.challengeId) : null;
  }
  function timerApplies(ch) { return !!(ch && ch.timer && Storage.getTimerEnabled()); }
  function timerSecondsFor(ch) { return Storage.getTimerSecondsOverride() || (ch && ch.timer) || 0; }

  function startSceneTimer() {
    stopSceneTimer();
    var ch = currentChallenge();
    var wrap = $('timerWrap');
    if (!timerApplies(ch)) { wrap.classList.add('hidden'); return; }
    var secs = timerSecondsFor(ch);
    if (!secs) { wrap.classList.add('hidden'); return; }
    timerCtl.total = secs * 1000;
    timerCtl.endsAt = Date.now() + timerCtl.total;
    timerCtl.active = true;
    timerCtl.lastTickSec = -1;
    wrap.classList.remove('hidden');
    timerCtl.id = setInterval(tickTimer, 100);
    tickTimer();
  }

  function tickTimer() {
    var remain = timerCtl.endsAt - Date.now();
    if (remain <= 0) { stopSceneTimer(); onSceneTimeout(); return; }
    var fillEl = $('timerFill');
    fillEl.style.width = Math.max(0, (remain / timerCtl.total) * 100) + '%';
    fillEl.classList.toggle('urgent', remain < 6000);
    var s = Math.ceil(remain / 1000);
    $('timerText').textContent = '⏱️ ' + toAr(s);
    if (s <= 3 && s !== timerCtl.lastTickSec) { timerCtl.lastTickSec = s; Sound.tick(); }
  }

  function stopSceneTimer() {
    if (timerCtl.id) { clearInterval(timerCtl.id); timerCtl.id = null; }
    timerCtl.active = false;
    timerCtl.pausedRemain = 0;
  }

  function onSceneTimeout() {
    if (!state.run || state.busy) return;
    var ch = currentChallenge();
    if (!ch) return;
    var node = ch.nodes[state.run.nodeId];
    if (!node || !node.choices) return;
    var idx = -1;
    node.choices.forEach(function (c, i) { if (c.hesitate === true && idx === -1) idx = i; });
    if (idx < 0) idx = node.choices.length - 1;
    var btns = $('choicesWrap').querySelectorAll('.choice-btn');
    choose(idx, btns[idx] || null, { timedOut: true });
  }

  function updateTimerToggle() {
    var btn = $('timerToggle');
    var ch = currentChallenge();
    if (!ch || !ch.timer) { btn.classList.add('hidden'); return; }
    btn.classList.remove('hidden');
    btn.textContent = Storage.getTimerEnabled() ? '⏱️ المؤقّت: شغال' : '⏱️ المؤقّت: واقف';
  }

  /* إيقاف المؤقّت مؤقتًا عند إخفاء التبويب عشان ما يظلمش اللاعب */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (timerCtl.active && timerCtl.id) {
        timerCtl.pausedRemain = Math.max(0, timerCtl.endsAt - Date.now());
        clearInterval(timerCtl.id);
        timerCtl.id = null;
      }
    } else if (timerCtl.active && !timerCtl.id && timerCtl.pausedRemain > 0) {
      timerCtl.endsAt = Date.now() + timerCtl.pausedRemain;
      timerCtl.pausedRemain = 0;
      timerCtl.id = setInterval(tickTimer, 100);
      tickTimer();
    }
  });

  /* ============================================================
     الشاشة الرئيسية
     ============================================================ */
  function challengeBadges(ch) {
    var b = '';
    if (ch.deep) b += '<span class="ch-badge deep">🧠 تحليل عميق</span>';
    if (ch.timer) b += '<span class="ch-badge timer">⏱️ مؤقّت ضغط ' + toAr(ch.timer) + ' ث/قرار</span>';
    return b ? '<div class="challenge-badges">' + b + '</div>' : '';
  }
  function challengeMeta(ch) {
    var m = '⏱️ ' + ch.minutes;
    if (ch.stages) m += ' • ' + toAr(ch.stages.min) + '–' + toAr(ch.stages.max) + ' قرارات';
    return m;
  }

  function renderHome() {
    var daily = Engine.getDailyChallenge();

    // بطاقة تحدي اليوم
    $('dailyCard').innerHTML =
      '<div class="daily-card-inner">' +
        '<span class="daily-tag">🌟 تحدي اليوم</span>' +
        '<h2 class="daily-title">' + esc(daily.icon) + ' ' + esc(daily.title) + '</h2>' +
        '<p class="daily-tagline">' + esc(daily.tagline) + '</p>' +
        challengeBadges(daily) +
        '<p class="daily-desc">' + esc(daily.description) + '</p>' +
        '<div class="daily-actions">' +
          '<button class="btn btn-primary" type="button" data-start="' + esc(daily.id) + '">ابدأ التحدي ▶</button>' +
          '<span class="daily-meta">' + esc(challengeMeta(daily)) + ' • نهايات متعددة حسب قراراتك</span>' +
        '</div>' +
      '</div>';

    // عداد التحديات + شبكة التحديات
    $('challengesCount').textContent = pluralChallenges(DATA.CHALLENGES.length);
    var grid = $('challengesGrid');
    grid.innerHTML = '';
    DATA.CHALLENGES.forEach(function (ch) {
      var card = document.createElement('article');
      card.className = 'challenge-card';
      card.id = 'card-' + ch.id;
      card.innerHTML =
        '<div class="challenge-icon">' + esc(ch.icon) + '</div>' +
        '<h3 class="challenge-name">' + esc(ch.title) + '</h3>' +
        challengeBadges(ch) +
        '<p class="challenge-tagline">' + esc(ch.tagline) + '</p>' +
        '<p class="challenge-desc">' + esc(ch.description) + '</p>' +
        '<div class="challenge-foot">' +
          '<button class="btn btn-primary btn-small" type="button" data-start="' + esc(ch.id) + '">العب دلوقتي</button>' +
          '<span class="challenge-minutes">' + esc(challengeMeta(ch)) + '</span>' +
        '</div>';
      grid.appendChild(card);
    });
    DATA.COMING_SOON.forEach(function (ch) {
      var card = document.createElement('article');
      card.className = 'challenge-card soon';
      card.innerHTML =
        '<div class="challenge-icon">' + esc(ch.icon) + '</div>' +
        '<h3 class="challenge-name">' + esc(ch.title) + '</h3>' +
        '<p class="challenge-tagline">' + esc(ch.tagline) + '</p>' +
        '<p class="challenge-desc">تحدي جديد بيجهز دلوقتي...</p>' +
        '<div class="challenge-foot"><span class="soon-tag">🔒 قريبًا</span></div>';
      grid.appendChild(card);
    });

    // أزرار البدء (تفويض)
    document.querySelectorAll('[data-start]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        Sound.click();
        startChallenge(btn.getAttribute('data-start'));
      });
    });

    // سطر معلومات الهيرو (بيانات حقيقية فقط: عدد التحديات + جولاتك على هذا الجهاز)
    var played = Storage.getFinishedCount();
    var meta = 'متاح دلوقتي: ' + pluralChallenges(DATA.CHALLENGES.length) + ' للعب فورًا من غير حساب';
    if (played > 0) meta += ' • خلّصت ' + toAr(played) + (played === 1 ? ' جولة' : played === 2 ? ' جولتين' : ' جولات') + ' على الجهاز ده 🏆';
    $('heroMeta').textContent = meta;

    renderResumeBanner();
    renderFriendBanner();
    renderLastResult();
  }

  function renderResumeBanner() {
    var saved = Storage.loadRun();
    var banner = $('resumeBanner');
    if (saved && !saved.finished && Engine.getChallenge(saved.challengeId) &&
        Engine.getChallenge(saved.challengeId).nodes[saved.nodeId]) {
      var ch = Engine.getChallenge(saved.challengeId);
      $('resumeText').textContent = 'كنت بتلعب «' + ch.title + '» ووقفت بعد ' + toAr(saved.history.length) +
        (saved.history.length === 1 ? ' قرار' : ' قرارات') + '. كمّل من حيث وقفت؟';
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
      if (saved) Storage.clearRun(); // حالة تالفة → نظافة تلقائية
    }
  }

  function renderFriendBanner() {
    var banner = $('friendBanner');
    var fr = state.friendResult;
    if (!fr) { banner.classList.add('hidden'); return; }
    var ch = Engine.getChallenge(fr.challengeId);
    if (!ch) { banner.classList.add('hidden'); state.friendResult = null; return; }

    var endingNode = ch.nodes[fr.endingId];
    var titleData = Engine.getTitleByKey(fr.titleKey);
    var endingTxt = endingNode && endingNode.ending ? 'وصل لنهاية «' + endingNode.title + '» ' + endingNode.icon : 'خلّص التحدي';
    var titleTxt = titleData ? ' وخد لقب «' + titleData.name + '» ' + titleData.icon : '';
    $('friendBannerText').textContent = 'صديقك لعب «' + ch.title + '» و' + endingTxt + titleTxt +
      '. العب نفس التحدي وشوف قراراتك هتوصلك لفين... وبعدها هنقارن مساراتكم!';
    banner.classList.remove('hidden');
  }

  function renderLastResult() {
    var wrap = $('lastResultWrap');
    var last = Storage.loadLastResult();
    if (!last || !Engine.getChallenge(last.challengeId)) { wrap.innerHTML = ''; return; }

    wrap.innerHTML =
      '<div class="section-head"><h2>🏅 آخر نهاية وصلت لها</h2></div>' +
      '<div class="last-result-card">' +
        '<span class="lr-icon">' + esc(last.endingIcon) + '</span>' +
        '<div><strong>' + esc(last.endingTitle) + '</strong>' +
        '<p>في تحدي «' + esc(last.challengeTitle) + '» • لقبك: ' + esc(last.title.name) + ' ' + esc(last.title.icon) + '</p></div>' +
        '<button class="btn btn-ghost btn-small" id="shareLastBtn" type="button">⚔️ تحدَّ أصحابك بنتيجتك</button>' +
      '</div>';

    $('shareLastBtn').addEventListener('click', function () {
      Sound.click();
      var url = Share.buildResultLink(last);
      Share.shareLink(url, Share.resultShareText(last), 'نتيجتي في LOOP').then(feedbackShare);
    });
  }

  function feedbackShare(result) {
    if (result === 'copied') toast('✅ اتنسخ الرابط... ابعته لأصحابك في أي حتة!');
    else if (result === 'failed') toast('⚠️ ما عرفتش انسخ الرابط تلقائيًا. جرّب من شريط عنوان المتصفح.');
  }

  /* ============================================================
     بدء / استكمال الجولات
     ============================================================ */
  function startChallenge(challengeId) {
    var run = Engine.createRun(challengeId);
    if (!run) { toast('⚠️ التحدي ده مش موجود.'); return; }
    state.run = run;
    state.distances = Engine.computeDistances(Engine.getChallenge(challengeId));
    Storage.saveRun(run);
    updateUrlChallenge(challengeId);
    enterGameScreen();
  }

  function resumeRun() {
    var saved = Storage.loadRun();
    if (!saved || !Engine.getChallenge(saved.challengeId)) {
      toast('⚠️ ما لقيتش جولة محفوظة صالحة.');
      renderResumeBanner();
      return;
    }
    state.run = saved;
    state.distances = Engine.computeDistances(Engine.getChallenge(saved.challengeId));
    updateUrlChallenge(saved.challengeId);
    enterGameScreen();
    toast('رجعنا! 🎮 كمّل من حيث وقفت...');
  }

  function updateUrlChallenge(challengeId) {
    try {
      var url = new URL(location.href);
      url.searchParams.set('c', challengeId);
      history.replaceState(null, '', url.toString());
    } catch (e) { /* بيئات قديمة */ }
  }

  function enterGameScreen() {
    var ch = Engine.getChallenge(state.run.challengeId);
    $('gameChallengeTitle').textContent = ch.icon + ' ' + ch.title;
    $('historyPanel').classList.add('hidden');
    showScreen('game');
    renderScene(true);
  }

  /* ============================================================
     عرض المشهد والاختيارات
     ============================================================ */
  function renderScene(firstEnter) {
    var run = state.run;
    var ch = Engine.getChallenge(run.challengeId);
    var node = ch.nodes[run.nodeId];
    if (!node) { // حماية أخيرة من الشاشات الفاضية
      toast('⚠️ حصل خطأ في تحميل المشهد. رجعنا بيك للقائمة.');
      Storage.clearRun();
      showScreen('home'); renderHome();
      return;
    }
    if (node.ending) { finishRun(); return; }

    // إعادة حركة المشهد
    var card = $('sceneCard');
    card.classList.remove('animate-in');
    void card.offsetWidth;
    card.classList.add('animate-in');

    $('sceneLabel').textContent = node.label || ch.title;

    var resultEl = $('sceneResult');
    if (run.lastResult) {
      resultEl.textContent = 'نتيجة قرارك: ' + run.lastResult;
      resultEl.classList.remove('hidden');
    } else {
      resultEl.classList.add('hidden');
    }

    $('sceneText').textContent = node.text;

    // التقدم
    var done = run.history.length;
    var remaining = state.distances[run.nodeId];
    if (remaining === undefined) remaining = 1;
    var total = done + remaining;
    var pct = total > 0 ? Math.round((done / total) * 100) : 0;
    $('progressFill').style.width = pct + '%';
    $('progressText').textContent = 'القرار ' + toAr(done + 1) + ' من ' + toAr(total) + ' تقريبًا';

    // الاختيارات
    var wrap = $('choicesWrap');
    wrap.innerHTML = '';
    var numerals = ['١', '٢', '٣', '٤'];
    node.choices.forEach(function (choice, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-btn';
      btn.innerHTML = '<span class="choice-num">' + numerals[i] + '</span><span></span>';
      btn.querySelector('span:last-child').textContent = choice.text;
      btn.addEventListener('click', function () { choose(i, btn); });
      wrap.appendChild(btn);
    });

    renderStatsStrip();
    renderHistoryPanel();
    updateTimerToggle();
    state.sceneStartedAt = Date.now();
    startSceneTimer();
  }

  function renderStatsStrip(changedKeys) {
    var strip = $('statsStrip');
    strip.innerHTML = '';
    var keys = state.run ? Engine.statKeysFor(currentChallenge()) : Object.keys(STATS);
    keys.forEach(function (k) {
      var chip = document.createElement('span');
      chip.className = 'stat-chip' + (changedKeys && changedKeys.indexOf(k) !== -1 ? ' bump' : '');
      chip.style.borderColor = STATS[k].color + '66';
      chip.textContent = STATS[k].icon + ' ' + STATS[k].label + ': ' + toAr(state.run.stats[k] || 0);
      strip.appendChild(chip);
    });
    $('historyCount').textContent = toAr(state.run.history.length);
  }

  function renderHistoryPanel() {
    var list = $('historyList');
    fillHistoryList(list, state.run.history);
  }

  function fillHistoryList(listEl, history) {
    listEl.innerHTML = '';
    if (!history.length) {
      var li = document.createElement('li');
      li.textContent = 'لسه ما خدتش أي قرار في الجولة دي.';
      listEl.appendChild(li);
      return;
    }
    history.forEach(function (h) {
      var li = document.createElement('li');
      var fx = h.effects ? effectText(h.effects) : '';
      li.innerHTML = (h.label ? '<span class="h-label">' + esc(h.label) + ':</span> ' : '') +
        '<span class="h-text"></span>' + (fx ? ' <span class="h-effects">(' + esc(fx) + ')</span>' : '');
      li.querySelector('.h-text').textContent = h.choiceText;
      listEl.appendChild(li);
    });
  }

  function effectText(effects) {
    return Object.keys(effects).filter(function (k) { return effects[k] > 0; })
      .map(function (k) { return '+' + toAr(effects[k]) + ' ' + STATS[k].label; })
      .join('، ');
  }

  /* ---------- اختيار ---------- */
  function choose(index, btnEl, opts) {
    if (!state.run || state.busy) return;
    state.busy = true;
    stopSceneTimer();
    Sound.choose();

    var buttons = $('choicesWrap').querySelectorAll('.choice-btn');
    buttons.forEach(function (b) { b.disabled = true; });
    if (btnEl) btnEl.classList.add('selected');

    var elapsed = state.sceneStartedAt ? (Date.now() - state.sceneStartedAt) : null;
    var prevStats = Object.assign({}, state.run.stats);
    var newRun = Engine.applyChoice(state.run, index, {
      timeMs: elapsed,
      timedOut: !!(opts && opts.timedOut)
    });
    if (!newRun) { state.busy = false; buttons.forEach(function (b) { b.disabled = false; }); return; }
    state.run = newRun;
    Storage.saveRun(newRun);

    // مؤشرات التأثير (+٢ جرأة)
    var changed = Object.keys(STATS).filter(function (k) { return newRun.stats[k] > prevStats[k]; });
    changed.forEach(function (k, i) {
      showFxFloat('+' + toAr(newRun.stats[k] - prevStats[k]) + ' ' + STATS[k].label + ' ' + STATS[k].icon, i);
    });
    renderStatsStrip(changed);

    setTimeout(function () {
      state.busy = false;
      if (state.run.finished) finishRun();
      else renderScene();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, changed.length ? 900 : 450);
  }

  function showFxFloat(text, idx) {
    var layer = $('fxLayer');
    var el = document.createElement('span');
    el.className = 'fx-float';
    el.textContent = text;
    el.style.bottom = (24 + idx * 8) + '%';
    el.style.animationDelay = (idx * 0.18) + 's';
    layer.appendChild(el);
    setTimeout(function () { el.remove(); }, 2000 + idx * 200);
  }

  /* ============================================================
     شاشة النتيجة
     ============================================================ */
  function finishRun() {
    var summary = Engine.summarizeRun(state.run);
    if (!summary) { showScreen('home'); renderHome(); return; }

    state.currentResult = summary;
    Storage.saveLastResult(summary);
    Storage.clearRun();
    Storage.recordFinished();
    Sound.finish();

    $('resultChallengeTitle').textContent = '«' + summary.challengeTitle + '»';
    $('endingIcon').textContent = summary.endingIcon;
    $('endingTone').textContent = summary.endingTone;
    $('endingTitle').textContent = summary.endingTitle;
    $('endingText').textContent = summary.endingText;

    $('playerTitleIcon').textContent = summary.title.icon;
    $('playerTitleName').textContent = summary.title.name;
    $('playerTitleLine').textContent = summary.title.line;

    // بطاقة المشاركة (معاينة)
    $('shareCardChallenge').textContent = 'تحدي «' + summary.challengeTitle + '»';
    $('shareCardEndingIcon').textContent = summary.endingIcon;
    $('shareCardEnding').textContent = summary.endingTitle;
    $('shareCardTitleIcon').textContent = summary.title.icon;
    $('shareCardTitle').textContent = summary.title.name;

    // اعرض شاشة النتيجة فورًا بعد الأساسيات — أي خطأ لاحق في
    // الإضافات (مشاركة/مقارنة) لا يجب أن يجمّد اللاعب أبدًا
    showScreen('result');

    renderProfile(summary);

    fillHistoryList($('resultHistoryList'), summary.history);

    // المقارنة والمشاركة إضافات — لا يُسمح لخطأ فيها بإخفاء النتيجة
    try { renderComparison(summary); } catch (e) { console.error(e); }
    try { wireResultActions(summary); } catch (e) { console.error(e); }
  }

  /* ---------- الملف النفسي الترفيهي في شاشة النتيجة ---------- */
  function renderProfile(summary) {
    var wrap = $('profileWrap');
    var profile = summary.profile || { dimensions: [], observations: [], archetype: null, disclaimer: '' };

    var html = '<h3 class="panel-title">🧠 ملفك النفسي في الجولة دي — قراءة «المقيّم المتخفٍّ»</h3>';

    if (profile.archetype) {
      html += '<div class="arch-extra">' +
        '<div class="arch-box strength"><strong>✨ نقطة قوتك</strong><p>' + esc(profile.archetype.strength) + '</p></div>' +
        '<div class="arch-box blind"><strong>🌑 نقطتك العمياء</strong><p>' + esc(profile.archetype.blind) + '</p></div>' +
        '</div>';
    }

    html += '<div id="profileDims"></div>';

    if (profile.observations && profile.observations.length) {
      html += '<div class="obs-block"><h3 class="panel-title">📋 ملاحظات اتكتبت عنك أثناء اللعب</h3>' +
        '<ul class="obs-list">' +
        profile.observations.map(function (o) { return '<li>' + esc(o) + '</li>'; }).join('') +
        '</ul></div>';
    }

    if (profile.disclaimer) {
      html += '<p class="profile-disclaimer">' + esc(profile.disclaimer) + '</p>';
    }

    wrap.innerHTML = html;

    var dimsWrap = wrap.querySelector('#profileDims');
    var max = 1;
    (profile.dimensions || []).forEach(function (d) { max = Math.max(max, d.value); });
    var levelNames = { high: 'مرتفع', mid: 'متوازن', low: 'منخفض' };

    (profile.dimensions || []).forEach(function (d) {
      var row = document.createElement('div');
      row.className = 'dim-row';
      row.innerHTML =
        '<div class="dim-head">' +
          '<span class="dim-name">' + esc(d.icon) + ' ' + esc(d.label) + '</span>' +
          '<span class="dim-level ' + esc(d.level) + '">' + esc(levelNames[d.level] || '') + '</span>' +
          '<span class="dim-val">' + toAr(d.value) + '</span>' +
        '</div>' +
        '<span class="stat-track"><span class="stat-fill" style="background:' + esc(d.color) + '"></span></span>' +
        '<p class="dim-narr"></p>';
      row.querySelector('.dim-narr').textContent = d.narrative;
      dimsWrap.appendChild(row);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          row.querySelector('.stat-fill').style.width =
            (d.value > 0 ? Math.max(8, (d.value / max) * 100) : 0) + '%';
        });
      });
    });
  }

  function renderComparison(summary) {
    var wrap = $('compareWrap');
    var fr = state.friendResult;
    wrap.innerHTML = '';
    if (!fr) return;

    var ch = Engine.getChallenge(fr.challengeId);
    if (!ch) return;

    if (fr.challengeId !== summary.challengeId) {
      wrap.innerHTML =
        '<div class="compare-card"><h3 class="panel-title">🤝 مقارنة مع صديقك</h3>' +
        '<p class="compare-sub">صديقك كان بيتحداك في «' + esc(ch.title) +
        '». العب نفس التحدي عشان نقارن قراراتكم ببعض!</p>' +
        '<div style="text-align:center;margin-top:12px"><button class="btn btn-primary btn-small" id="comparePlayBtn" type="button">العب «' +
        esc(ch.title) + '» دلوقتي</button></div></div>';
      $('comparePlayBtn').addEventListener('click', function () { Sound.click(); startChallenge(ch.id); });
      return;
    }

    var cmp = Share.compareWithFriend(summary.history, fr);
    var friendEnding = ch.nodes[fr.endingId];
    var friendTitle = Engine.getTitleByKey(fr.titleKey);
    var sameEnding = fr.endingId === summary.endingId;

    wrap.innerHTML =
      '<div class="compare-card"><h3 class="panel-title">⚔️ قراراتك × قرارات صديقك</h3>' +
      '<div class="compare-vs">' +
        '<div class="compare-side"><div class="cs-who">انت 🙋</div>' +
          '<div class="cs-ending">' + esc(summary.endingIcon) + ' ' + esc(summary.endingTitle) + '</div>' +
          '<div class="cs-title">' + esc(summary.title.icon) + ' ' + esc(summary.title.name) + '</div></div>' +
        '<div class="compare-cross">⚔️</div>' +
        '<div class="compare-side"><div class="cs-who">صديقك 👋</div>' +
          '<div class="cs-ending">' + esc(friendEnding ? friendEnding.icon : '🏁') + ' ' + esc(friendEnding ? friendEnding.title : 'نهاية مختلفة') + '</div>' +
          '<div class="cs-title">' + esc(friendTitle ? friendTitle.icon : '🎭') + ' ' + esc(friendTitle ? friendTitle.name : '') + '</div></div>' +
      '</div>' +
      '<p class="compare-line">' + (sameEnding
          ? 'وصلتوا لنفس النهاية بالظبط! 🤩'
          : 'كل واحد فيكم وصل لنهاية مختلفة... نفس القصة، مصيرين!') + '</p>' +
      '<p class="compare-sub">مريتو بنفس المحطات ' + toAr(cmp.shared) + ' مرة، واتفقتو في ' +
        toAr(cmp.same) + (cmp.same === 1 ? ' قرار' : ' قرارات') + ' واختلفتو في ' + toAr(cmp.diff) + '.</p>' +
      '</div>';
  }

  function wireResultActions(summary) {
    // أزرار التنقّل الأساسية تتسلك الأول — لازم تشتغل مهما حصل
    $('playAgainBtn').onclick = function () { Sound.click(); startChallenge(summary.challengeId); };
    $('resultHomeBtn').onclick = function () { Sound.click(); goHome(); };
    $('downloadCardBtn').onclick = function () { shareCardImage(summary); };

    // روابط المشاركة (مع بديل آمن لو حصلت أي مشكلة في الترميز)
    var url, text;
    try {
      url = Share.buildResultLink(summary);
      text = Share.resultShareText(summary);
    } catch (e) {
      console.error(e);
      url = Share.buildGameLink(summary.challengeId);
      text = Share.gameShareText(Engine.getChallenge(summary.challengeId));
    }

    $('waShareBtn').href = Share.whatsappLink(url, text);
    $('tgShareBtn').href = Share.telegramLink(url, text);

    $('challengeFriendsBtn').onclick = function () {
      Sound.click();
      Share.shareLink(url, text, 'تحدي LOOP').then(feedbackShare);
    };
    $('copyLinkBtn').onclick = function () {
      Sound.click();
      Share.copyText(url).then(function (ok) {
        toast(ok ? '✅ اتنسخ رابط اللعبة بنتيجتك... ابعته لأصحابك!' : '⚠️ النسخ ما نجحش على المتصفح ده.');
      });
    };
  }

  function shareCardImage(summary) {
    Sound.click();
    var canvas = $('cardCanvas');
    try {
      var meta = {};
      (summary.statKeys || Object.keys(STATS)).forEach(function (k) { if (STATS[k]) meta[k] = STATS[k]; });
      Share.drawResultCard(canvas, summary, meta);
      Share.canvasToBlob(canvas).then(function (blob) {
        if (!blob) { toast('⚠️ تعذر إنشاء الصورة على الجهاز ده.'); return; }
        var file = new File([blob], 'loop-result.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: 'نتيجتي في LOOP', text: Share.resultShareText(summary) })
            .catch(function (e) { if (!e || e.name !== 'AbortError') downloadBlob(blob); });
        } else {
          downloadBlob(blob);
          toast('🖼️ بطاقتك اتحفظت كصورة... شاركها في أي حتة!');
        }
      });
    } catch (e) {
      toast('⚠️ تعذر إنشاء الصورة. شارك الرابط بدلًا منها!');
    }
  }

  function downloadBlob(blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'loop-result.png';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  /* ============================================================
     تنقل عام + تهيئة
     ============================================================ */
  function goHome() {
    showScreen('home');
    renderHome();
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function initSound() {
    var on = Storage.getSoundEnabled();
    Sound.setEnabled(on);
    $('soundToggle').textContent = on ? '🔊' : '🔇';
    $('soundToggle').addEventListener('click', function () {
      var now = !Sound.isEnabled();
      Sound.setEnabled(now);
      Storage.setSoundEnabled(now);
      $('soundToggle').textContent = now ? '🔊' : '🔇';
      if (now) Sound.click();
      toast(now ? '🔊 الصوت اشتغل' : '🔇 الصوت اتكتم');
    });
  }

  function init() {
    initSound();

    // قراءة بارامترات رابط الوصول (?c=التحدي و ?r=نتيجة صديق)
    var incoming = Share.parseIncoming();
    if (incoming.friendResult && Engine.getChallenge(incoming.friendResult.challengeId)) {
      state.friendResult = incoming.friendResult;
    }
    if (incoming.invalidResult) {
      setTimeout(function () { toast('رابط النتيجة اللي فتحته مش صالح... بس تقدر تلعب عادي 🎮'); }, 600);
    }

    renderHome();
    showScreen('home');

    var daily = Engine.getDailyChallenge();

    // تمييز بطاقة التحدي القادم من رابط
    if (incoming.challengeId) {
      if (Engine.getChallenge(incoming.challengeId)) {
        var card = $('card-' + incoming.challengeId);
        if (card) {
          card.classList.add('highlight');
          setTimeout(function () { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 500);
        }
      } else {
        setTimeout(function () { toast('⚠️ التحدي المطلوب في الرابط مش موجود. اختار أي تحدي من القائمة!'); }, 600);
      }
    }

    /* أزرار الهيرو */
    $('heroStartBtn').addEventListener('click', function () {
      Sound.click();
      var target = (state.friendResult && Engine.getChallenge(state.friendResult.challengeId))
        ? state.friendResult.challengeId : daily.id;
      startChallenge(target);
    });
    $('heroShareBtn').addEventListener('click', function () {
      Sound.click();
      Share.shareLink(Share.buildGameLink(), Share.gameShareText(), 'LOOP').then(feedbackShare);
    });

    /* بانر صديق */
    $('friendBannerBtn').addEventListener('click', function () {
      Sound.click();
      if (state.friendResult) startChallenge(state.friendResult.challengeId);
    });

    /* استكمال الجولة */
    $('resumeBtn').addEventListener('click', function () { Sound.click(); resumeRun(); });
    $('resumeDiscardBtn').addEventListener('click', function () {
      Sound.click();
      showConfirm('ابدأ من الأول؟', 'هتمسح تقدم الجولة الحالية نهائيًا.', 'أيوه، امسح وابدأ', function () {
        Storage.clearRun();
        state.run = null;
        renderHome();
        toast('اتمسح التقدم القديم. صفحة بيضا جديدة ✨');
      });
    });

    /* الشعار → الرئيسية */
    $('brandBtn').addEventListener('click', function () { Sound.click(); goHome(); });

    /* أزرار شاشة اللعب */
    $('gameHomeBtn').addEventListener('click', function () {
      Sound.click();
      goHome();
      if (state.run && !state.run.finished) toast('💾 تقدمك محفوظ... تقدر تكمل أي وقت من الصفحة الرئيسية.');
    });
    $('gameRestartBtn').addEventListener('click', function () {
      Sound.click();
      if (!state.run) return;
      showConfirm('إعادة من الأول؟', 'هتبدأ نفس التحدي من أول قرار، وقرارات الجولة دي هتتمسح.', 'أيوه، أعد البدء', function () {
        startChallenge(state.run.challengeId);
        toast('من الأول! 🔁 المرة دي جرّب مسار تاني...');
      });
    });
    $('historyToggle').addEventListener('click', function () {
      Sound.click();
      $('historyPanel').classList.toggle('hidden');
    });
    $('timerToggle').addEventListener('click', function () {
      var nowOn = !Storage.getTimerEnabled();
      Storage.setTimerEnabled(nowOn);
      Sound.click();
      updateTimerToggle();
      if (!state.run) return;
      if (nowOn) {
        state.sceneStartedAt = Date.now();
        startSceneTimer();
        toast('⏱️ المؤقّت اشتغل... الضغط رسميًا بدأ!');
      } else {
        stopSceneTimer();
        $('timerWrap').classList.add('hidden');
        toast('⏱️ المؤقّت اتوقف. العب على مهلك.');
      }
    });

    /* نافذة التأكيد */
    $('modalConfirm').addEventListener('click', function () {
      var fn = modalAction; hideConfirm(); if (fn) fn();
    });
    $('modalCancel').addEventListener('click', hideConfirm);
    $('modalBackdrop').addEventListener('click', function (e) {
      if (e.target === $('modalBackdrop')) hideConfirm();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
