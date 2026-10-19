# Dashboard design and review notes

This pass keeps Express, EJS, browser JavaScript and PostgreSQL. It changes the shared typography, warm design tokens and navbar, and the Dashboard composition. Existing local PostgreSQL/authentication work was retained. No credentials, schema, remote database data, commits or deployment were changed by this pass.

## Changed files

- `views/dashboard.ejs`: asymmetric bento layout, greeting, noninteractive week strip, habit check-ins, budget, recent expenses, quick entry and live status messages.
- `views/partials/head.ejs`, `views/partials/navbar.ejs`: local fonts, independent shared mobile navigation, valid current-page attributes, visible logout and preview labeling.
- `public/css/fonts.css`, `public/fonts/*`: self-hosted Geist and Geist Mono, SIL license, swap loading and system fallbacks.
- `public/css/base.css`: shared palette, spacing, radius and border tokens, focus styles and responsive navbar. No dashboard layout selectors.
- `public/css/dashboard.css`: dashboard-only layout and card styles. Blue represents monthly finances; lilac represents today's habit completion; warm neutral cards hold tasks and entries.
- `views/index.ejs`, `views/login.ejs`, `views/signup.ejs`: replace standalone obsolete font loads with the local font foundation.
- `public/css/auth.css`, `public/css/style.css`: remove obsolete typeface overrides without redesigning their content.
- `public/js/navigation.js`: mobile toggle, Escape to close and restore focus; independent of Bootstrap.
- `public/js/dashboard.js`: date strip, precise amounts, loading/error/empty/success states, retries, check-in rollback and pending submission guards.
- `server.js`: additive `currentDate` and `hasBudget` dashboard fields; JSON expense responses report an actual insert or a missing budget. Existing HTML form redirects and SQL money/date semantics remain.
- `preview-server.js`: labeled memory-only demo, empty/failure/no-budget scenarios, core page templates for navbar verification.
- `test/dashboard-behavior.test.js`, `test/dashboard-navbar.test.js`, `test/preview-server.test.js`, `test/server-postgres.test.js`: date boundaries, interactions, validation, precision, request failures, templates, preview scenarios and real local PostgreSQL route coverage.
- `scripts/verify-dashboard.cjs`: optional Chrome verification through the local debugging endpoint; screenshots in `artifacts/`.

## Review locally

PowerShell:

```powershell
npm run preview
```

Open http://127.0.0.1:3001/dashboard. The separate preview uses no `.env` and makes no Supabase connections. Stop it with Ctrl+C. Default `npm run preview` uses port 3001. Stop and restart an existing preview after server-code changes; templates and static assets update from disk, while route handlers remain in memory.

Preview states:

- `/dashboard`: populated demo, check-in/uncheck and expense writes in memory.
- `/dashboard?scenario=empty`: no habits, expenses or monthly budget.
- `/dashboard?scenario=noBudget`: recorded expenses without a current budget.
- `/dashboard?scenario=failure`: intentional failed API requests. To test recovery, open the populated URL or change the preview scenario cookie to populated and press Try again.

Scenarios are isolated from production and selected via a preview-only cookie. Account forms on other preview pages are unavailable; only dashboard check-in and expense mutations are simulated. Restart the preview to reset its data.

## Verification performed

The relevant behavior tests were run failing before implementation. The affected suites and full `npm test` suite were then run: **27 tests passed, zero failures**. Tests use in-memory PGlite and never connect to the live database.

Installed headless Chrome was used because this session did not expose the in-app browser execution tool. The browser checks covered desktop (1440px), mobile (390px and overflow at 320px), all four core navbar destinations, Space/Tab/Escape and visible focus, font loading, check-in/uncheck, decimal expense success, missing-budget rejection retaining values, empty/failure states and retry recovery. Screenshots were captured and visually inspected for desktop and mobile. No JavaScript exceptions or failed assets occurred in the browser run; failure scenarios intentionally return HTTP 503/409 responses. Google-hosted fonts are unnecessary at runtime; Bootstrap CSS on existing templates still uses its existing CDN.

The optional browser check requires the preview and installed Chrome with a disposable profile and `--headless=new --remote-debugging-port=9223`. Run `node scripts/verify-dashboard.cjs`; `PREVIEW_URL` overrides the default http://127.0.0.1:3001. This is separate from `npm test` and does not launch Chrome automatically.

