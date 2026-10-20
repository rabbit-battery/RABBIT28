/* ============================================================
   LOOP — مؤثرات صوتية خفيفة مولّدة برمجيًا (WebAudio)
   بدون أي ملفات صوت، وتعمل فقط بعد أول تفاعل من المستخدم.
   ============================================================ */
(function (global) {
  'use strict';

  var ctx = null;
  var enabled = true;

  function ensureCtx() {
    if (!enabled) return null;
    try {
      if (!ctx) ctx = new (global.AudioContext || global.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch (e) { return null; }
  }

  function tone(freq, start, dur, type, vol) {
    var ac = ensureCtx();
    if (!ac) return;
    try {
      var osc = ac.createOscillator();
      var gain = ac.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      var t = ac.currentTime + start;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol || 0.08, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(ac.destination);
      osc.start(t); osc.stop(t + dur + 0.05);
    } catch (e) { /* تجاهل */ }
  }

  global.LOOP_SOUND = {
    setEnabled: function (v) { enabled = !!v; },
    isEnabled: function () { return enabled; },
    click: function () { tone(520, 0, 0.08, 'sine', 0.05); },
    choose: function () { tone(440, 0, 0.1, 'triangle', 0.07); tone(660, 0.07, 0.14, 'triangle', 0.07); },
    finish: function () {
      tone(523.25, 0, 0.18, 'triangle', 0.08);
      tone(659.25, 0.12, 0.18, 'triangle', 0.08);
      tone(783.99, 0.24, 0.28, 'triangle', 0.09);
      tone(1046.5, 0.4, 0.35, 'sine', 0.07);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
