---
title: "HabitCents — Features and Scope"
created: "2026-10-18"
updated: "2026-10-18"
type: summary
tags: [project, features, planning]
---

# HabitCents — Features and Scope

## Scope and Evidence
Current priority: revamp the existing web app; native app deferred. Inventory below comes from reading `server.js`, `schema.sql`, relevant EJS views, and browser modules on 2026-10-18. The app/database were not run; implemented source paths are not verified working behavior.

## Existing Features
- Public landing page; account registration with name/email/password, duplicate-email check, session login/logout, and login-gated app pages.
- Dashboard: personalized greeting, today's completed/total habits, current-month remaining budget, budget progress bar, low-budget/overspending warnings, navigation shortcuts.
- Habits: create a named habit with difficulty 1–10 and physical/spiritual/healthy category; list and filter by category; check/uncheck today; daily points from completed habit difficulty; delete individual habits; reset all habits and history with confirmation.
- Preset habit library: physical (walking 10,000 steps, gym, football), spiritual (meditation, prayer, gratitude journal), healthy (water, sleeping early, healthy eating); add presets and synchronize selection indicators. Removing presets from that page is incomplete: client calls a missing `/delete-habit-by-name` route.
- Budget: set current-month budget, remaining-balance/progress display, low/critical/overspending warnings, change/reset controls. Existing change/reset deletes budget records and can cascade-delete linked expenses; not a safe edit flow.
- Expenses: add description and amount against an existing current-month budget, automatic today's date, list user expenses newest date first, delete entries. Listing is not restricted to the current month; dates are not displayed in the current list.
- Savings: multiple named targets, add contributions, display saved/target amounts, percentage rings and completed-goal coloring. No contribution ledger or edit/delete goal workflow.
- Leaderboard: up to 20 users, ranks and top-three medals, current-user highlight. Intended daily completion scoring is incorrect: SQL sums habit difficulty regardless of whether today's joined log exists.
- Currency display is hard-coded to Bangladeshi taka (৳).

## Important Boundaries
- Current “streak” means today's difficulty points, not consecutive days; schema streak fields do not make streak tracking implemented.
- No implemented scheduling, quantitative habit targets, visible history calendar, habit editing/archiving, expense categories/editing/date selection, monthly history browsing, income tracking, or savings contribution history was found in the inspected flows.
- See [[Projects/HabitCents/Architecture and Schema|Architecture and Schema]] for security and data-integrity concerns. Fresh inspection additionally identified the leaderboard scoring issue above.

## Review Status
- **Current features:** the source-inspected inventory above, including its limitations. Not newly runtime-verified.
- **Suggested — not yet confirmed:** every addition, extension, visualization, and detailed design treatment below. Saving these for review does not approve implementation or release scope.
- User confirmed that the shared screenshot references are inspiration for **both appearance and tracking/insight features**. That broad direction does not confirm each pictured metric or the exact palette, typography, layout, or chart.
- Priority groups and sequencing are assistant recommendations only. User will review and select later.

## Suggested — Not Yet Confirmed: Habit Tracking
- Real current and best consecutive-day streaks per habit, respecting schedules/rest days.
- Individual habit history calendars and year-at-a-glance completion heatmaps.
- Click a day to inspect or correct past check-ins.
- Distinct states for completed, missed, not logged, and not scheduled; define these semantics before implementation.
- Completion rates over time and monthly session/completion counts.
- Weekly target achievement, gaps, and returns to a habit.
- Edit habit names, categories, and difficulty.
- Archive habits without deleting history; temporarily pause habits.
- Flexible schedules: daily, selected weekdays, or a target number of times per week; show only habits due today.
- Quantitative targets and partial progress: reading minutes, water glasses, steps, and similar units.
- Optional duration/time entries to support time-spent summaries rather than inferring duration from a checkbox.
- Personalized habit colors and icons.

