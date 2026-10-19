# Codex implementation brief — Habits, Expenses and Savings

## Status and interpretation
User supplied this exact brief as the work assigned to Codex. This is requested scope, not verified implementation or completion.

### Latest user clarification on visual references
- Savings **Circular/Linear toggle is approved**, superseding the earlier circular-only restriction for the Savings page. Preserve the compact Dashboard savings ring unless separately changed.
- Keep editing/management capabilities, but present them through discreet icon actions/overflow menus and detail overlays rather than permanently exposed dropdowns, date-inspection forms or dense toolbars. User does not want dropdown-style controls cluttering the main page surfaces; do not remove functionality to achieve the cleaner reference design.
- New references prioritize compact page headings; Habits combines completion and universal streak in one compact summary, with off-white cards and per-habit colored heatmaps filling usable width; Expenses uses compact financial/chart modules and category-icon transaction rows; Savings uses centered rings, concise goal cards and a compact goal count rather than an oversized overview banner. These are visual refinements to the assigned scope, not newly verified implementation.

### User answers to Codex clarification questions
- Retain PostgreSQL (`pg`) and the current Express/EJS/CSS/browser-JavaScript stack; do not switch back to MySQL.
- User selected “I need weekly quotas or a different progress-entry rule” rather than approving selected-weekday scheduling with a daily achieved-total entry rule. Weekly quotas/different entry semantics are requested, but the exact quota window, entry model and effect on universal daily streak remain unresolved; do not treat the rejected daily proposal as approved.
- Use **Asia/Dhaka consistently for now** for habit deadlines/day boundaries and the universal streak. User intends a later change to use the user's current location/timezone. That future direction is not implemented or fully specified; location permission, timezone detection, travel changes and historical-day preservation require later design. Do not silently rewrite historical dates or change existing enrolled timezone policies.

**Known stale statements in the original below:** the active app uses Supabase PostgreSQL with `pg`, not MySQL. Keep the current PostgreSQL setup. Earlier points/plaintext/security findings are historical concerns to inspect, not assertions about current code. Universal streak implementation now exists and should be inspected/reused, not replaced based on the old points description. Font web embedding rights were explicitly confirmed by the user in chat. Pale lime Savings-page styling does not override the Dashboard's approved vivid-orange Savings card; Dashboard appearance is preserved by this brief.

Source: user-attached `pasted_content_2026-10-19_19-59-54-087_a7b008.txt`.

## Original brief (verbatim)

# HabitCents — Habits, Expenses & Savings UI Redesign

## Objective

Redesign and implement the **Habits, Expenses, and Savings pages** of HabitCents using the visual language established by the existing Dashboard.

The Dashboard has already been redesigned and should serve as the primary design reference.

The goal is to produce a cohesive, polished, responsive, and fully functional web application—not three unrelated pages or static design mockups.

This task focuses on implementing the three pages and their supporting functionality while preserving existing user data and application behavior.

## 1. Before Starting

Inspect the existing codebase thoroughly, including:

- Dashboard implementation and styling.
- Shared layout components, typography, navigation, and CSS.
- Existing Habits, Expenses, and Savings pages.
- API endpoints, routes, and browser JavaScript.
- MySQL schema and relationships.
- Authentication and user ownership checks.
- Existing preview server and automated tests.

Use the existing Express, EJS, CSS, browser JavaScript, and MySQL stack.

Do not migrate to React, Next.js, Tailwind, or another framework.

Reuse shared styles and components wherever appropriate.

Do not unnecessarily modify the Dashboard or unrelated pages.

Do not assume existing endpoints work correctly without examining their implementations.

Before implementing database changes, inspect how current data is stored and how existing features depend on it.

## 2. Global Design Language

All three screens must feel like natural extensions of the existing Dashboard.

### Visual style

Follow the Dashboard's established design:

- Warm gray-beige background.
- Near-black typography.
- Neue Haas Grotesk typography, using the locally configured fonts.
- Distinct pastel accent colors for functional sections.
- Rounded cards and soft geometric shapes.
- Minimal shadows and borders.
- Large, confident numerical typography.
- Compact but comfortable spacing.
- Clean charts with restrained visual decoration.
- Strong alignment and cohesive bento-style composition.
- Minimal, purposeful micro-interactions.

Use the existing design tokens wherever possible instead of hardcoding a second, inconsistent design system.

### Color direction

Use these approximate functional associations, adjusting to existing Dashboard tokens:

