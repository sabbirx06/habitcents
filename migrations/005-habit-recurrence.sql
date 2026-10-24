-- Additive; prerequisites: PostgreSQL base + 001, 002 and 003 installed completely.
-- Apply only with separate live authorization. No enrollment/date/log rewrites.
BEGIN;
DO $preflight$
BEGIN
 IF to_regclass('habit_schedule_versions') IS NULL
 OR to_regclass('recurring_expenses') IS NULL
 OR to_regclass('universal_streak_enrollments') IS NULL
 OR to_regclass('universal_streak_days') IS NULL
 OR to_regclass('universal_streak_requirements') IS NULL
 OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='habit_logs' AND column_name='progress_amount')
 THEN RAISE EXCEPTION 'Prerequisites missing: inspect storage status and install complete migrations 001, 002 and 003 first.';
 END IF;
END;
$preflight$;
ALTER TABLE habits ADD COLUMN recurrence JSONB;
ALTER TABLE habits ADD COLUMN tracking TEXT CHECK(tracking IN ('checkoff','count','measure'));
ALTER TABLE habit_schedule_versions ADD COLUMN recurrence JSONB;
ALTER TABLE habit_schedule_versions ADD COLUMN tracking TEXT CHECK(tracking IN ('checkoff','count','measure'));
-- Existing version rows retain their exact weekday/target evidence; NULL means legacy rules.
ALTER TABLE universal_streak_requirements ADD COLUMN IF NOT EXISTS schedule_days SMALLINT[];
ALTER TABLE universal_streak_requirements ADD COLUMN rules JSONB;
CREATE INDEX habit_versions_effective_idx ON habit_schedule_versions(habit_id,effective_on DESC);
COMMIT;
