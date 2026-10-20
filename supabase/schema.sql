-- ============================================================
-- LOOP — مخطط قاعدة البيانات المستقبلي (Supabase / PostgreSQL)
-- ------------------------------------------------------------
-- النسخة الأولى من اللعبة لا تحتاج أي قاعدة بيانات:
-- التقدّم محلي، والمشاركة/المقارنة تتم عبر الرابط نفسه.
-- هذا الملف جاهز لليوم الذي تريد فيه ميزات جماعية مركزية مثل:
--   * غرف أصدقاء برمز قصير (زي روم كود) لمقارنة مجموعة كاملة
--   * صفحة نتائج جماعية لشلة أصدقاء
--   * إحصاءات عامة اختيارية (بموافقة اللاعب)
--
-- خطوات التفعيل (لاحقًا، عند الحاجة فقط):
--   1) أنشئ مشروعًا جديدًا مستقلًا في Supabase خاصًا بلعبة LOOP
--   2) نفّذ هذا الملف في SQL Editor
--   3) في الواجهة: استخدم مفتاح "anon" العام فقط — لا تستخدم
--      service_role أبدًا في كود المتصفح
--   4) نفّذ واجهة التخزين البعيدة في js/storage.js بنفس الدوال
-- ============================================================

-- غرف/مجموعات أصدقاء لمقارنة عدة لاعبين معًا
create table if not exists public.share_groups (
  code         text primary key,                 -- رمز قصير يولّده العميل (مثال: 8 أحرف)
  challenge_id text not null,                    -- معرّف التحدي من محتوى اللعبة
  created_at   timestamptz not null default now()
);

-- نتيجة لاعب داخل مجموعة (بدون أي معلومات شخصية)
create table if not exists public.group_results (
  id            uuid primary key default gen_random_uuid(),
  group_code    text not null references public.share_groups(code) on delete cascade,
  display_name  text not null default 'لاعب',     -- اسم مستعار اختياري يكتبه اللاعب
  ending_id     text not null,
  title_key     text not null,
  stats         jsonb not null default '{}'::jsonb,  -- {bold, coop, caution, sacrifice}
  path          jsonb not null default '[]'::jsonb,  -- [{n: nodeId, c: choiceIndex}]
  created_at    timestamptz not null default now()
);

create index if not exists group_results_group_idx on public.group_results (group_code);

-- تفعيل Row Level Security (ضروري قبل أي وصول من الواجهة)
alter table public.share_groups  enable row level security;
alter table public.group_results enable row level security;

-- سياسات مبدئية للقراءة/الإضافة دون حسابات (راجعها بعناية قبل الإنتاج):
-- أي شخص يقدر ينشئ مجموعة ويقرأ مجموعات، ولا يستطيع التعديل أو الحذف.
create policy "groups_select" on public.share_groups for select using (true);
create policy "groups_insert" on public.share_groups for insert with check (true);

create policy "results_select" on public.group_results for select using (true);
create policy "results_insert" on public.group_results for insert with check (true);

-- تذكير: قبل الإطلاق العام أضف حدودًا على أطوال الحقول عبر CHECK
-- وحدود معدل (rate limiting) من لوحة Supabase.
