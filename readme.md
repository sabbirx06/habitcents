# HabitCents – Habit & Expense Tracker

Android beta: [download the signed beta APK](https://github.com/sabbirx06/habitcents/releases/tag/v1.0.0-beta.1). Website: https://habitcents.duckdns.org. See [beta installation and release instructions](docs/beta-release.md).

Android: [build and run the mobile app locally](docs/android.md). The app uses the existing mobile views; no hosted server is required for testing over wireless debugging.

HabitCents is a productivity application that helps users build positive habits while managing their day-to-day finances. The system allows users to track daily habit completion, maintain streaks based on habit difficulty, and monitor monthly expenses against a predefined budget.

HabitCents is a productivity platform that helps users build their positive habits while also contributing in managing their day-to-day financial expenses. The platform allows users to track daily habit completion, maintain streaks based on them and also monitor their personal expenses along with tons of other features as well.

---

## Features

#### Create Habits with Difficulty Scoring

Users can create habits and assign a **difficulty score (0–9)**.

- **0** → Easiest habit
- **9** → Most difficult habit

Difficulty scoring determines the **streak points** awarded when a habit is completed. Habits with lower difficulty scores have a lower streak point while habits with higher difficulty score has a higher streak point.

---

#### Mark Habit Completion

Users can mark a habit as **completed for the day**, allowing the system to track daily progress.

---

#### Habit Streak Calculation

The system automatically calculates **habit streaks** based on daily completion.

Users earn **streak points** depending on the difficulty score of the habit.

---

#### Habit Categorization

Habits can be organized into different categories.

Example categories include:

- **Spiritual**
  - Praying Jummah
  - Weekly fasting

- **Physical**
  - Walking 10,000 steps
  - Exercising

- **Bad Habits**
  - Reducing smoking
  - Limiting social media use

- **Nutrition**
  - Calorie tracking
  - Eating balanced meals

---

#### Set Monthly Budget

Users can define a **monthly budget** at the beginning of each month.

---

#### Expense Tracking

Users can manage expenses through full **CRUD operations**:

- Add new expenses
- Edit existing expenses
- Delete expenses

---

#### Savings Calculation

At the end of the month, the system calculates the **remaining balance** from the monthly budget.

Users can allocate the saved money to different **savings goals**, such as:

- Buying a laptop
- Purchasing a camera
- Saving for a vacation

---

#### Overexpenditure Detection

If a user exceeds the allocated monthly budget, the system generates an **overexpenditure alert**.

---

#### Leaderboard

A leaderboard ranks users based on their **highest habit streaks**, encouraging motivation and consistency.

---

## Technology Stack

| Layer    | Technology            |
| -------- | --------------------- |
| Database | PostgreSQL (Supabase) |
| Backend  | Node.js / Express     |
| Frontend | HTML, CSS, JavaScript |


--- 

## Supabase PostgreSQL setup (server only)

Requires Node.js 20+ and npm. The Express server uses `pg`, not the Supabase browser client or Supabase Auth. **No anon/public/service-role API keys are needed.** Never put the database URL, password, CA contents, or session secret in browser JavaScript, templates, git, or screenshots.

1. Run `npm ci` (include dev dependencies to run tests).
2. Copy `.env.example` to `.env` locally. Set a long random `SESSION_SECRET` and your server-only `DATABASE_URL` from **Supabase Dashboard → Connect**. Percent-encode reserved characters in the database password. Keep the exact host, user and port supplied by Supabase:
   - Persistent Express server: direct connection when reachable over IPv6 (or an IPv4 add-on).
   - IPv4-only machine: choose the shared pooler **session mode** string instead (typically port 5432; the pooler username differs from the direct username).
   - The code uses unnamed parameterized queries, with no dependency on named prepared statements. It checks out one connection for the habit-toggle transaction. Session mode is the recommended default here.
3. TLS certificate and hostname verification are mandatory (`rejectUnauthorized: true`). If Node does not trust the endpoint certificate, download the database CA PEM from Supabase Database settings and set `DATABASE_CA_CERT_PATH` to its local absolute path. Do not disable verification. Remove `sslmode`, `sslrootcert`, and other `ssl*` URL parameters: this application rejects them because `pg` can otherwise override the explicit TLS configuration. Never set `NODE_TLS_REJECT_UNAUTHORIZED=0`.
4. For a **new empty** database only, review and manually apply `schema.postgres.sql` once using Supabase SQL Editor or a trusted PostgreSQL client. It is transactional, creates nine tables and indexes, and contains no DROP/reset statements. It intentionally fails on existing table names rather than silently changing existing data. **Do not execute `schema.sql`: it is the unchanged historical MySQL schema and contains a destructive database reset.** No schema command is run automatically at startup.
5. Use a trusted server database role with table/sequence access and RLS bypass (the schema owner, such as the provided `postgres` role, works for initial setup). RLS is enabled with no browser policies: browser API roles cannot read these tables. This is custom Express session authentication, not Supabase `auth.uid()` authentication. A least-privilege non-owner role requires deliberately designed server RLS policies or scoped RLS bypass; do not disable RLS to make browser queries work. All ownership checks run in Express/SQL.
6. Run `npm start`, then open `http://localhost:3000`. Startup validates configuration but opens database connections lazily; it is **not** a live database health check. Verify signup/login and data operations against your own staging database after configuration.

Connection reference: [Supabase Postgres connections](https://supabase.com/docs/guides/database/connecting-to-postgres) and [SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement). The application does not change remote SSL enforcement settings.

### Existing MySQL data and accounts

This change supplies the PostgreSQL application/schema, **not an automatic data-copy or destructive reset utility**. Back up MySQL, transform/import into a separate staging PostgreSQL database, validate row counts, foreign keys and balances, then plan a controlled cutover. Preserve IDs; advance each identity sequence above the imported maximum before enabling writes. Clean up duplicate monthly budgets and invalid/null foreign keys, emails, habit scores and amounts before import; PostgreSQL adds required fields/check constraints and one budget per user/month/year. MySQL boolean values must be converted to PostgreSQL booleans.

New signups store bcrypt hashes (cost 12); login compares bcrypt hashes only. Passwords over bcrypt's 72-byte UTF-8 limit are rejected rather than silently truncated. **Legacy plaintext password rows are deliberately unable to log in.** Do not copy plaintext credentials as if they were hashes, and do not add a plaintext login fallback. Existing users need a verified password-reset/re-enrollment process and freshly hashed passwords before cutover; this repository does not implement a reset-email flow. Existing genuine bcrypt `$2a$`/`$2b$` hashes may be retained. Never retain passwords/hashes in user sessions.

Changes relevant to imported data: replacing a budget now uses PostgreSQL upsert and retains linked expenses. Deleting/resetting a budget detaches expenses (`ON DELETE SET NULL`) rather than deleting expense history; monthly spending totals still include those expenses. Habit deletion cascades logs only after matching the authenticated owner. Habit toggles lock the owned row in a transaction, preventing cross-user modification and serializing concurrent toggles. Tracking days and current monthly calculations explicitly use Asia/Dhaka, independent of connection timezone. Profile week start is display-only; browser clock display remains local. See [approved recurrence rules and additive activation](docs/workspace-redesign.md) and [Profile reviews/export definitions](docs/profile-settings.md).

### Local verification without credentials

```sh
npm test
npm run test:postgres
npm run preview
```

The tests execute the real PostgreSQL schema and route SQL in an isolated, in-memory PGlite PostgreSQL engine. They exercise signup/login, bcrypt rejection of plaintext, authenticated HTTP routes, habit ownership/cascades, budgets, expenses, dashboard, leaderboard and savings. TLS option tests exercise the `pg` configuration without opening sockets. Existing dashboard/preview tests remain independent of any database. Test data is temporary and local; no `.env` or remote connection is used. No destructive reset route is invoked by the tests.

These tests validate PostgreSQL syntax and application behavior, **not a live Supabase connection, TLS handshake, pooler behavior, production role permissions, or multi-connection contention**. Those still need staging verification with your own credentials. The current default Express session MemoryStore is suitable for local development only. Before production, add a persistent session store, HTTPS/secure cookie configuration, CSRF protection (especially legacy GET reset routes), rate limiting, and review existing npm audit findings. This migration does not deploy the application or claim production readiness.

---

## EER Diagram

<img width="1604" height="789" alt="673518321_2416310138889516_1682432696686418862_n" src="https://github.com/user-attachments/assets/63109443-eb0f-4bc3-9bd7-b52e37fffada" />



--- 

## Normalised Schema Diagram

<img width="1198" height="641" alt="672478732_2003272990395281_3361666801120849104_n" src="https://github.com/user-attachments/assets/89752bfc-e074-4099-8b61-eadab2a0a9cb" />

Dashboard category/continuity additions require the additive expense-category migration for classified writes on an existing database. See [dashboard additions and local setup](docs/dashboard-additions.md). No live migration is performed by the application or test suite.