- Habits: lavender/purple.
- Expenses: powder blue.
- Savings: pale lime/green.
- Primary actions: near-black.
- Supporting surfaces: warm off-white.
- Additional category colors: muted but distinguishable pastel shades.

Do not turn the application into a dark/neon interface.

### Shared navigation

Keep the existing floating bottom navigation dock.

The dock should provide access to:

- Dashboard
- Habits
- Expenses
- Savings
- Profile

Preserve its active-state styling, iconography, and placement.

Maintain sufficient bottom padding so the dock never obstructs content or important controls.

### Page headers

Unlike the Dashboard, these pages do not need the large live-clock header.

Use a compact editorial page header with:

- A prominent page title.
- Optional short supporting text.
- A clearly visible primary action.

Examples:

Habits: "Your habits."
Expenses: "Your money."
Savings: "Your goals."

Keep the design simple, consistent, and uncluttered.

---

# 3. Habits Screen

## Design direction

The Habits page should be inspired by GitHub contribution graphs and the supplied habit-tracking reference screenshot.

Its defining visual feature should be **individual habit cards containing GitHub-style contribution heatmaps**.

Adapt this concept to HabitCents' existing light, warm, pastel visual language.

Do not copy the reference's dark background, neon styling, or unrelated metrics.

## Page layout

### A. Header

Display:

- "Your habits."
- A short supporting description.
- A prominent "+ New Habit" button.

### B. Progress summary

Below the header, show two key metrics:

**Today's Progress**
- Completed habits / required habits.
- Large numerical typography.
- A horizontal completion indicator.

**Universal Streak**
- Display the user's current consecutive-day streak.
- Use the distinct streak-card styling already established in the Dashboard.
- Display the streak in days.

Important: HabitCents uses **one account-wide universal streak**, not a separate streak per habit.

The streak increases once for each successfully completed day where all required habits are finished.

If a required habit remains incomplete at the end of that day, the universal streak resets to zero.

Do not increment the streak for every individual habit check-in.

Do not reintroduce difficulty points or per-habit point scoring.

Inspect the existing data model before implementing streak logic.

Define and consistently implement day-boundary, schedule, missing-history, and correction rules. Do not treat an unfinished current day as missed.

### C. Individual habit cards

Each habit should receive its own visually distinctive card.

Include:

- Habit icon.
- Habit name.
- Optional description.
- Habit category.
- Schedule or frequency.
- Quick completion/progress control.
- GitHub-style contribution heatmap.
- A way to open detailed history/editing.

Use different muted accent colors for different habits.

The heatmap must be the visual centerpiece of each card.

#### Heatmap requirements

Each square represents a calendar date.

Arrange the contribution grid in a conventional calendar layout:

- Seven rows representing weekdays.
- Columns representing consecutive weeks.
- Chronological date positioning.
- Month labels where space permits.
- Responsive grid sizing.

Show approximately 16–20 weeks on wider desktop cards where space allows.

On smaller screens, show fewer weeks rather than making the cells impossibly small.

A detailed habit view should support an extended history, ideally up to a year or all available recorded history.

#### Heatmap states

Distinguish:

1. Completed scheduled day.
2. Missed scheduled day.
3. Day without a recorded check-in or insufficient historical data.
4. Unscheduled/rest day.
5. Future date.
6. Partial progress, if the habit supports quantitative targets.

Do not fabricate historical completions.

Do not mark a date as missed simply because the application lacks records.

Choose accessible colors and include labels/tooltips so states do not depend on color alone.

#### Heatmap interaction

Allow clicking or selecting a date to inspect that day's habit record.

Past check-in corrections may be supported through the detailed view, subject to appropriate validation.

Historical corrections must be reflected in relevant calculations, including the universal streak.

Handle future and unscheduled dates appropriately.

### D. Completing habits

The upper-right area of each habit card should contain a prominent completion control.

For a binary habit:

- Click to complete today.
- Click again to undo if appropriate.
- Update the visual state immediately.
- Keep Dashboard and Habits summaries synchronized.

For quantitative habits:

- Open a compact progress entry.
- Allow users to record units toward a target.
- Examples include reading minutes or glasses of water.
- Reflect progress in the habit card.

Use clear loading, success, and error states.

### E. Habit creation and editing

Support:

