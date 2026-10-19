-- Apply locally first. Do not run against a live database without separate authorization.
-- Additive: existing transactions retain their amount/date and become Uncategorized.
BEGIN;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS category VARCHAR(32) NOT NULL DEFAULT 'uncategorized'
 CHECK (category IN ('transport','food','subscriptions','shopping','uncategorized'));
COMMIT;