## Date and history extension points

The date strip uses `currentDate` returned by the same PostgreSQL `CURRENT_DATE` used for habit toggles and expense inserts. Calendar arithmetic parses year/month/day locally at noon, never through UTC ISO timestamp conversion. The database timezone remains unchanged. The strip orients users to the check-in week; dates have no click handlers or historical browsing claims.

A later Calendar view can add recorded habits/expenses by date behind owned, date-scoped queries. Its placement as a page or internal tab is undecided. The proposed presentation uses wide day rows, large dates, separators, real activity dots and clear selected-day contrast.

Per-habit history belongs primarily in Habits. Add owned date-range log queries and creation/schedule metadata before building contribution grids or current/best streaks. Treat future dates and pre-creation dates separately from unrecorded days; resolve historical editing and scheduling rules before assigning missed-day semantics. No fake activity, historical editing, streak calculation, Calendar route or extra navigation was added here.

Live Supabase, account creation and live transactions were deliberately not exercised.


## Compact dashboard refinement (19 October 2026)

The existing palette, local Geist fonts and shared navbar were retained. Primary figures use Geist and tabular numerals, with selective Mono dates. The greeting is smaller, section headings stronger, the dashboard footer removed, and content uses two compact desktop rows. No fixed card heights, clipping, page overflow suppression, zoom or transform scaling are used.

### Actual data failure

Before changing code, the running preview at port 3001 returned HTTP 200 with totalHabits, completed, totalBudget and remaining, but omitted currentDate and hasBudget. Its process was confirmed as node preview-server.js. The current source already supplied both missing fields. The stale process was stopped and the current preview started; the same URL then returned both fields and the summary/date rendered normally. The failure was an old server process paired with updated disk-served frontend assets. No replacement dates or fabricated totals were added. Production server code and credentials were untouched during this refinement; the unauthenticated production endpoint redirected to login and live account data was not exercised.

The browser module now validates summary fields, reports missing or invalid contract fields specifically, and rejects malformed monetary values instead of substituting zeros. API failures remain visible and retryable. The preview emits a clear port-in-use startup error to help prevent accidentally reviewing an older process.

### Content limits

Lists show up to three full entries. Long names/descriptions reduce the visible subset using a character budget, with precise remaining counts on View all links. Outstanding habits come first on load; checking a displayed habit keeps its checkbox available for unchecking. Habits and Expenses remain the full-list destinations. There are no nested scrolling lists or truncated names. Extremely long individual strings or browser text enlargement may naturally increase page height; the design preserves the content.

### Verification

Affected tests and the full suite passed: 27 tests. Chrome checks measured document scroll sizes of exactly 1440×900 and 1366×768 at those desktop viewports. Normal populated, many-item, long-name and large-amount fixtures fit without page scrolling at both sizes. At 1440px the progress, remaining-budget and spent figures measured 72px, 63.36px and 57.6px; at 1366px, 68.3px, 60.104px and 54.64px. Very large amounts use smaller readable type.

390px mobile checks covered populated and stress fixtures, natural vertical scrolling and no horizontal overflow; 320px populated overflow checks also passed. Empty accounts, missing budgets, all-request failures and summary-only HTTP 503 failures were checked. In summary-only failures, habits and expenses remained usable while the summary stayed unavailable. Check-in/uncheck, decimal expense success, rejected entry retaining values, retry recovery, local fonts, navbar destinations and keyboard Space/Tab/Escape with visible focus passed. No browser JavaScript exceptions or failed assets were recorded. Desktop, mobile, long-name and large-amount screenshots were visually inspected. No live database writes, commits or deployments occurred.

Review fixtures also include /dashboard?scenario=many, /dashboard?scenario=long, /dashboard?scenario=large and /dashboard?scenario=summaryFailure. These are labeled, preview-only memory fixtures.

Files changed in this refinement: views/dashboard.ejs, public/css/dashboard.css, public/js/dashboard.js, preview-server.js, test/dashboard-behavior.test.js, test/preview-server.test.js, scripts/verify-dashboard.cjs and this document. Screenshots are in artifacts/ (including dashboard-1440x900.png and dashboard-1366x768.png).