## Suggested — Not Yet Confirmed: Expenses and Budgeting
- Expense categories such as food, transport, education, bills, and entertainment.
- Date selection/backdated entries; visible transaction dates.
- Edit existing expenses.
- Search/filter by category, date, and amount.
- Historical month browsing and month-to-month comparisons.
- Safe budget editing that preserves transactions.
- Optional category-level budgets/spending limits.
- Spending breakdowns, category-colored bars, and monthly spending trends.
- Show spent, remaining, and total budget together.
- Spending calendar with no-spend days distinguished from days with no records.
- Recurring expenses/subscriptions, upcoming payments, and due-date reminders. Confirm actual payment rather than assuming it occurred.
- Income tracking and net cash-flow summaries if selected as a product goal.

## Suggested — Not Yet Confirmed: Savings
- Edit and archive goals; consider explicit goal deletion with appropriate safeguards.
- Optional deadlines and required weekly/monthly contributions to reach them.
- Contribution ledger/history and monthly contribution trends.
- Contribution corrections and withdrawals with clear audit/history semantics.
- Savings progress and milestone summaries.

## Suggested — Not Yet Confirmed: Dashboard, Insights, and Reviews
- Dashboard quick actions: habit check-in, expense entry, and savings contribution without navigating away.
- Today's remaining/due habits and recent transactions on the dashboard.
- Dedicated personal Insights page covering habit consistency, weekday patterns, spending, and savings trends.
- Identify habits becoming more consistent and weekdays with lower completion rates, using appropriate denominators and schedules.
- Weekly/monthly reviews combining consistency, spending versus budget, savings progress, and optional user reflections on what worked or needs changing.
- Monthly/yearly editorial-style recaps with habit milestones, financial summaries, and a few evidence-backed observations.
- Structure insight cards as one takeaway, a supporting chart, and key numbers.
- Use accurate recording-based language, e.g. “No gym sessions logged since April,” rather than claiming the user stopped exercising.
- Show date range, sample size, and missing-data boundaries for analytical comparisons; associations are not evidence of causation.

## Suggested — Not Yet Confirmed: Habit–Money Connections
- No-spend-day habits alongside the expense log.
- Tag purchases as planned/unplanned or planned/impulse.
- Record money actually saved from skipping a discretionary purchase and optionally allocate it toward a savings goal.
- Link habits such as bringing lunch from home to a review of associated spending, without asserting causation.
- Keep estimated avoided spending separate from real transactions and actual savings; do not automatically treat a completed habit as a financial contribution or move money.

## Suggested — Not Yet Confirmed: Usability, Data, and Social
- Responsive, keyboard-accessible layouts.
- Clear empty, loading, error, and success states.
- Undo or appropriate confirmation for destructive actions.
- In-app reminders and opt-in browser notifications, with explicit timezone and delivery handling.
- CSV export of expenses, habit history, and savings contributions for portability/backup.
- CSV import with validation and explicit preview before changes.
- Optional light/dark themes.
- Optional social rankings with corrected scoring, fairer completion-rate-based comparisons, and opt-in privacy controls.

## Suggested — Not Yet Confirmed: Screenshot-Inspired Visual Direction
These are candidate treatments, not exact approved design tokens.
- Near-black backgrounds, white text, and subdued gray labels as one theme option.
- Large serif editorial headlines paired with clean sans-serif interface text and numbers.
- Consistent category colors rather than unrelated accents on every control.
- Minimal chart decoration, thin separators, generous spacing, and clear data hierarchy.
- Compact everyday screens for quick logging; roomier insights/recap layouts instead of using poster-like layouts everywhere.
- Retain the previously discussed purposeful cards, soft geometry, restrained accents, tactile progress/history visuals, and subtle CSS/JavaScript interactions.

## Suggested — Not Yet Confirmed: Optional Later Tracking
Included for review because the screenshot discussion raised them; **not an approved expansion or initial-release recommendation**.
- Sleep logs and bedtime/wake-time timelines.
- Mood or daily check-ins and weekday/trend comparisons.
- Time-spent tracking and summaries, supported by actual duration/time entries.
- Sleep/mood/habit comparisons only with sufficient recorded data, visible sample size, and no causal claims.
- Readiness-style metrics would require an explicitly justified data source and definition; never invent a wearable-style score from habit checkboxes.
- Sleep, mood, and readiness tracking were recommended to remain outside the initial revamp; this is a recommendation, not a user-confirmed exclusion.