- Creating habits.
- Editing habit names.
- Optional descriptions.
- Selecting and managing categories.
- Selecting an icon/color.
- Configuring a schedule.
- Optional quantitative targets.
- Archiving habits.
- Deleting habits with confirmation.

Preserve the existing preset habit library.

Integrate preset discovery within the Habits page rather than making it another top-level navigation destination.

Repair the existing preset-removal flow if it remains broken.

### F. Filtering and organization

Allow filtering habits by:

- All habits.
- Category.
- Due today.
- Archived habits through a separate view or filter.

Avoid excessive UI controls at the top of the page.

### G. Habit details

Selecting a habit should open a dedicated detail view or appropriately designed overlay.

Include:

- Large contribution calendar.
- Completion history.
- Schedule.
- Target configuration.
- Edit/archive/delete actions.

Do not add individual streak scores because the application uses a universal streak.

The main Habits page should remain focused on daily interaction and visual consistency.

---

# 4. Expenses Screen

## Design direction

The Expenses page should be a functional, information-dense personal finance workspace.

It should expand on the budgeting and spending features already visible on the Dashboard.

Use a cohesive bento layout, with clear financial figures and interactive charts.

## Page layout

### A. Header

Display:

- "Your money."
- Current selected month.
- "+ Add Expense" button.

Provide previous/next month navigation.

Do not restrict the page to only the current month.

### B. Monthly budget summary

Use a prominent powder-blue card displaying:

- Remaining budget.
- Total monthly budget.
- Total spent.
- Percentage of budget remaining.
- Budget progress indicator.

Use large, readable financial typography.

Include an "Edit Budget" action.

Budget editing must preserve existing expenses.

Never delete historical transactions when modifying or resetting a budget.

The existing monthly budget remains the intended budget/income input. Do not introduce a separate income-tracking module.

### C. Spending over time

Provide a time-series chart displaying spending over the selected month.

Requirements:

- X-axis: calendar dates.
- Y-axis: actual amount spent in BDT.
- Daily spending aggregation.
- Appropriate currency formatting.
- Hover/focus information for values.
- Responsive presentation.
- Correct handling of days without transactions.

Use simple bars initially, consistent with the existing Dashboard spending graph.

Do not confuse this chart with the category breakdown described below.

### D. Spending breakdown by category

This section must support **two switchable visualization styles**.

#### Default: circular donut chart

Use a donut chart as the default visualization.

Requirements:

- Each segment represents an expense category.
- Segment size represents its share of the selected month's spending.
- Each category uses a consistent color.
- Display total spending in the center of the donut.
- Keep the chart visually clean and readable.

#### Alternative: horizontal stacked bar

Provide a toggle allowing users to switch from the donut chart to a horizontal stacked bar.

The bar must show the exact same category distribution and amounts.

It should not replace the spending-over-time chart.

#### Shared chart behavior

Place one compact control near the top-right of the breakdown card:

- Circle
- Bar

Use the same category colors in both views.

Preserve the user's preferred chart view across page visits using an appropriate lightweight preference mechanism.

The chart switch must not reload the entire page unnecessarily.

#### Category legend

Always show a category breakdown below the chart, regardless of selected view.

Each category row should display:

- Category color marker.
- Category name.
- Percentage of monthly spending.
- Actual amount spent.

Allow clicking a category to filter the expense transaction list where practical.

Do not show fabricated financial data when the user has no transactions.

Provide an appropriate empty state.

### E. Transactions

Create a complete transaction-management section.

Each transaction should display:

- Description.
- Amount.
- Date.
- Category.
- Appropriate category color/icon.

Support:

- Adding expenses.
- Editing expenses.
- Deleting expenses.
- Searching transactions.
- Filtering by category.
- Filtering by date range.
- Filtering or sorting by amount.
- Browsing historical months.

Clicking a transaction should allow the user to view or edit it.

Use readable, compact rows rather than overly large individual transaction cards.

### F. Add expense interaction

The "+ Add Expense" button should open a quick-entry form or modal.

Fields:

- Description.
- Amount in BDT.
- Date.
- Category.

Provide validation and appropriate feedback.

After saving, update the transaction list, monthly totals, spending chart, breakdown chart, and relevant Dashboard data.

Retain "Uncategorized" as a valid fallback.

### G. Spending calendar

Provide a monthly spending calendar as a secondary feature.

Each calendar date should let users inspect spending recorded for that day.

Display per-day spending totals or visual indicators.

Distinguish zero recorded spending from missing or unavailable historical data when the application cannot establish the difference.