## Roman typography and independent week strip (19 October 2026)

Authenticated pages now load `fonts-authenticated.css`. Text 55 Roman covers body copy, navbar, controls, labels and dates; Display 55 Roman covers the greeting and primary figures. Both standard (not Round Dots) faces are static, normal-style weight 400 with `font-display: swap`. Shared tokens supply Helvetica/Arial fallbacks; `font-synthesis: none` prevents artificial bold or italic. Dashboard tracking is tuned for the new faces. Visitor landing/login/signup pages retain their previous separate font stylesheet.

Only `NeueHaasGrotText-55Roman-Trial.otf` and `NeueHaasGrotDisp-55Roman-Trial.otf` were copied into `public/fonts`. SHA-256 hashes match their originals. No font conversion occurred, no unused Neue Haas weights were copied, and the project-root fonts directory was not exposed.

### License record and deployment confirmation

The two files' OpenType name-table record 13 contains the Commercial Type EULA. Clause 4(b) says web font replacement/embedding requires a license upgrade; clauses 7 and 11 restrict conversion. No WOFF2 assets or standalone web-license grant was supplied. Before serving the files, the user explicitly confirmed: **“I have rights covering web embedding of these files.”** Local implementation proceeds on that confirmation. No independent license entitlement document was verified. Before deployment, confirm the entitlement covers these exact Trial OTFs and intended domain/usage; prefer supplied licensed WOFF2 files when available, without converting these files. No deployment was requested or performed.

### Calendar behavior

The week strip renders synchronously from browser-local date components before fetches begin. It uses noon-based local calendar arithmetic, without UTC ISO conversion. A valid server check-in date replaces the local orientation date before financial-field validation. Missing or invalid server dates retain the visible local calendar and do not invalidate otherwise valid financial values. Summary request failures retain the local calendar while failed summary values display small dashes and explanatory status copy.

The visible source label distinguishes Local date from Check-in date, with an explanation that local orientation does not change the server's check-in day. Dates remain noninteractive and contain no invented activity.

### Verification performed

New date regressions were run failing before implementation, then affected tests passed. The full suite passes **30 tests**. Coverage includes pending requests, summary failures, missing/invalid dates (including impossible month/day values), month/year and leap-day boundaries, reconciliation with a valid server day, and server reconciliation even when financial fields are invalid.

Installed headless Chrome verified two Roman font requests (HTTP 200), successful font loading, computed Text/Display families, weight 400 and synthesis none for body, navigation, inputs, buttons, dates, greeting and primary figures. No Geist or Round Dots font requests occurred on authenticated pages. Chrome also checked missing/invalid dates and valid server reconciliation using simulated summary responses. Summary-only and all-request failures kept seven visible days. Desktop viewport and document sizes matched exactly at 1440×900 and 1366×768; normal, many-item, long-name and large-amount states fit without scrolling. Mobile 390px stacked naturally and 320px overflow checks passed. Existing check-in/uncheck, expense, retry, keyboard and navbar checks passed. No JavaScript exceptions or failed assets were recorded. Screenshots were captured for visual inspection. No live database operations or credential changes occurred.

Files changed in this pass: `public/css/fonts-authenticated.css`, the two public Roman OTFs, `public/css/base.css`, `public/css/dashboard.css`, `views/partials/head.ejs`, `views/dashboard.ejs`, `public/js/dashboard.js`, `test/dashboard-behavior.test.js`, `test/dashboard-navbar.test.js`, `scripts/verify-dashboard.cjs`, and this document. Review remains `npm run preview` → http://127.0.0.1:3001/dashboard.

## Selective real font weights

Web embedding rights were reaffirmed by the user. Roman 400 remains the default for Text and Display. The supplied standard Text Medium (500 normal), Text Bold (700 normal) and Display Medium (500 normal) are now registered individually, with swap loading and no synthesis. OS/2 metadata confirmed each added face's weight and normal style. Headings, selected navigation, labels and primary controls use Text Medium; main numerical figures use Display Medium; today's date and semantic bold use Text Bold. The greeting stays Roman. No current treatment needs Italic, so no italic file is registered or served.