## Suggested — Not Yet Confirmed: Technical Fixes and Implementation Approach
These are supporting recommendations/known issues, not new user-facing features or completed work. Details remain in [[Projects/HabitCents/Architecture and Schema|Architecture and Schema]].
- Fix plaintext password handling and insecure session configuration; do not store passwords in sessions.
- Enforce ownership checks, request validation, consistent database/API errors, and safe rendering instead of injecting user strings into HTML.
- Repair missing preset removal, incorrect leaderboard scoring, and destructive budget replacement/reset behavior.
- Clarify budget/expense relationships and enforce appropriate numeric constraints and unique monthly budgets.
- Refactor the monolithic server as needed and establish meaningful automated tests.
- Plan and test migrations before changing existing data semantics.
- Retain the current web stack for the revamp; establish shared typography, colors, spacing, borders/radii, shadows, and reusable components. CSS Grid/Flexbox, SVG, and small CSS/JavaScript interactions can deliver the design without a framework switch.
- Prototype the dashboard to test the visual direction, then carry the shared design across the other pages; fix security/data-integrity issues before deployment.
- Earlier workflow recommendation: VS Code with Codex for implementation, Hermes for planning, review, and project notes; this is guidance, not a required tool choice.

## Deferred Native-App Proposals — Not Yet Confirmed
Preserved for completeness, not part of the immediate web revamp: React Native with Expo; retaining/refactoring Node/MySQL behind secure validated JSON endpoints; deciding Android/iOS scope later. Carry the same visual language to a native client if selected. See [[Projects/HabitCents/Overview|Overview]] for the confirmed web-first priority. Bank integrations and an AI coach were mentioned as complexity to avoid in the initial revamp, not recommended additions.

## Recommended Sequence — Not an Approved Plan
Fix authentication/ownership/validation, destructive budget behavior, preset removal and leaderboard scoring; establish the web design system; improve core habit/expense/savings workflows; add history/insights; only then add recurring/reminder/social extensions. Avoid a full banking app or AI coach in the initial revamp.

## User-Reviewed Page Map — 2026-10-18
This page map captures the user's selections in chat. Features explicitly kept are confirmed; undecided items remain open. This is scope planning, not evidence that the features have been implemented.

### Public and account pages
1. **Landing** — keep current page.
2. **Sign up** — keep current page.
3. **Log in** — keep current page.

### Main navigation / app pages
4. **Dashboard** — keep greeting, today's habit completion and points, current-month budget, and navigation shortcuts are removed from the dashboard because a separate navbar is planned. Keep quick habit check-in, due/remaining habits, recent expenses, and quick expense entry. Do not include savings contributions here.
5. **Habits** — keep habit creation, category selection, filtering, check/uncheck, deletion, reset/history controls, and preset browsing/addition. Fold the existing Categories page into a preset-library area within Habits and broaden the category system beyond the current physical/spiritual/healthy grouping. Keep editing, targets/partial progress, genuine per-habit streaks, and a habit-history calendar/detail view. Remove difficulty as a user-facing scoring/control concept; the user's stated intended rule is that a maintained habit builds a streak and a miss resets that streak to zero. Streaks replace both difficulty and points; no point score is part of the habit model. If a habit is missed, its streak resets to zero and the user builds it up again. The exact operational definition of a missed day (for example, whether habits can have schedules/rest days) remains unspecified. Preset removal is a known current-app defect to fix: the interface calls a server endpoint that was missing in the source inspection; verify the current code and implement/test a matching removal flow. Icons/colors remain an open design decision.
6. **Expenses / Budget** — keep current expense creation, listing, deletion, and monthly budget. Add date selection, categories, editing, search/filters, safe budget editing that preserves expenses, spending breakdowns, month browsing, a spending calendar, month-by-month total spent, and subscriptions/recurring expenses. Treat monthly budget as the user's intended income/budget input; do not add a separate income or cash-flow data-entry feature. Category-specific budgets are undecided.
7. **Savings** — keep multiple goals and contributions with progress. Add goal editing/archiving and deadlines. Contribution history, milestones, and monthly contribution trends are not wanted. Withdrawals are undecided (possibly support them).
8. **Profile** — use as the home for weekly/monthly reviews, settings, and data tools; do not make Reviews a separate page. Exact profile/settings/data contents remain open.

