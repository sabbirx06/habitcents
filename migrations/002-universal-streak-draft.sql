-- Prepared forward-only universal streak evidence. Do not execute on live Supabase.
-- No backfill: old habit logs do not establish historical required habit sets.
-- Confirmed policy: no-habit closed days reset; habit changes apply today.
-- This migration alone does not activate streaks. Enrollment requires an atomic
-- initial snapshot using captureUniversalDay with the server's CURRENT_DATE and
-- current_setting('TimeZone'), after the capture-version-1 server is installed.
BEGIN;
CREATE TABLE universal_streak_enrollments (
 user_id INTEGER PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
 starts_on DATE NOT NULL,
 empty_day_policy TEXT CHECK (empty_day_policy IN ('pause','reset','earn')),
 day_change_policy TEXT CHECK (day_change_policy IN ('freeze','apply')),
 policies_confirmed BOOLEAN NOT NULL DEFAULT false,
 time_zone TEXT NOT NULL,
 capture_version INTEGER NOT NULL DEFAULT 0 CHECK (capture_version IN (0,1))
);
CREATE TABLE universal_streak_days (
 user_id INTEGER NOT NULL REFERENCES universal_streak_enrollments(user_id) ON DELETE CASCADE,
 day DATE NOT NULL,
 requirements_complete BOOLEAN NOT NULL DEFAULT false,
 PRIMARY KEY(user_id,day)
);
CREATE TABLE universal_streak_requirements (
 user_id INTEGER NOT NULL,
 day DATE NOT NULL,
 -- A captured identity, intentionally not a cascading FK to mutable habits.
 habit_id BIGINT NOT NULL,
 completed BOOLEAN NOT NULL DEFAULT false,
 PRIMARY KEY(user_id,day,habit_id),
 FOREIGN KEY(user_id,day) REFERENCES universal_streak_days(user_id,day) ON DELETE CASCADE
);
ALTER TABLE universal_streak_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE universal_streak_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE universal_streak_requirements ENABLE ROW LEVEL SECURITY;
COMMIT;