Only these three additional unchanged OTFs were copied into public assets. Browser checks confirmed exactly five distinct faces in use, their loaded statuses and computed weights (400/500/700), with synthesis none. Both desktop sizes still fit without scrolling; mobile, stress fixtures, dates, interactions and keyboard checks passed. The 30-test suite passed. The existing layout, palette and calendar behavior remain unchanged. Files touched: fonts-authenticated.css, base.css, dashboard.css, the three added font assets, verify-dashboard.cjs and these notes. No credentials, live database writes, font conversion, commits or deployment.

## Information hierarchy and budget-contract compatibility

The live port-3000 `/dashboard-data` request redirected to login in this session, so the authenticated response could not be inspected. No running-server staleness was established or claimed. The source production query already selects an explicit `hasBudget` boolean; its response now spells out the summary fields, and local PostgreSQL route tests verify the flag for absent, zero-valued, and positive budgets.

For a legacy summary that omits `hasBudget`, the frontend now reads the existing authenticated `/get-budget` endpoint and validates the actual budget record and matching amount. A positive budget ID establishes existence even if its amount is zero. The route's documented empty response `{total_budget:0}` establishes absence only when it agrees with the summary. Invalid flags, failed verification, contradictory amounts and invalid IDs remain unavailable. No flag is inferred solely from a positive amount, no financial value is fabricated, and no restart recommendation remains in this validation path. Preview `/get-budget` fixtures now provide real demo IDs when a demo budget exists, and no record when none exists. `/dashboard?scenario=legacySummary` deliberately omits the flag to exercise this compatibility path.

Primary completed/total and remaining-budget figures now scale with viewport width and height: 79.92px at 1440×900 and 72.96px at 1366×768. Spent remains secondary at 47.52/45.078px, while total budget is 22.4px. Large amounts keep approximately 56–58px for the remaining balance. Greeting tracking is relaxed to -0.01em. Taller desktops use larger labels and body copy; shorter desktops reduce a few row gaps rather than shrinking the entire interface. Cards retain content-driven sizing and the same arrangement. No clipping, page overflow suppression, zoom or transform scaling was introduced.

Verification: **36 tests pass**. New regressions were run failing first for legacy summaries, zero budgets, contradictory verification, invalid flag types and short-value preview records. Production route checks use isolated PGlite, never a live database. Chrome verified real font requests, loaded-face statuses and computed families/weights (not CSS declarations alone). Normal, short-value, many-item, long-name and large-amount demo states fit 1440×900 and 1366×768 without page scrolling; 390px mobile stacks naturally, and 320px horizontal overflow checks passed. Unavailable summaries were checked separately and preserved the visible local calendar and honest dashes. Existing interactions, retries, keyboard navigation and shared navbar checks passed, with no JavaScript exceptions or broken assets. Populated desktop and large-value screenshots were visually inspected.

Demo review: http://127.0.0.1:3001/dashboard (clearly labeled, database-free). Short amounts: `?scenario=small` (৳100 total, ৳20 spent, ৳80 remaining). Unavailable summary: `?scenario=summaryFailure`. Preview was left running for the requested review; `npm run preview` starts it again when needed. Signed-in live account data remains unverified. No credentials, live writes, commits or deployment were changed.

Files changed in this pass: `public/js/dashboard.js`, `public/css/dashboard.css`, `server.js`, `preview-server.js`, `test/dashboard-behavior.test.js`, `test/server-postgres.test.js`, `test/preview-server.test.js`, `scripts/verify-dashboard.cjs`, and these notes.

## Currency and calendar polish

English summary amounts retain Tk. The currency prefix is now a separate, small baseline-aligned span; the integer remains dominant. Zero summary decimals are omitted, while nonzero cents are rendered smaller. Accessible labels and detailed expense rows retain the full two-decimal representation, and calculation/submission precision is unchanged. The total budget follows the same summary formatting. Remaining-balance type was reduced slightly to 72px at 1440×900 and 66.816px at 1366×768; completed/total stays larger. The visible budget-bar label says Budget remaining and shows the available percentage.

The calendar normally shows month/year and today's highlight without Local date or Check-in date labels. Only a known difference between device and server days adds Recorded for [date]. The expense note says Recorded for today when confirmed by the server day; it names the actual recording date when different. Until that date is known it says Date assigned when saved, without claiming that device-local today changes server behavior. The fallback remains immediate and visible after request failures.