Avoid making the calendar compete visually with the main financial charts.

It can be placed in a collapsible section, secondary panel, or an internal view.

### H. Recurring expenses

Include management for recurring expenses and subscriptions.

Support:

- Creating recurring-expense definitions.
- Setting amount, category, frequency, and relevant dates.
- Viewing upcoming payments.
- Editing or disabling recurring expenses.

Do not automatically treat a scheduled recurring expense as a confirmed payment.

Require appropriate confirmation before recording an actual transaction.

Avoid silently duplicating financial records.

### I. Category consistency

Expense categories must have consistent colors throughout the entire app.

The same category should use the same color in:

- Transaction list.
- Spending breakdown.
- Spending calendar.
- Relevant Dashboard transaction displays.

Persist actual categories instead of inferring them from description text.

Category-specific budgets are not approved yet, so do not add that feature without clarification.

---

# 5. Savings Screen

## Design direction

The Savings screen should feel calm, motivating, and goal-oriented.

Use larger, more spacious cards than the Expenses page.

The primary visual element is **circular progress toward savings goals**.

Important: The switchable circle/bar visualization is for the **Expenses category breakdown**, not for Savings.

Savings should retain circular progress as its main presentation.

## Page layout

### A. Header

Display:

- "Your goals."
- A short supporting description.
- "+ New Goal" button.

### B. Savings overview

Provide a compact summary containing:

- Total saved across active goals.
- Number of active goals.

Use a pale lime/green card and large typography.

Do not overload the summary with unnecessary metrics.

### C. Savings goal cards

Display goals in a responsive grid.

Each goal card should include:

- Goal name.
- Large circular progress ring.
- Percentage completed.
- Current saved amount.
- Target amount.
- Optional deadline.
- "+ Add Savings" action.
- Access to editing and archiving.

Use distinctive but harmonious card colors.

Keep the circular ring prominent.

Avoid a second linear progress indicator inside the same card.

Use a two-column grid on sufficiently wide screens and a single-column layout on mobile.

### D. Add savings

Clicking "+ Add Savings" should open a compact form or overlay.

Allow the user to:

- Enter a contribution amount.
- Review the selected goal.
- Confirm the contribution.

Update the saved amount and progress ring after successful submission.

Handle invalid amounts and server errors properly.

### E. Savings goal management

Support:

- Creating a goal.
- Editing goal name and target.
- Editing optional deadline.
- Archiving goals.
- Viewing archived goals.
- Appropriate deletion safeguards if deletion is supported.

Maintain clear state for active, archived, and completed goals.

### F. Goal deadlines

Allow optional deadlines.

Display deadlines clearly but without creating an excessively complicated financial-planning interface.

Do not add required monthly contribution calculations unless approved.

### G. Scope restrictions

Do not add:

- Contribution-history pages.
- Monthly contribution trend charts.
- Milestone tracking systems.
- A full financial ledger for savings.
- Automatic transfers between expenses and savings.

These features are outside the currently selected Savings interface.

Withdrawals from savings goals remain undecided. Do not introduce withdrawal functionality without confirmation.

The interface should remain simple and focused on individual goal progress.

---

# 6. Responsive Design

All three pages must be fully responsive.

### Desktop

- Use the available horizontal space.
- Preserve the Dashboard's bento-inspired styling.
- Give important interactions appropriate prominence.
- Avoid excessive empty space.
- Maintain consistent gutters and spacing.

### Tablet

- Reflow multi-column sections where needed.
- Avoid squeezed charts and text.
- Allow habit cards and progress visualizations to resize sensibly.

### Mobile

- Stack main sections vertically.
- Keep primary actions accessible.
- Preserve the floating bottom navigation dock.
- Ensure charts remain readable.
- Shorten visible contribution-grid history to fit the screen.
- Keep tap targets sufficiently large.
- Avoid horizontal page overflow.
- Ensure forms and overlays work with the mobile keyboard.

Make the mobile experience intentional rather than merely compressing the desktop layout.

---

# 7. Motion and Interaction

Use subtle, purposeful animations:

- Habit check-in state transitions.
- Contribution heatmap cell updates.
- Savings progress-ring updates.
- Expense chart visualization switching.
- Card hover/focus states.
- Modal opening and closing.

Avoid exaggerated animations or unnecessary visual effects.

Respect `prefers-reduced-motion`.

Support keyboard navigation and accessible focus states.

