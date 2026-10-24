# Safe, additive HabitCents demo seed

Artifact: `scripts/seed-demo.sql`, a single self-contained SQL file for an **existing registered HabitCents account in `public.users`**. Supabase Auth alone is insufficient. It does not create accounts or change passwords.

**Use a dedicated test account with no existing habits and no universal-streak enrollment.** Both conditions are enforced: manufacturing a deterministic account-wide streak for existing habits would require inventing historical obligations or changing real evidence. Existing financial data may remain, but mock expenses and goals affect totals. Other users' records are retained.

## Run it yourself

1. Back up and confirm the database/project/account. This file adds schema and explicit **mock activity**, affecting spending, savings and today's points/leaderboard. Never reapply the fresh-database `schema.postgres.sql` to an existing database.
2. Replace only `target_email`'s `REPLACE_WITH_REGISTERED_EMAIL` with the exact HabitCents signup email. Matching is case-sensitive, like login. Escape a single quote as two single quotes within that SQL literal. No password is needed.
3. The seed uses `SET LOCAL TIME ZONE 'Asia/Dhaka'` within its own transaction, matching the application tracking calendar. Runtime queries now select Dhaka explicitly even when the pooler reports UTC. Changing this seed literal does not configure the app or browser; a seed enrollment under another timezone remains unavailable pending review. No existing enrollment is rewritten.
4. Review embedded definitions from `migrations/001-expense-categories.sql` and `migrations/002-universal-streak-draft.sql`. Neither requires separate execution for the known schemas. Original migration files remain unchanged. Normal production enrollment must **not backfill real history**: this demo deliberately authors synthetic evidence only for its new unenrolled cohort. SQL does not upgrade an older deployed server; use the current capture-version-1 implementation.
5. As the trusted database owner, run the **entire file**, `BEGIN` through `COMMIT`, once in Supabase SQL Editor. Browser/anon roles are unsupported: tables have RLS without browser policies. Do not execute fragments or disable guards.
6. Confirm the success notice and refresh. Errors mean failure, not a partial seed. If a client leaves an aborted transaction open, issue `ROLLBACK;`. Investigate rather than deleting real activity to bypass guards.

No remote-connection command is supplied. Local seed tests do not load `.env`, use Supabase credentials or contact a remote database.

## Embedded migration scope and safety

Migrations/checks precede demo inserts **in the same transaction**. An advisory transaction lock serializes this file's executions; a target-user row lock matches current habit-mutation locking.

- Missing `expenses.category`: add migration 001's `VARCHAR(32) NOT NULL DEFAULT 'uncategorized'` and supported-category CHECK. Existing financial values/links remain intact; new metadata classifies legacy expenses as `uncategorized`. This is the one intentional addition to existing row representation, not a financial update.
- Existing category: validate type/length, nullability, ordinary non-generated/non-identity storage, default and validated supported-category CHECK. Additional constraints involving category (including `NOT VALID` checks, which still enforce new writes) abort **before any identity inserts** rather than failing late after creating demo habits. PostgreSQL 18's catalogued NOT NULL constraint is checked via column nullability. Incompatible definitions abort rather than cast, rewrite or repair. Equivalent but differently declared definitions may conservatively require manual review.
- Missing streak storage: add only migration 002's three tables, PKs, policy CHECKs, cascading ownership/day FKs and RLS. Captured `habit_id` intentionally has no cascading FK to mutable habits.
- Existing streak tables: compare types/lengths, nullability, defaults, identity/generated metadata and full constraint definitions/validation with temporary expected shapes. Existing RLS must already be enabled; existing security settings are not repaired. Extra/different columns or constraints abort. Temporary comparison tables contain no user data and disappear on commit/rollback.
- No existing user/profile/password, habit/log, expense, goal, budget or enrollment is updated/deleted. Missing monthly budgets are inserted at 18,000 in app currency units; existing budgets are reused unchanged with `ON CONFLICT DO NOTHING`. Low existing budgets can become overdrawn. No automatic cleanup/reset is supplied.

Schema mismatch or late failure rolls back **both additive DDL and inserted rows**. Identity sequences are nontransactional: late failures can leave normal gaps. Placeholder/missing-account/rerun/existing-habit/existing-enrollment guards precede DDL/inserts. Rerun tests verify no row or sequence mutations.

## Exact mock representation

### Habits and actual universal streak

Six `[Demo]` habits, scores 2–7, two each in `physical`, `spiritual`, `healthy`, with subtype rows. True-only logs cover **26 Monday-based calendar weeks**, starting `date_trunc('week', today)::date - 175` through today, matching current `/dashboard-continuity`. Older dates have deterministic habit-specific gaps. No future or false-status logs: today's list/summary/points count row existence, while history/continuity require true status.

Enrollment begins nine days ago with `empty_day_policy='reset'`, `day_change_policy='apply'`, `policies_confirmed=true`, `capture_version=1` and the transaction zone. All ten dates have sealed day rows and six required identities covering the **whole account**. Flags match actual completion logs:

