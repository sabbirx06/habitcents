-- HabitCents additive demo data. REVIEW BEFORE RUNNING; no live connection is made by this file.
-- Edit the target_email literal below to the EXACT email in public.users (app signup,
-- not merely Supabase Auth). This script never creates accounts or changes passwords.
-- Run the ENTIRE file once in Supabase SQL Editor as the trusted database owner.
-- Back up first. Use an unenrolled account with NO existing habits.
-- All new activity is synthetic and linked to [Demo] habits/expenses/goals; it WILL affect totals,
-- today's points/leaderboard and financial summaries alongside your real data.
-- Budgets have no label column: new monthly rows are linked to [Demo] expenses;
-- existing monthly budgets are reused unchanged (possibly producing overspending).
-- This is NOT a reset/cleanup script. Do not remove guards to rerun it.
BEGIN;
SET LOCAL search_path = public, pg_temp;
-- Match the authoritative Asia/Dhaka tracking calendar, independent of pooler settings.
-- Browser clock display remains local.
-- This setting applies ONLY to this seed transaction, not to the running app.
SET LOCAL TIME ZONE 'Asia/Dhaka';

DO $demo$
DECLARE
    target_email text := 'REPLACE_WITH_REGISTERED_EMAIL';
    owner_id integer;
    demo_today date := CURRENT_DATE;
    start_day date := date_trunc('week', demo_today)::date - 175;
    new_habit_id bigint;
    habit_number integer;
    habit_label text;
    habit_category text;
    expense_day date;
    month_day date;
    day_offset integer;
    category_number integer;
    category_name text;
    category_amount numeric;
    matching_budget integer;
    existing_enrollment boolean;
    storage_name text;
    expected_oid oid;
    actual_oid oid;