### Removed / not in current scope
- Remove the Leaderboard page entirely.
- Do not add a dedicated Insights page.
- Do not make Reviews/Recaps a separate page; place them under Profile.
- No separate income/cash-flow tracking input; monthly budget is intended to serve that role.

### Open clarification points
- What exactly does a “miss” mean for streak reset (calendar day, scheduled day, or target window)? The user has not selected a schedule model yet.
- Whether habit points remain alongside streaks, or streaks replace points as well as difficulty.
- What “broaden categories” means in terms of category creation/management and initial categories.
- Whether to support withdrawals from savings goals.
- Whether optional category budgets are wanted.
- Whether profile includes notifications, theme choice, CSV import/export, and account controls.

## Implementation Progress — 2026-10-18
- Implemented a dashboard visual refresh with greeting, daily completion summary, check-in list, current-month remaining budget, recent expenses, and quick expense form; removed dashboard shortcut buttons in favor of the shared navbar. Habit check-ins use the existing `/get-habits` and `/toggle-habit` endpoints; no streak logic has been implemented here.
- Replaced the authenticated shared navbar with responsive Overview, Habits, Expenses, and Savings links plus logout; removed Categories and Leaderboard from that navigation. The Profile page/route is not implemented yet.
- Added a separate `preview-server.js` and `npm run preview` script that binds only to `127.0.0.1:3001`, renders the dashboard without login/database setup, and supplies in-memory demo habit, budget, and expense data. Check-ins and quick expense submissions mutate only in-memory preview state. Other navbar destinations show an explicit preview-only placeholder; no production backend or database files are changed by this mode.
- Added EJS-rendering and preview-server tests using Node's built-in test runner. `npm test` passed 5 tests on 2026-10-18. Verified the running preview returned HTTP 200 for `/dashboard` and sample summary data. The real application/database flow remains unverified. The quick expense form in the main app submits to the existing endpoint, which redirects to Expenses.