New regressions were run failing first, then passed. Full suite: **39 passing tests**. Chrome verified separate prefix/decimal sizing, baseline alignment, visible bar labeling, Tk 8,800 and Tk 8,800.25 rendering, zero-decimal omission, unchanged detailed transaction precision, default and differing recording-day wording, font requests/computed styles, interactions and failure recovery. Short, many-item, long-name and large-amount states fit desktop 1440×900 and 1366×768 with no clipping or page scroll. Mobile 390px stacks naturally and 320px overflow checks passed. Desktop screenshots were visually inspected. No font switch, structural overhaul, credentials, live writes, commits or deployment.

Changed: public/js/dashboard.js, views/dashboard.ejs, public/css/dashboard.css, test/dashboard-behavior.test.js, scripts/verify-dashboard.cjs and these notes. Demo remains http://127.0.0.1:3001/dashboard.

## Local-time header, integrated history and current savings

This pass supersedes the earlier server-oriented, noninteractive calendar behavior. The inverse header shows an initials avatar and name, a clock centered within the card, and the browser-local date. Seven equal day cards sit below it. Local time renders before requests, updates at minute boundaries and on tab resume, and rolls the week at midnight. The server check-in date only informs the existing expense-recording note; it never shifts the clock or calendar. Initialization is idempotent and the clock has no live announcement region.

The calendar button opens a full-month date browser inside the dashboard. Month navigation handles leap days and year boundaries. Activity dots come only from recorded completions/expenses. Selecting any non-today date shows read-only recorded completions, daily spending and dated expenses, with independent loading/error/retry states and Back to today. Generation guards reject stale responses. Today actions are hidden and disabled in historical mode. Historical habit totals, missed habits and historical monthly balances are not inferred.

Two authenticated read-only endpoints provide strictly validated date/month filtering: `/dashboard-history` and `/dashboard-activity`. All SQL is parameterized and scoped to the session user, and stored DATE values are compared directly without UTC conversions. No schema changes were needed. History describes surviving true completion records and expense entries; deleted records and past habit schedules/name snapshots cannot be reconstructed. Local PGlite tests verify cross-user isolation and exclusion of false completion records.

The compact savings card reuses `/savings-data` and shows current total saved, goals below target, and one named goal's saved amount, target and progress. The model has no explicit active status, so no active count is invented. Integer-cent aggregation preserves precision. Empty goals, all targets reached and request failures have distinct states; savings remains explicitly current while browsing history.

Verification: **48 tests passed** with no failures or skips. Installed headless Chrome/CDP checked populated Today layouts at 1440×900 and 1366×768: document dimensions matched the viewport, with no page scrolling or clipping. Primary habit figures remain approximately 80/73px and budget remaining 72/67px. Mobile 390px and 320px remain readable and scroll naturally. Stress cases covered long names, fallback initials, many items, short and large amounts, empty data, completed goals and failed requests. Browser checks exercised check/uncheck, expense entry, date selection/return, independent retries, keyboard opening/closing, selected-day read-only controls and simulated local midnight/year rollover. Unit tests additionally verify timer/listener cleanup, repeated initialization, leap days and stale-response races.

Network responses and FontFaceSet loaded status confirmed the four faces actually used by this dashboard: Text Roman/Medium and Display Roman/Medium. Computed families, weights and disabled synthesis were checked. Header light/dark token contrast exceeded 7:1; dark switching was not added. Screenshots were visually inspected, including `artifacts/dashboard-1440x900.png`, `dashboard-1366x768.png`, `dashboard-date-browser.png`, `dashboard-history.png` and `dashboard-mobile.png`. No JavaScript exceptions or failed assets were recorded. Browser checks are reproducible with `scripts/verify-dashboard.cjs` against the database-free demo; authenticated live account data was not exercised.

Demo remains http://127.0.0.1:3001/dashboard, clearly labeled as fixtures. No credentials, live database writes, remote schema changes, font conversions, commits or deployment were performed. The user's confirmed font-embedding rights remain the authorization for local serving.

## Minimal circular savings card

