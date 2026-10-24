# Profile and settings

The authenticated `/profile` route contains Account, Preferences, Data export, and Log out.

## Weekly and monthly Reviews

Reviews are inside Profile and use authenticated `GET /api/reviews?kind=weekly|monthly&date=YYYY-MM-DD`. Omitting the date selects the server's current Asia/Dhaka period. Weeks are Monday–Sunday, independent of the browser's week-start preference. Previous/next navigation is bounded at the current period; current partial periods say **so far**. Request generations prevent a slow response from replacing a newer selection. Queries run in a read-only repeatable-read transaction and are owner-scoped. Log reads are bounded to the selected review and any intersecting quota calendar window (at most the relevant calendar-year span); version reads include only the window plus the first/predecessor rule needed to distinguish unknown and not-yet-started history. There is no query per habit.

Scheduled completion counts fulfilled occurrences against requirements known from effective-dated versions through the selected end date or today, whichever is earlier. Each quantitative scheduled occurrence is fulfilled when its own target is reached; minutes and repetitions are never summed together. If any relevant historical requirements are unknown, the overall rate is unavailable while known counts and recorded entry/check-in counts remain visible. No requirement is invented before a new habit or quota activates.

Flexible quotas are separate whole-calendar-period rows with the actual start/deadline, achieved amount, target, remaining amount and complete/incomplete/missed status. A quota overlapping the review is evaluated from that quota's activation through the review's as-of date; the row explicitly shows its whole period. Its units and percentage are not averaged into daily completion. Future quotas are omitted. Closed quotas without fulfilment are missed; excess totals never carry to another period. Closed target versions are retained when a pending edit activates.

Spending is the sum of actual expense amounts in the review, with exact decimal category totals. If category storage is missing, the row says Category unavailable rather than assigning a fabricated category. Monthly budget comparison appears only for an actual budget row, including a zero budget. Weekly reviews have no derived budget. Absence of expense records establishes no claim about no-spend days.

Complete periods may show the previous complete period's recorded spending and a scheduled completion rate only when both denominators are reliable. Current partial periods have no full-period comparison. Savings contributes one brief limitation: the current balance is not dated contribution history, so no historical savings delta or trend is claimed. There is no ledger, AI advice or journal feature.

## Persistence

- Display name updates `users.name` through `POST /profile/account`. It is account-persisted. Email is read-only. The change-password dialog posts to `POST /profile/password`, verifies the current bcrypt hash, then stores a new bcrypt hash (minimum 8 characters, maximum 72 UTF-8 bytes). Both account routes require the session-bound CSRF token rendered on Profile.
- Animations reuse `habitcents-motion-preference` and the existing JS/CSS motion controller. Clock format (`habitcents-clock-format`) and week start (`habitcents-week-start`) are local to this browser. Invalid or inaccessible storage falls back to 24-hour and Monday, the current app defaults.
- Logout retains the existing session-destroying `/logout` route.

## Exports

- `GET /profile/export/json` downloads schema version 1 with the authenticated user's account identity (name/email), habits, recorded habit logs, budgets, expense rows, savings goals, and supported schedule versions and recurring expense definitions. Monetary values are decimal strings. It does not include passwords, session/security values, or browser preferences.
- `GET /profile/export/expenses` downloads all owned expenses as UTF-8 CSV; `GET /profile/export/habits` downloads recorded habit logs only. Both return headers for empty datasets and use private no-store responses.
- JSON `warnings` and the response `X-Export-Warnings` header identify optional storage not installed. The base schema has no individual savings contribution history, so only each goal's current saved amount can be exported. Schedule versions and recurring definitions are included when their migration tables exist. Expense category and habit progress fields remain null when absent from the installation.

The additive recurrence export retains schema version 1 and all existing datasets. Habits include stored recurrence/tracking metadata; `habitScheduleHistory` includes active and pending effective-dated rules. `recordedHabitRules` associates each actual log with the known rule on its recorded date. Unknown historical target/unit/schedule values stay NULL; CSV no longer labels old records using today's target. Habit CSV adds tracking, recurrence JSON, weekdays and rule-effective date columns. Source `habitHistory` remains the unchanged recorded-log dataset. Optional owned habit categories, streak enrollment, days and requirement/rule evidence are included, as are full recurring definitions and payment linkage. JSON and habit CSV read a consistent read-only repeatable-read snapshot. Exports have no row cap, retain decimal strings, CSV formula escaping, no-store responses and explicit sensitive-field exclusions.

No schema migration or new dependency is required for these settings. Browser-local presentation preferences are not synchronized to the account.
