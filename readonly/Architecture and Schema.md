---
title: "HabitCents — Architecture and Schema"
created: "2026-10-18"
updated: "2026-10-18"
type: reference
tags: [project, architecture, database-schema]
---

# HabitCents — Architecture and Schema

Repository: `C:\Users\Sabbir Ahmed\Desktop\projects\habitcents`

## Current Architecture (source inspected 2026-10-18)
- **Server:** Node.js CommonJS with Express 5. `server.js` combines page routing, authentication, business logic, and endpoints.
- **Rendering:** EJS templates under `views/`; shared head/navbar/footer partials.
- **Client:** CSS and browser ES modules under `public/`; page scripts fetch same-origin routes and render data.
- **Persistence:** MySQL through `mysql2` in `db.js`, configured using `MYSQL_PUBLIC_URL`.
- **Authentication:** `express-session`; login state is stored in `req.session.user`; `requireLogin` protects selected routes.
- **Dependencies:** Express, EJS, express-session, mysql2, bcrypt, dotenv, body-parser, nodemon. `bcrypt` is installed but unused in the inspected authentication flow.
- **Tests:** `npm test` is a placeholder that exits with “no test specified.”

## Schema (`schema.sql`)

| Table | Purpose and key fields | Relationships / notes |
|---|---|---|
| `users` | `user_id` PK, name, unique email, password, age, current/highest streak | Account; stored streak fields are not maintained by current logic. |
| `habits` | `habit_id` PK (BIGINT), user, name, difficulty, category | User-owned; IDs generated as timestamps in app code. |
| `habit_logs` | `log_id` PK, habit, date, completion status, earned points | Unique `(habit_id,date)`; toggle route does not set points. |
| `physical_habits` | `habit_id` PK/FK | Subtype table; no application use observed. |
| `spiritual_habits` | `habit_id` PK/FK | Subtype table; no application use observed. |
| `healthy_habits` | `habit_id` PK/FK | Subtype table; no application use observed. |
| `budgets` | `budget_id` PK, user, amount, month, year | Monthly allocation; no unique user/month/year constraint. |
| `expenses` | `expense_id` PK, user, budget, date, description, amount | Budget deletion cascades to linked expenses. |
| `savings_goals` | `goal_id` PK, user, name, saved amount, target amount | User-owned savings target. |

## Existing Flows
Pages: landing, login, signup, dashboard, habits, categories, expenses, savings, leaderboard. Habit endpoints manage CRUD-ish actions and today’s points; budget/expense endpoints manage current-month spending; savings endpoints create goals and add contributions; leaderboard aggregates today’s habit difficulty points.

## Findings to Revisit Before Feature Work
1. Passwords are stored and checked as plaintext despite the bcrypt dependency.
2. Session secret is hard-coded; default in-memory session store is used; full user record, including password, is stored in session.
3. Database errors and input validation are inconsistently handled.
4. Ownership checks are uneven; habit toggle checks the supplied habit ID/date but not that the habit belongs to the logged-in user.
5. Client calls `POST /delete-habit-by-name`, but no matching server route was found.
6. Replacing/resetting a budget deletes budget rows; foreign-key cascade can delete linked expenses.
7. Expense totals filter by user/date rather than budget ID, making behavior ambiguous across budget changes.
8. User/database strings are interpolated into `innerHTML`, creating injection risk.
9. Current “streak” reports today’s points, not consecutive-day streaks; stored streak columns are unused.
10. Constraints/defaults are sparse for positive amounts, difficulty/month ranges, and unique monthly budgets.
11. The server is monolithic and has no meaningful automated test suite.

## Native-App Implication (proposal)
The existing server-rendered routes are not yet a stable mobile API. A reasonable path is to retain/refactor the Node/MySQL backend, add secure validated JSON endpoints, and build a native client. React Native with Expo has been suggested but is not selected. Plan and test data migrations before changing existing semantics.

## Verification Boundary
Source inspection only: the app was not run, dependencies were not installed, and MySQL was not connected. Recheck findings before implementation.