Follow-up: show the selected goal's amount saved directly below the ring (English Tk, two-decimal precision). This amount updates with the compact goal selector and represents current savings in historical mode too.

The circular-progress/minimal-text decision replaces the savings summary above. The dashboard now shows only the selected savings goal's name and a prominent percentage inside a subtle circular track. Multiple goals use one compact native selector; a single goal shows its name directly. The ring links to `/savings`, with accessible goal/progress labels explicitly identifying current savings even in historical mode. The contextual tooltip provides the same distinction without adding visible explanatory copy.

Progress comes from real saved/target values, with the visual arc clamped to 0–100%. A genuine zero balance with a positive target can show 0%; zero or negative targets show an unavailable dash, and malformed financial values produce the concise unavailable state rather than fabricated progress. Empty/error states keep a Savings link, and request failures offer Retry. No total-saved summary, goal counts, milestone copy, linear meter or contribution controls remain in this card.

Verification: all **50 tests passed**. Added regressions cover selector changes, accessible current-progress labels, invalid/zero targets, clamping, and unavailable states. Headless Chrome verified selector/ring updates, the Savings link, empty/completed/error states, loaded font requests and computed families, and retained Today/history interactions. Populated desktop layouts still fit 1440×900 and 1366×768 without scrolling; 390px/320px mobile checks passed. Updated desktop/mobile screenshots were captured, and the 1366×768 result was visually inspected. No credentials, live database writes, commits or deployment.

## Week controls and floating date picker

The inline full-month browser is replaced by a native modal dialog over the stationary dashboard. Previous/next week change only the visible seven-day strip; the selected activity date stays unchanged. The week Today shortcut restores today's dashboard and week. Actual today retains its explicit Today badge and aria-current, while the selected date uses aria-pressed and an outline or inverse row. The header clock remains actual browser-local time.

The picker centers today's row initially, or the selected historical row when reopened. It starts with 91 dates and extends by 30 days near either scroll edge, retaining at most 151 rows and preserving the visible scroll anchor. Month controls jump to adjacent months; the picker's Today shortcut centers today without selecting it. Each row includes month/year context. Scrolling and keyboard focus movement do not select dates or request day history. Enter/Space or row activation selects the date, closes the dialog, and uses the existing read-only history loader and response-generation protection.

The warm neutral dialog has a dimmed, blurred backdrop, an opaque dim fallback for browsers without backdrop-filter, and 200ms opening/closing motion disabled by prefers-reduced-motion. Native modal behavior makes the background inert; background scrolling is locked while open and previous inline styles restored on close. Focus enters the selected date, stays within the modal, and returns to Browse dates after Escape, Close, backdrop dismissal or selection. Arrow keys move by day, Page Up/Down by month (clamping to valid month-end), and Home/End reach month boundaries. Retry/initialization do not add duplicate listeners.

Activity markers are loaded independently for the bounded date range, validated and drawn only from real records. Marker failure is a small neutral status with Retry, and date navigation/selection remains available. Marker arrival does not resize rows or move the centered date. No routes, financial calculations, ownership checks or live database records changed.

Verification: all **52 tests passed**. Added unit regressions cover week navigation without day selection, preserving historical selection, Today restoration, bounded ranges, leap days and year boundaries. Headless Chrome/CDP exercised the modal centered on today and reopened history, previous/next month, incremental scrolling across years, February 29 selection via Enter, no history fetch on scrolling/week browsing, wheel scrolling with stationary background, background focus blocking, focus wrapping/restoration, Escape/Close/backdrop dismissal, scroll-lock cleanup and reduced motion. Existing summary/history failure, activity-marker failure, stale-response, savings and Today action checks passed. Populated and stress states still fit 1440×900 and 1366×768, with unchanged primary type sizes. Mobile checks covered 390px and 320px; desktop and mobile modal screenshots were visually inspected. No JavaScript exceptions or failed assets were recorded. Physical touch/trackpad hardware and a browser without backdrop-filter were not exercised; those use native scrolling and the CSS fallback respectively.

Demo remains http://127.0.0.1:3001/dashboard. No credentials, live database writes, commits or deployment.

## Shared floating navigation dock