Do not rely solely on hover interactions.

---

# 8. Data Integrity and Backend Requirements

These screens must work with real application data.

Do not hardcode demonstration values into production views.

Preserve all valid existing user records during the redesign.

Inspect and address relevant existing issues before extending the underlying features, including:

- User ownership verification.
- Expense validation.
- Habit ownership validation.
- Destructive budget updates.
- Missing preset-removal functionality.
- Existing streak logic that currently represents points rather than consecutive days.
- Unsafe insertion of user-provided strings into HTML.

Use safe rendering and parameterized database queries.

Do not deploy the app with known plaintext-password or insecure-session handling.

If database migrations are necessary:

1. Explain the required schema changes.
2. Design migrations that preserve existing data.
3. Do not silently discard or reinterpret historical records.
4. Avoid destructive migration steps.
5. Provide a way to verify the migration before applying it to real data.

For historical check-in data, clearly distinguish confirmed records from dates where no reliable record is available.

For universal streaks, avoid introducing misleading values from old point-based records.

---

# 9. Existing Dashboard Integration

The Dashboard should remain visually unchanged unless a small compatibility fix is required.

Ensure its shared data stays synchronized with the redesigned pages.

Examples:

- Completing a habit updates today's progress and the relevant streak.
- Adding an expense updates monthly spending and recent transactions.
- Editing an expense refreshes spending charts.
- Updating a savings goal updates the compact Dashboard savings indicator.

Do not add savings contribution controls to the Dashboard.

Do not replace the Dashboard spending-over-time chart with a category breakdown.

Maintain the existing dashboard date browsing, calendar strip, clock header, and navigation behavior.

---

# 10. Preview and Testing

The project already contains a preview server and a small automated test suite.

Inspect the existing approach before extending it.

Provide a way to preview all three redesigned pages without requiring a production database.

Preview-only mock data must be clearly separated from production data and must never be written to real user records.

Test:

- Page rendering.
- Responsive layout.
- Habit check/uncheck behavior.
- Universal streak computation and day boundaries.
- Heatmap calendar alignment and date states.
- Habit creation/editing.
- Expense CRUD.
- Safe budget editing.
- Category breakdown calculations.
- Donut/bar chart switching.
- Historical month navigation.
- Recurring-expense behavior.
- Savings progress calculations.
- Goal creation/editing/contributions.
- Authorization and input validation.
- Empty and error states.

Run the project's existing tests and add meaningful regression tests.

Do not claim tests passed unless they were actually executed.

---

# 11. Implementation Workflow

Work in a structured sequence.

**Phase 1 — Inspection**

Inspect the project and identify reusable UI components, existing feature coverage, backend limitations, and required schema changes.

**Phase 2 — Shared design system**

Establish reusable styles for page headers, cards, controls, chart containers, overlays, spacing, and responsive behavior without disrupting the existing Dashboard.

**Phase 3 — Habits**

Implement the Habits page with individual contribution-heatmap cards, quick check-ins, detailed history, creation/editing, and universal streak behavior.

**Phase 4 — Expenses**

Implement the budget overview, transactions, spending-over-time chart, switchable donut/stacked-bar category breakdown, spending calendar, and recurring expenses.

**Phase 5 — Savings**

Implement circular-progress goal cards, goal creation/editing, contributions, deadlines, and archive management.

**Phase 6 — Integration and validation**

Connect real data, verify synchronization with the Dashboard, improve accessibility, test responsiveness, and run regression tests.

Keep changes reviewable and avoid rewriting unrelated application architecture unnecessarily.

When a feature requires an unresolved product decision, ask for clarification rather than inventing requirements.

---

# 12. Expected Result

At completion, HabitCents should have:

1. A visually cohesive Habits screen built around interactive GitHub-style contribution grids.
2. A fully featured Expenses screen with budget management, transaction history, spending trends, and a switchable donut/stacked-bar category breakdown.
3. A clean, goal-oriented Savings screen with prominent circular progress indicators.
4. Consistent typography, colors, navigation, interactions, and responsive behavior across all screens.
5. Functional integration with real database records, with existing user data protected.

The finished experience should feel like a thoughtfully designed personal tracking product, not a generic admin dashboard.

Prioritize clarity, usability, visual quality, and consistency with the Dashboard.

**Begin by inspecting the current implementation and summarizing the plan, required changes, and any unresolved decisions before modifying files. Do not immediately start a large rewrite.**