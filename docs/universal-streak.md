# Universal day streak: prepared forward-only support

This is separate from the legacy `/streak` difficulty-points endpoint. Existing points on the Habits page are unchanged.

## Confirmed policy

- All required habits complete earns exactly one day, irrespective of difficulty.
- A partial current day preserves the preceding streak until the database day closes. Undoing today's last required completion removes today's earned day.
- A closed incomplete day resets the count. A no-habit/rest day earns no day and resets at its closing deadline; it does not prematurely reset a still-open day.
- Adding/deleting or archiving a scheduled habit changes today's requirements; selected weekdays and specific dates participate only when due. Closed requirements/completions remain immutable evidence. Flexible quotas never enter the daily denominator or streak. Quota edits activate next period; captured future rules let unvisited days resolve correctly. See the approved recurrence rules in `docs/workspace-redesign.md`.
- Day boundaries explicitly use `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka')::date`, matching check-ins and monthly calculations even when a pooler reports UTC. The browser clock remains local and independent. Existing enrollment timezone values are never rewritten; non-Dhaka enrollments remain unavailable pending history review.

## Storage and setup (not executed live)

Prepared migration: `migrations/002-universal-streak-draft.sql`.

Three tables store an enrollment/tracking start, captured daily requirement sets, and the completion state of each captured required habit. Requirement identities intentionally do not cascade when a habit is deleted. No legacy logs, user current_streak field, difficulty points, or today's habit denominator are used to invent old streaks.

The migration alone does not activate tracking. Deployment/setup would require separate authorization: install the migration and capture-version-1 server, then enroll each account from the current authoritative date with confirmed reset/apply policies, current_setting('TimeZone'), capture_version=1, and an initial captureUniversalDay snapshot in the SAME transaction under the owned user-row lock. Do not backdate enrollment without reliable explicit snapshots. No setup/enrollment UI or automatic backfill was added.

All add/delete/reset/check-in mutations now capture an enrolled account's current requirement set and completions in the same transaction. One user-row lock serializes these operations. The snapshot updates are idempotent and the count is derived, not incremented. At read time, gaps AFTER a valid initial snapshot carry the previously captured requirement set with no completions: every application habit/completion mutation is captured atomically, so this is reliable forward-only evidence of no intervening activity. Gaps before the initial snapshot, unsealed evidence, older history or unconfirmed capture protocols remain unavailable. Direct database changes outside this protocol cannot be reconstructed and are unsupported.

GET `/universal-streak` uses the database day; optional `?date=YYYY-MM-DD` is strictly validated and read-only. Queries are scoped to the session user. Shapes always include status, count (null when unsupported), currentDate and asOfDate. Setup reasons distinguish missing tables, enrollment/policy/capture support, missing evidence, pre-tracking dates, future dates and timezone review. The dashboard shows a dash plus Setup required when support is absent, never a fabricated zero. Historical counts are labeled as of the selected date. Old responses cannot overwrite a newer date selection.

## Verification and limitations

Behavior tests were introduced failing before the evaluator and preview endpoint implementation. Full suite: 88 passed, 0 failed. Isolated PGlite tests install the prepared migration locally and cover real SQL, ownership, explicit daily denominators, check-in/undo, duplicate reads, immediate addition/deletion effects, durable closed-day history, known-cohort gaps, timezone-review protection, and unsupported storage/history. Pure tests cover deadline rollover and no-habit policy. Client tests cover stale historical responses, setup/failure states, and absence of dashboard contribution requests. Existing contribution renderer/helper/endpoint tests are retained for reuse; the dashboard no longer renders or fetches the grids.

The database-free preview uses seven explicit completed prior days and today's actual in-memory required/completed habits. Its 7-to-8-to-7 award/undo behavior is fixture data, not a normal-mode substitute. Setup and failed-request fixtures are separate.

Headless Chrome/CDP checks cover the populated desktop grouping, square top Savings, long names, large amounts, empty/errors, live clock/month/year rollover, calendar keyboard/focus/modal layering, daily chart values, savings selection, universal streak toggle/retry/setup, zero contribution requests, mobile 390px/320px and dock clearance. Normal populated 1440x900 fits one screen; 1366x768 scrolls naturally (881px document). Real font requests and computed families are checked. No live authenticated account data or physical device testing was performed.

The subsequently supplied Stack Sans reference establishes the intended vivid orange. Savings now uses #ff6000, visually matched to that image; this is not a claim of pixel sampling from the original raster. The reference is used for color only.

Changed for this pass: views/dashboard.ejs, public/css/dashboard-modules.css, public/js/dashboard.js, server.js, preview-server.js, lib/universal-streak.js, migrations/002-universal-streak-draft.sql, test/universal-streak.test.js, test/dashboard-behavior.test.js, test/server-postgres.test.js, test/preview-server.test.js, scripts/verify-dashboard.cjs, docs/universal-streak.md and docs/dashboard-additions.md. No credentials changes, live database writes/migrations/seeds, commits or deployment.