Authenticated pages now share one fixed, content-width bottom dock instead of the top navbar. It contains the existing h. brand, a fine separator, and consistent inline outline SVG links for Overview, Habits, Expenses, Savings and Profile. Each link has an independent accessible name, a hover/focus tooltip, visible keyboard focus and 44–48px targets; the current destination uses aria-current and an inverse circle. Tooltips can be dismissed with Escape. The warm translucent surface has a fine border, restrained shadow, backdrop blur, a solid fallback and dark-theme tokens. No magnification or bounce effect was added.

No Profile route existed. The new authenticated `/profile` renders the session user's escaped name and existing logout action only. Logout is removed from the dock. Preview serves an explicitly labeled Demo User profile and retains its existing non-authenticated logout redirect; real session logout behavior is covered in isolated server tests. Existing Categories/Leaderboard routes are unchanged and are not reintroduced into navigation.

Every authenticated page reserves 84px plus the mobile bottom safe-area inset for the dock; the dock sits 12px plus the inset above the bottom edge. The viewport enables safe-area support, and side inset limits constrain the dock width. Removing the top navbar frees the dashboard space needed for this clearance without shrinking its figures or changing its header/cards. Narrow existing Habit and Savings list rows now wrap so content cannot widen the viewport and shift the dock. Native calendar dialogs remain above the dock in the top layer, making it inert while open.

Verification: the full **52-test suite passed**, including updated navigation rendering/active-state checks and Profile authentication, current-user name and logout-link checks against isolated PGlite. Headless Chrome/CDP followed actual dock links across all five destinations at desktop 1366×768 and mobile 320×740; checked one dock/no top navbar, all accessible names, active inverse colors, target dimensions, width, final-control clearance, keyboard order/focus outlines, hover/focus tooltips and Escape dismissal. A simulated 24px bottom safe area produced the expected 36px dock offset and 108px body clearance. Calendar checks confirmed attempts to focus the dock stay inside the modal. Existing date/history/Today interactions passed with no JavaScript exceptions or failed assets. Populated/stress dashboard layouts still fit 1440×900 and 1366×768 without scrolling, with unchanged primary type sizes; mobile 390px/320px checks passed. Desktop dashboard and narrow Profile screenshots were visually inspected. No physical notched-device test or unsupported-backdrop-filter browser was used.

Demo remains http://127.0.0.1:3001/dashboard. No credentials, live database writes, commits or deployment.

## Date picker polish and motion

The date dialog now matches the dashboard content width (including scrollbar compensation and resize), rather than a narrow fixed width. Month/year is shown in the top context only; full dates remain in accessible row names. The modal and selected row have stronger drop shadows inspired by the editorial reference. The header date remains a separate compact typographic group with enlarged stacked weekday/month, natural vertical/horizontal gaps and cap-height trimming.

Month jumps, Today centering and keyboard scrolling now use native smooth scrolling where nearby dates can share the bounded list. Initial opening and internal scroll-anchor corrections stay immediate, avoiding a long animated sweep or a jump when rows are extended. Wheel and touch scrolling remain native. Date rows and navigation controls have restrained 180–200ms surface transitions with a subtle dark hover background; the inverse selected row remains distinct. Reduced-motion preference makes programmatic scrolling immediate and disables these transitions.

Browser checks explicitly ran with motion enabled and reduced motion: smooth/instant scroll requests, settled targets, hover background changes, keyboard/history safety, full-width modal, no repeated visible month/year, and desktop/mobile fit passed. Full suite: **52 passed**. An earlier run hit two transient Node fetch 'bad port' failures from OS-assigned test-server ports; the rerun passed without production or test changes. No credentials, live database writes, commits or deployment.

## Approved category and continuity additions

The dashboard now has a reconciled spending breakdown, explicitly categorized pastel expense rows, optional expense category selection and a bounded per-habit recorded-completion grid. The new bento preserves the existing header/dock/date interactions and primary number sizes. Normal 1440×900 fits one screen; 1366×768 uses a natural 859px document instead of clipping. Creation/scheduling metadata is absent, so no streak is invented. Categorized writes require the prepared additive migration; it has not been applied live. Full suite: 62 passing tests. See `docs/dashboard-additions.md` for setup, exact contracts, changed files, verification and limitations. This supersedes the earlier restriction against dashboard contribution grids; historical editing remains unavailable.