| Relative date | Completed / required | Actual service result |
| --- | --- | --- |
| -9, -8, -7 | 6 / 6 each | Successful days 1, 2, 3 |
| -6 | 2 / 6 | Closed miss resets to 0 |
| -5 through -1 | 6 / 6 each | New successful run reaches 5 |
| Today | 3 / 6 | Partial day preserves 5; no unearned sixth day |

`lib/universal-streak.js` calculates this from evidence, not UI text or `users.current_streak`/`highest_streak`/`streak_points_earned` (untouched). Finishing the remaining habits via the current server earns day 6; undoing one restores 5. If today closes incomplete, it resets. With no later activity the service carries known requirements with zero completions: the demo is not permanently frozen at 5. Older logs do not establish pre-enrollment obligations; per-habit schedule-derived streaks remain unavailable.

This is **explicit synthetic evidence**, not recovered personal history. Enrollment/day tables have no label columns: provenance is the dedicated account and marked captured habit IDs. No permanent audit-marker schema is introduced.

### Spending, colors and savings

- **85 `[Demo]` expenses**, five categories on 17 dates at offsets `0,1,2,4,7,10,14,21,28,35,42,49,56,63,70,77,83`. Dates span this month and earlier months, never the future. On a month's first day only today's current-month point is possible; earlier months remain selectable.
- Supported category strings (not invented numeric IDs): `transport`, `food`, `subscriptions`, `shopping`, `uncategorized`, matching `lib/expense-category.js` and dashboard JavaScript. Existing `dashboard-modules.css` maps these to blue, peach, purple, green and neutral colors. SQL supplies data, not proof of rendered colors.
- Category bases `80,240,120,450,60`, plus `(offset % 7)*10 + offset*3`, make all 17 demo day totals distinct. Complete demo category totals: transport **3,206**, food **5,926**, subscriptions **3,886**, shopping **9,496**, uncategorized **2,866**. Existing expenses are additional.
- Each expense links to its owner's matching month/year budget. Budgets have no tag/name: new parents are traceable by demo expense links, but a reused budget is **not** demo-owned.
- Three `[Demo]` goals: partial 12,500/50,000; complete 8,000/8,000; empty 0/15,000.

Any owned habit name, expense description or goal name beginning `[Demo]` aborts before mutations, even in a later month. Existing enrollment independently blocks reuse. Leave markers intact: this is conservative guarding, not a permanent audit ledger. Removing/renaming all markers and enrollment can defeat it.

## Local verification only

With dependencies installed, from the project root:

```sh
node --test test/seed-demo.test.js test/seed-current.test.js test/universal-streak.test.js
```

Tests execute SQL using `@electric-sql/pglite` **in memory** on both the original PostgreSQL base without category and fully migrated storage including migration 002. They preserve target financial rows and another user's habits/logs; verify sums, budget links, goal states, true-only 26-week history, year/leap-day/week boundaries, row/sequence invariance on rerun, unsafe types/defaults/constraints/RLS, existing-habit/enrollment protection and late-failure rollback of added schema and rows. Placeholder, absent and wrong-case email tests compare the entire legacy schema, constraints, data and sequences after rollback. Actual `readUniversalStreak`/`captureUniversalDay` services verify reset, current partial day, completion/undo and timezone mismatch.

Local loopback HTTP integration tests also run the **delivered whole seed** on both schema variants, authenticate a local-only fixture through the actual `createApp` login route, and exercise `/dashboard-data`, `/dashboard-spending`, `/dashboard-breakdown`, `/get-habits`, `/savings-data`, `/universal-streak` and `/toggle-habit`. They verify actual monthly decimal totals/day rows, preserved budget/goal, 3-of-6 completion and account-wide 5 → 6 → 5 streak behavior, not a parallel test evaluator. Fixture-only password hashes never enter the seed. Importing the app factory does not load dotenv or create a remote pool.

Verified locally for this update: targeted command above **21 passed, 0 failed**; full `npm test` **102 passed, 0 failed, 0 skipped**. These are local results, not claims about an authenticated deployed account. No `.env` or Supabase credentials were read and no remote database was connected.

## Limits: not all features or UI states

This supplies populated Dashboard/Habits/Expenses/Savings data, date activity/history, category breakdown, varied spending, today's points and a **mock-evidence-derived** universal streak. It does not simulate empty/no-budget/zero-budget screens, invalid forms, errors/timeouts, stale/concurrent fetches, deployed RLS permissions, authentication, many-user ranking, layout/mobile rendering or live rollover. It cannot recover deleted histories, habit creation dates or schedules. PGlite is not a deployed Supabase/browser end-to-end test and cannot prove colors render or deployed timezone/roles match. Concurrent SQL Editor/app sessions are not modeled. Additive DDL takes normal table locks: use an appropriate maintenance window. Local verification performs no live writes, Git commits or deployment.

