/* ============================================================
   LOOP — طبقة التخزين
   ------------------------------------------------------------
   النسخة الأولى: تخزين محلي (localStorage) على جهاز اللاعب فقط.
   لا يُرسل أي بيان لأي خادم.

   === التوسّع المستقبلي (Supabase) ===
   عند الحاجة لمقارنة جماعية مركزية: نفّذ واجهة بنفس الدوال
   (saveResult / loadResultByCode) باستخدام REST API الخاص
   بـ Supabase ومفتاح "anon" العام فقط + Row Level Security.
   مخطط قاعدة البيانات الجاهز: supabase/schema.sql
   ملحوظة أمان: لا تضع أي مفتاح service_role في كود الواجهة أبدًا.
   ============================================================ */
(function (global) {
  'use strict';

  var PREFIX = 'loop_';
  var memoryFallback = {};

  function ls() {
    try {
      var s = global.localStorage;
      var t = '__loop_test__';
      s.setItem(t, '1'); s.removeItem(t);
      return s;
    } catch (e) { return null; }
  }

  function set(key, value) {
    var raw = JSON.stringify(value);
    var store = ls();
    if (store) { try { store.setItem(PREFIX + key, raw); return; } catch (e) { /* امتلأ */ } }
    memoryFallback[PREFIX + key] = raw;
  }

  function get(key, fallback) {
    var store = ls();
    var raw = null;
    if (store) { try { raw = store.getItem(PREFIX + key); } catch (e) {} }
    if (raw === null && memoryFallback[PREFIX + key] !== undefined) raw = memoryFallback[PREFIX + key];
    if (raw === null || raw === undefined) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }

  function remove(key) {
    var store = ls();
    if (store) { try { store.removeItem(PREFIX + key); } catch (e) {} }
    delete memoryFallback[PREFIX + key];
  }

  global.LOOP_STORAGE = {
    /* الجولة الجارية (لاستكمال اللعب بعد إغلاق الصفحة) */
    saveRun: function (run) { set('current_run', run); },
    loadRun: function () { return get('current_run', null); },
    clearRun: function () { remove('current_run'); },

    /* آخر نتيجة (عشان يفضل اللاعب يقدر يشاركها بعد ما يقفل) */
    saveLastResult: function (result) { set('last_result', result); },
    loadLastResult: function () { return get('last_result', null); },

    /* سجل محلي لعدد الجولات اللي لعبها الشخص نفسه على جهازه فقط */
    recordFinished: function () {
      var n = get('finished_count', 0) + 1;
      set('finished_count', n);
      return n;
    },
    getFinishedCount: function () { return get('finished_count', 0); },

    /* إعدادات */
    getSoundEnabled: function () { return get('sound', true); },
    setSoundEnabled: function (v) { set('sound', !!v); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