## New Visual Direction — User Reference Selections
- **Confirmed universal streak rule supersedes all per-habit streak proposals:** one account-wide streak, not one per habit. It increases by one day when all daily required habits are completed; if even one required habit remains incomplete when that day closes, streak resets to zero. Do not increment for each individual check-in. Dedicated Streak card shows this universal day count, without a habit selector/name. User's exact daily boundary/timezone, no-habits/rest-day treatment and undo/history correction behavior need explicit implementation definitions; assistant recommends not treating an unfinished current day as a miss before its deadline.
- **Streak-card correction:** user explicitly wants a separate streak-focused card, not streak counters added only to Today's Habits. Make it typography-led with a dominant day count, minimal supporting text, and its own distinguishable color. Exact habit selection/aggregation, color and position remain open; assistant suggests beneath Today's Habits in left column, with habit name and large streak count. This supersedes the prior assumption against another habit-summary card only insofar as a dedicated Streak card is now required.
- **Newest dashboard revision supersedes contribution cards/right-stack savings:** restore roomier earlier expense-entry styling while retaining category selector; swap Recent Expenses into center and Log Expense to right. Recent Expenses spans rows 2–3; no extra habit-summary card. Spending-over-time expands into former savings space below right-hand form. Savings moves next to Monthly Budget in top row as compact square card with ring/name. Remove contribution grids from dashboard and use compact streak presentation instead; preserve contribution implementation for Habits reuse (do not rebuild/delete). Exact streak placement is clarified by the later decision below; do not put streaks only beside habits. Orange should be vivid saturated orange from Stack Sans reference, not muted peach; exact sampled token not established. Header/calendar/dock and coherent bento alignment preserved.
- **Latest layout corrections (supersede prior bottom-row savings placement and category-breakdown card):** user wants Spending as a time-series graph with date x-axis and amount-spent y-axis, not category distribution. Right column should stack Recent Expenses, Spending graph, and Savings in three equal-height compact cards. Savings gets a distinct theme-consistent color. Habit-history cards should be slim with small HabitKit-style cells; remove external “Habit continuity” heading and “View all habits” text. Other columns may have unequal card heights/asymmetric spans; prioritize cohesive composition over forcing every card onto common horizontal rows. Keep habit cards as individual named cards. Range, graph type and missing-data semantics remain implementation decisions; assistant recommends daily recorded-expense bars with explicit period and honest unavailable states.
- **User's hand-drawn desktop composition supersedes assistant row proposal:** beneath preserved header/week strip, Progress at upper left and Monthly Budget across the remaining top area; middle uses tall Today's Habits left, Log Expense center, Recent Expenses above Spending Graph on right; bottom has separate habit-history cards (illustrated Praying and Cooking), followed by the savings ring card. User clarified: show two habit-history cards together, with an arrow linking to the Habits page for the rest; do not implement a carousel. Spending graph type/range remains open; do not assume category breakdown replaces it. Reference image: `1000028744_4240f3.jpg` in composer-images. Preserve mobile plan separately.
- **Confirmed dashboard expansion:** user approved integrating the proposed spending-category breakdown, compact selected-habit continuity/contribution-grid module, category-colored expense rows, and denser responsive desktop composition. Preserve minimal circular savings and current header/date navigation. Use real category/history data, do not guess categories or fabricate streaks; mobile prioritizes completion+savings, budget, habits/entry, expense list with secondary modules below. Implementation remains via VS Code/Codex; this note is approval of direction, not completed code.
- **Responsive density exploration:** user proposes mobile order: completion + savings side-by-side; full-width budget; habits + quick expense side-by-side; expense list below. On desktop user finds current dashboard empty and wants denser composition like financial bento reference, potentially more useful cards, and is exploring category-colored expenses inspired by stacked mobile expense cards. These are exploratory preferences, not approval of specific new metrics. Assistant recommendations: selected-day spending/category breakdown and per-habit continuity preview using real data; consistent category colors with labels and Uncategorized fallback; avoid obscuring overlapping expense rows and fake analytical data.
- **Latest shared navigation direction:** replace top navbar with a floating bottom icon dock, logo at the start and navigation extending right, ending with Profile. Use a theme-consistent translucent/blurred surface. Exact logo layout remains interpretive. Assistant recommends accessible labels/tooltips, active states, safe-area offsets and reserved content clearance; blur does not prevent occlusion. Profile must route to a working destination rather than a dead link; no implementation claimed.
- **Calendar refinement:** user wants explicit previous/next navigation for the dashboard week row. Replace the inline expanding date list with an animated overlay above the dashboard, blurred/dimmed backdrop consistent with warm theme, vertically scrollable editorial day rows, initially today's row centered, and inverse/dark selected row. Reopening on a selected historical date versus today remains a detail to resolve. Assistant recommends centering current selection on reopen, Today shortcut, accessible dialog keyboard/focus/escape/backdrop behavior and reduced-motion support. Activity-marker errors must not block date browsing. Screenshots still show linear/text-heavy savings; circular minimal savings requirement remains unfulfilled visually.
- **Dashboard savings-card decision:** use circular progress rather than a linear bar. Visible content should be minimal: savings goal name and progress only. This supersedes the assistant's proposed total-saved/active-goal-count text. Exact multi-goal selection remains open; no contribution form. Provide accessible progress semantics without adding visible clutter.
- **Latest calendar integration direction:** user now wants date-history browsing within Dashboard rather than a separate Calendar tab. A control beside the header date switches the dashboard UI into date-selection/history mode inspired by the editorial calendar rows; selecting a date shows recorded expenses and completed habits for that date. This supersedes the earlier separate-calendar direction. Exact control/icon and transition are open (assistant recommends Browse dates/calendar rather than reorder semantics). Assistant recommends historical mode be read-only, clearly label selected date versus real today, keep live clock on real local time, and add Back to today; do not present today's monthly remaining balance as a historical balance. Savings overview was not explicitly rejected: user excluded dashboard contributions, not necessarily a read-only savings summary; adding/contents remain to confirm.
- **Latest dashboard header decision:** replace the greeting with a full-width inverse-theme card (black on light theme, white on dark theme). Left: avatar and name only; center: large live time inspired by the attached minimalist clock-phone reference; right: large date. Move the compact week calendar into its own full-width row below, with seven day cards filling the row; today's card reverses the other cards' foreground/background. Preserve independent local-date/calendar fallback and the one-screen desktop goal. No request to copy the reference's timeline, dots or task UI. Responsive arrangement and actual avatar source remain implementation details; use initials fallback rather than inventing a profile-photo capability. No implementation claimed.
- **Later typography decision (supersedes Geist choice below):** user selects Neue Haas Grotesk, preferring Roman. Project `fonts/` contains Text, Display and Round Dots variants, including 55Roman OTF files. Inspected filenames have `-Trial`; user reports purchase, but web embedding rights/files require confirmation before deployment. Recommended use: Text Roman for UI/body and Display Roman for big headings/numbers; retaining Geist Mono is not confirmed.
- **Calendar resilience requirement:** compact dashboard week strip must render even when summary/data requests fail. Use a local-date fallback independent of fetch success, preserving real server check-in date when available. Failed metrics remain honestly unavailable; never fabricate activity. Keep failure text small instead of using large metric typography for “Summary unavailable.”
- **Confirmed typography decision:** use Geist and Geist Mono instead of the current Bricolage Grotesque/Playfair Display pairing. Assistant-recommended roles (not separately approved): Geist for headings, body text, navigation and controls; Geist Mono for dates, streak counters and compact numerical labels. The exact fonts in the references have not been verified. Implement typography first in the VS Code/Codex workflow; no font code change is claimed by this note.
User supplied six image references in desktop chat after reporting the database-backed workflow works. These selections supersede the earlier generic dashboard styling direction; no new UI implementation is claimed.
- Dashboard: compact week/date strip inspired by `two_iphones_with_different_dashboards_on_them`; clearly identify today.
- Separate Calendar tab: user likes the editorial day-row calendar in `an_image_of_a_screen_with_numbers_and_times_on_it_s_display_panels`, with oversized date numerals, fine separators, activity dots and selected-day contrast. Showing the user's recorded activity for a selected day is a tentative use case. Whether this is a top-level navigation page or an internal tab remains open.
- Base palette: warm gray-beige/oat background, near-black text, subdued neutral tones from `an_iphone_screen_with_the_text_7_weeks...`.
- Cards: distinct colors for different functions, inspired by pastel blue/pink and dark neutral cards in `the_dashboard_is_displaying_data_and_statistics`; exact color-to-function mapping not selected.
- Layout: asymmetrical, aligned bento/card arrangement inspired by `the_dashboard_is_displaying_different_things...`; this is a tentative layout preference, not a request for crypto/financial trading features.
- Habit history: GitHub-contribution-style per-habit grids inspired by the HabitKit three-phone reference, to see continuity across days. Placement and exact completion/partial-progress/missing-data semantics remain open.
- Assistant recommendations, not yet approved: put full per-habit history grids in Habits, optionally a compact dashboard summary; link date strip/history cells to Calendar; keep future/unrecorded days distinguishable and use real recorded data rather than fabricated heatmaps.

## Related
- [[Projects/HabitCents/Overview|Overview]]
