---
title: "HabitCents"
created: "2026-10-18"
updated: "2026-10-18"
type: summary
tags: [project, habit-tracking, personal-finance, mobile-app, ui-design]
---

# HabitCents

## Purpose and Concept
HabitCents is an older personal project combining habit tracking and everyday budgeting. The user likes the core idea and wants to rejuvenate it, improve the implementation, and apply their visual design language.

## Current State and Handoff
- Status / stage: planning
- Existing repository: `C:\Users\Sabbir Ahmed\Desktop\projects\habitcents`
- Existing implementation: Express 5 + EJS web app, browser JavaScript modules, MySQL schema, and session-based login. Source architecture/schema was inspected on 2026-10-18. On 2026-10-18, the first UI work revised the dashboard and shared authenticated navbar; templates/styles/client module and a Node built-in test suite were updated. A separate local mock preview server (`npm run preview`, `http://127.0.0.1:3001`) now renders the dashboard with in-memory sample data, without MySQL. `npm test` passes (5 tests); the dashboard has not been verified against the real database.
- Known technical concerns include plaintext password handling, hard-coded session secret, inconsistent ownership checks and validation, missing preset-habit removal endpoint, and no prior automated tests (a small UI/preview test suite now exists).

## Confirmed Decisions and Requirements
- Current priority (2026-10-18, user decision in Discord): revamp the existing web app using the current Express/EJS/CSS/browser JavaScript/MySQL stack; defer native-app work.
- Earlier direction: user wanted a native app rather than a PWA. This remains a possible later phase, not the immediate implementation scope.
- User wants their Pinterest-board design language integrated into HabitCents. Boards are documented at [[Projects/Gamebook/Design Language|Gamebook Design Language]]; reuse the visual principles, not Gamebook-specific UI requirements.
- Shared screenshot references are inspiration for both appearance and tracking/insight features. Individual additions and exact visual treatments remain **suggested — not yet confirmed**, collected with the current feature inventory in [[Projects/HabitCents/Features and Scope|Features and Scope]] for later user review.
- The boards suggest quiet foundations, compact purposeful modules, strong legible data typography, tactile history/progress indicators, restrained accents, soft geometry, and a personal tracking tone. Light/dark choice and exact tokens remain open.

## Proposals and Open Questions
- Open for the web revamp: feature priorities, theme direction, exact design tokens, and first screen to redesign.
- Deferred native-app proposals: React Native with Expo, retaining/refactoring the Node/MySQL backend into a secure JSON API, and Android/iOS platform scope. None has been selected; these do not drive the current web revamp.

## Priorities and Next Steps
- Confirmed priority: revamp the current web app; worry about a native app later.
- Recommended: define web-revamp scope and design direction, prototype the dashboard, and address the documented security/data-integrity risks before deployment. These sequencing suggestions are not yet an approved implementation plan.

## Project Notes
- User-assigned Codex scope for Habits, Expenses and Savings: [[Projects/HabitCents/Pages Redesign Brief|Pages Redesign Brief]] (original preserved with stale-stack annotations; requested work, not verified implementation).
- Feature inventory and proposed additions: [[Projects/HabitCents/Features and Scope|Features and Scope]]
- Architecture and schema: [[Projects/HabitCents/Architecture and Schema|Architecture and Schema]]
- Design reference: [[Projects/Gamebook/Design Language|Pinterest-board design language (visual principles only)]]