BEGIN
    -- Serialize this file's additive DDL as well as its account writes.
    PERFORM pg_advisory_xact_lock(726813, 1);
    IF target_email IS NULL OR btrim(target_email)='' OR target_email LIKE 'REPLACE_%'
       OR position('@' IN target_email)=0 THEN
        RAISE EXCEPTION 'Replace target_email with the exact registered account email before running.';
    END IF;
    SELECT user_id INTO owner_id FROM public.users WHERE email = target_email FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registered account not found in public.users; sign up in HabitCents first. No changes made.';
    END IF;

    -- Parent row lock serializes concurrent seeds for this account. Conservative:
    -- even a partial/manual [Demo] record blocks another seed, including next month.
    IF EXISTS (SELECT 1 FROM public.habits WHERE user_id=owner_id AND habit_name LIKE '[Demo]%')
       OR EXISTS (SELECT 1 FROM public.expenses WHERE user_id=owner_id AND description LIKE '[Demo]%')
       OR EXISTS (SELECT 1 FROM public.savings_goals WHERE user_id=owner_id AND name LIKE '[Demo]%') THEN
        RAISE EXCEPTION 'Account already contains [Demo] data; seed aborted without changes.';
    END IF;

    -- Never rewrite a real enrollment or invent required sets for existing habits.
    IF EXISTS (SELECT 1 FROM public.habits WHERE user_id=owner_id) THEN
        RAISE EXCEPTION 'Demo streak requires an account with no existing habits. Use a dedicated registered test account; no changes made.';
    END IF;
    IF to_regclass('public.universal_streak_enrollments') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.universal_streak_enrollments WHERE user_id=$1)'
            INTO existing_enrollment USING owner_id;
        IF existing_enrollment THEN
            RAISE EXCEPTION 'Existing streak enrollment must not be overwritten. Use an unenrolled dedicated test account.';
        END IF;
    END IF;

    -- Reviewed additive migration 001; never reapply the fresh-database schema.
    -- Only legacy category metadata is added; existing financial values are retained.
    ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS category VARCHAR(32) NOT NULL DEFAULT 'uncategorized'
        CHECK (category IN ('transport','food','subscriptions','shopping','uncategorized'));
    CREATE TEMP TABLE _demo_expected_category (
        category VARCHAR(32) NOT NULL DEFAULT 'uncategorized'
        CHECK (category IN ('transport','food','subscriptions','shopping','uncategorized'))
    ) ON COMMIT DROP;
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute a JOIN pg_attribute e
          ON e.attrelid='pg_temp._demo_expected_category'::regclass AND e.attname=a.attname
        JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
        JOIN pg_attrdef ed ON ed.adrelid=e.attrelid AND ed.adnum=e.attnum
        WHERE a.attrelid='public.expenses'::regclass AND a.attname='category'
          AND a.atttypid=e.atttypid AND a.atttypmod=e.atttypmod AND a.attnotnull=e.attnotnull
          AND a.attgenerated=e.attgenerated AND a.attidentity=e.attidentity
          AND pg_get_expr(ad.adbin,ad.adrelid)=pg_get_expr(ed.adbin,ed.adrelid)
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint a JOIN pg_constraint e
          ON e.conrelid='pg_temp._demo_expected_category'::regclass
          AND pg_get_constraintdef(a.oid)=pg_get_constraintdef(e.oid)
        WHERE a.conrelid='public.expenses'::regclass AND a.contype='c' AND a.convalidated
    ) OR EXISTS (
        -- A second category constraint can silently narrow the supported set even
        -- when migration 001's CHECK is present. Reject it before identity inserts,
        -- including NOT VALID constraints (which still enforce new writes).
        SELECT 1 FROM pg_constraint a
        JOIN pg_attribute col ON col.attrelid=a.conrelid AND col.attname='category'
        WHERE a.conrelid='public.expenses'::regclass AND col.attnum=ANY(a.conkey)
          AND a.contype<>'n' -- PostgreSQL 18 catalogs the separately checked NOT NULL.
          AND NOT (a.contype='c' AND a.convalidated AND EXISTS (
              SELECT 1 FROM pg_constraint e
              WHERE e.conrelid='pg_temp._demo_expected_category'::regclass
                AND pg_get_constraintdef(a.oid)=pg_get_constraintdef(e.oid)
          ))
    ) THEN
        RAISE EXCEPTION 'Unsafe expenses.category definition: expected migration 001 varchar(32), NOT NULL, default and only validated supported-category CHECK. Review schema manually.';
    END IF;

    -- Existing storage must already have reviewed RLS; do not change an existing
    -- deployment's access model while seeding. Newly created tables get RLS below.
    FOREACH storage_name IN ARRAY ARRAY['universal_streak_enrollments','universal_streak_days','universal_streak_requirements'] LOOP
        actual_oid := to_regclass('public.' || storage_name);
        IF actual_oid IS NOT NULL AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid=actual_oid) THEN
            RAISE EXCEPTION 'Unsafe % RLS state: review migration 002 manually; no existing security settings changed.',storage_name;
        END IF;
    END LOOP;

    -- Reviewed storage from migration 002, not an automatic production backfill.
    -- This file explicitly authors MOCK evidence only for its empty demo account.
    CREATE TABLE IF NOT EXISTS public.universal_streak_enrollments (
        user_id INTEGER PRIMARY KEY REFERENCES public.users(user_id) ON DELETE CASCADE,
        starts_on DATE NOT NULL,
        empty_day_policy TEXT CHECK (empty_day_policy IN ('pause','reset','earn')),
        day_change_policy TEXT CHECK (day_change_policy IN ('freeze','apply')),
        policies_confirmed BOOLEAN NOT NULL DEFAULT false,
        time_zone TEXT NOT NULL,
        capture_version INTEGER NOT NULL DEFAULT 0 CHECK (capture_version IN (0,1))
    );
    CREATE TABLE IF NOT EXISTS public.universal_streak_days (
        user_id INTEGER NOT NULL REFERENCES public.universal_streak_enrollments(user_id) ON DELETE CASCADE,
        day DATE NOT NULL,
        requirements_complete BOOLEAN NOT NULL DEFAULT false,
        PRIMARY KEY(user_id,day)
    );
    CREATE TABLE IF NOT EXISTS public.universal_streak_requirements (
        user_id INTEGER NOT NULL,
        day DATE NOT NULL,
        habit_id BIGINT NOT NULL,
        completed BOOLEAN NOT NULL DEFAULT false,
        PRIMARY KEY(user_id,day,habit_id),
        FOREIGN KEY(user_id,day) REFERENCES public.universal_streak_days(user_id,day) ON DELETE CASCADE
    );
    -- Expected shapes let the catalog checks compare types, defaults, PKs, FKs,
    -- policy CHECKs and validation, not just table names. No existing DDL repaired.
    CREATE TEMP TABLE _demo_expected_users (user_id INTEGER PRIMARY KEY) ON COMMIT DROP;
    CREATE TEMP TABLE _demo_expected_universal_streak_enrollments (
        user_id INTEGER PRIMARY KEY REFERENCES pg_temp._demo_expected_users(user_id) ON DELETE CASCADE,
        starts_on DATE NOT NULL,
        empty_day_policy TEXT CHECK (empty_day_policy IN ('pause','reset','earn')),
        day_change_policy TEXT CHECK (day_change_policy IN ('freeze','apply')),
        policies_confirmed BOOLEAN NOT NULL DEFAULT false,
        time_zone TEXT NOT NULL,
        capture_version INTEGER NOT NULL DEFAULT 0 CHECK (capture_version IN (0,1))
    ) ON COMMIT DROP;
    CREATE TEMP TABLE _demo_expected_universal_streak_days (
        user_id INTEGER NOT NULL REFERENCES pg_temp._demo_expected_universal_streak_enrollments(user_id) ON DELETE CASCADE,
        day DATE NOT NULL,
        requirements_complete BOOLEAN NOT NULL DEFAULT false,
        PRIMARY KEY(user_id,day)
    ) ON COMMIT DROP;
    CREATE TEMP TABLE _demo_expected_universal_streak_requirements (
        user_id INTEGER NOT NULL,
        day DATE NOT NULL,
        habit_id BIGINT NOT NULL,
        completed BOOLEAN NOT NULL DEFAULT false,
        PRIMARY KEY(user_id,day,habit_id),
        FOREIGN KEY(user_id,day) REFERENCES pg_temp._demo_expected_universal_streak_days(user_id,day) ON DELETE CASCADE
    ) ON COMMIT DROP;
    FOREACH storage_name IN ARRAY ARRAY['universal_streak_enrollments','universal_streak_days','universal_streak_requirements'] LOOP
        actual_oid := to_regclass('public.' || storage_name);
        expected_oid := to_regclass('pg_temp._demo_expected_' || storage_name);
        IF EXISTS (
            SELECT 1 FROM (
                (SELECT a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attidentity,a.attgenerated,
                        pg_get_expr(d.adbin,d.adrelid) AS default_expr
                 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
                 WHERE a.attrelid=actual_oid AND a.attnum>0 AND NOT a.attisdropped
                 EXCEPT
                 SELECT a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attidentity,a.attgenerated,
                        pg_get_expr(d.adbin,d.adrelid)
                 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
                 WHERE a.attrelid=expected_oid AND a.attnum>0 AND NOT a.attisdropped)
                UNION ALL
                (SELECT a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attidentity,a.attgenerated,
                        pg_get_expr(d.adbin,d.adrelid)
                 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
                 WHERE a.attrelid=expected_oid AND a.attnum>0 AND NOT a.attisdropped
                 EXCEPT
                 SELECT a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attidentity,a.attgenerated,
                        pg_get_expr(d.adbin,d.adrelid)
                 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
                 WHERE a.attrelid=actual_oid AND a.attnum>0 AND NOT a.attisdropped)
            ) difference
        ) OR EXISTS (
            SELECT 1 FROM (
                (SELECT pg_get_constraintdef(oid),convalidated FROM pg_constraint WHERE conrelid=actual_oid
                 EXCEPT SELECT replace(pg_get_constraintdef(oid),'_demo_expected_',''),convalidated FROM pg_constraint WHERE conrelid=expected_oid)
                UNION ALL
                (SELECT replace(pg_get_constraintdef(oid),'_demo_expected_',''),convalidated FROM pg_constraint WHERE conrelid=expected_oid
                 EXCEPT SELECT pg_get_constraintdef(oid),convalidated FROM pg_constraint WHERE conrelid=actual_oid)
            ) difference
        ) THEN
            RAISE EXCEPTION 'Unsafe % definition: columns/defaults/constraints differ from reviewed migration 002. Review schema manually.',storage_name;
        END IF;
        -- Idempotent for migrated storage, required for newly added storage.
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',storage_name);
    END LOOP;

    -- 26 Monday-based calendar weeks, current partial week included. Missing rows
    -- mean incomplete: /get-habits and today's summary count row existence while
    -- history/activity/continuity require completed_status IS TRUE. Never insert false logs.
    FOR habit_number IN 1..6 LOOP
        habit_label := (ARRAY['Morning walk','Strength practice','Quiet reflection',
                              'Gratitude journal','Drink water','Evening wind-down'])[habit_number];
        habit_category := (ARRAY['physical','physical','spiritual','spiritual','healthy','healthy'])[habit_number];
        INSERT INTO public.habits(user_id,habit_name,difficulty_score,category)
        VALUES(owner_id,'[Demo] ' || habit_label,habit_number+1,habit_category)
        RETURNING habit_id INTO new_habit_id;
        CASE habit_category
            WHEN 'physical' THEN INSERT INTO public.physical_habits(habit_id) VALUES(new_habit_id);
            WHEN 'spiritual' THEN INSERT INTO public.spiritual_habits(habit_id) VALUES(new_habit_id);
            WHEN 'healthy' THEN INSERT INTO public.healthy_habits(habit_id) VALUES(new_habit_id);
        END CASE;
        INSERT INTO public.habit_logs(habit_id,date,completed_status)
        SELECT new_habit_id,start_day + n,true
        FROM generate_series(0,demo_today-start_day) AS series(n)
        WHERE CASE WHEN start_day+n=demo_today THEN habit_number<=3
                   WHEN start_day+n=demo_today-6 THEN habit_number<=2
                   WHEN start_day+n>=demo_today-9 THEN true
                   ELSE (n+habit_number) % (habit_number+1)<>0 END;
        -- streak_points_earned intentionally NULL, matching /toggle-habit.
    END LOOP;

    -- Explicit MOCK account-wide snapshot evidence. Enrollment begins only where
    -- the seed defines the complete required cohort, never inferred from old logs.
    INSERT INTO public.universal_streak_enrollments
        (user_id,starts_on,empty_day_policy,day_change_policy,policies_confirmed,time_zone,capture_version)
    VALUES(owner_id,demo_today-9,'reset','apply',true,current_setting('TimeZone'),1);
    INSERT INTO public.universal_streak_days(user_id,day,requirements_complete)
    SELECT owner_id,demo_today-n,true FROM generate_series(0,9) AS days(n);
    INSERT INTO public.universal_streak_requirements(user_id,day,habit_id,completed)
    SELECT owner_id,d.day,h.habit_id,COALESCE(l.completed_status,false)
    FROM public.universal_streak_days d JOIN public.habits h ON h.user_id=d.user_id
    LEFT JOIN public.habit_logs l ON l.habit_id=h.habit_id AND l.date=d.day
    WHERE d.user_id=owner_id;
    -- -9..-7: 3 successes; -6: closed miss/reset; -5..-1: 5 successes;
    -- today: 3/6 complete, retains 5 until today's deadline (or becomes 6 if finished).

    -- 17 recent dates across 84 days; all 5 exact category keys on each date.
    FOREACH day_offset IN ARRAY ARRAY[0,1,2,4,7,10,14,21,28,35,42,49,56,63,70,77,83] LOOP
        expense_day := demo_today-day_offset;
        month_day := date_trunc('month',expense_day)::date;
        INSERT INTO public.budgets(user_id,total_budget,month,year)
        VALUES(owner_id,18000,EXTRACT(MONTH FROM month_day),EXTRACT(YEAR FROM month_day))
        ON CONFLICT(user_id,month,year) DO NOTHING;
        SELECT budget_id INTO STRICT matching_budget FROM public.budgets
        WHERE user_id=owner_id AND month=EXTRACT(MONTH FROM month_day) AND year=EXTRACT(YEAR FROM month_day);
        FOR category_number IN 1..5 LOOP
            category_name := (ARRAY['transport','food','subscriptions','shopping','uncategorized'])[category_number];
            category_amount := (ARRAY[80,240,120,450,60])[category_number] + (day_offset % 7)*10 + day_offset*3;
            INSERT INTO public.expenses(user_id,budget_id,date,description,category,amount)
            VALUES(owner_id,matching_budget,expense_day,'[Demo] ' || category_name || ' sample - ' || expense_day,category_name,category_amount);
        END LOOP;
    END LOOP;

    INSERT INTO public.savings_goals(user_id,name,saved_amount,target_amount) VALUES
        (owner_id,'[Demo] Emergency fund (partial)',12500,50000),
        (owner_id,'[Demo] Learning fund (complete)',8000,8000),
        (owner_id,'[Demo] Travel fund (empty)',0,15000);
    RAISE NOTICE 'Demo seeded for account ID %, calendar %, timezone %. Existing budgets preserved.', owner_id,demo_today,current_setting('TimeZone');
END;
$demo$;
COMMIT;
