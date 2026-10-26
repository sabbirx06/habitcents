# HabitCents brand and landing page

The landing page uses the app's existing warm canvas (`#dedbd4`), paper
(`#f7f6f0`), charcoal (`#222320`), blue (`#c5d4e7`), and lilac (`#e0cfe0`).
Muted green supports habit progress. Blue supports money and future goals.
Neue Haas Grotesk Text and Display are served locally using the existing licensed
font setup. The simplified landing page uses Neue Haas throughout, including
its centered headline; no serif accent or decorative hero artwork remains.

## Logo placement

- Full wordmark: landing navigation/footer and login/signup identity.
- Transparent compact mark: product illustration/preview, account artwork,
  authenticated navigation dock, and interim browser favicon.
- Light SVG version: retained for contexts that need its cream field.
  The transparent assets suit the current colored surfaces better.

`views/partials/brand.ejs` and `public/css/brand.css` share the placements.
Every page and favicon uses SVG. Natural image sizing replaces the earlier PNG
cropping offsets. SVG view boxes include the complete artwork with modest padding.
The supplied Neue Haas Grotesk Text Bold face is embedded unchanged in each SVG,
so image and favicon contexts do not rely on page styles or installed fonts.
The currency emblem uses the embedded Geist Bold dollar glyph, as selected by
the user. No custom S or separate strike is used.
The `h` and wordmark use Neue Haas. Remaining legacy page font styles
also use locally hosted Instrument Sans, replacing Geist. The font comes from
[Google Fonts](https://github.com/google/fonts/tree/main/ofl/instrumentsans);
its SIL Open Font License is retained at `public/fonts/InstrumentSans-OFL.txt`. Run
`node scripts/prepare-brand-svg.cjs` to refresh embedded fonts after asset edits.
An outlined master remains useful for design-tool exchange, though the current
web SVGs are self-contained. Original PNGs are retained as unused source assets.
The wordmark should be used on light backgrounds;
the current assets do not provide a reversed wordmark for dark backgrounds.

## Artwork needed before app distribution

Current self-contained SVGs are sufficient for this website. Request these production exports
before native app work or final favicon polish:

1. Outlined vector masters of the wordmark and compact mark for design-tool exchange.
   A licensed full Neue Haas font with currency glyphs is needed if the `$` must
   also use Neue Haas instead of the Geist symbol.
2. Flat monochrome and reversed/light variants for dark surfaces and small sizes.
3. An approved, simplified square app icon master at 1024 × 1024, with no baked-in
   rounded corners and intentional platform-safe padding. Platform-specific
   exports should be made when the iOS/Android targets are selected; Android
   will need adaptive foreground/background artwork.
4. A small-size favicon family (16/32/48px), Apple touch icon (180px), and web-app
   icons (192/512px, including a separate maskable composition if we ship a PWA).

The current compact logo is horizontally proportioned;
it is an interim favicon, not a final app-icon composition. A web manifest or
service worker has not been added, and the landing page does not advertise a
downloadable app or bank integration.

## Behavior and verification

The single page has minimal account navigation, a centered hero, one dashboard
screenshot, a four-feature explorer (Dashboard, Habits, Money, Savings), and a
footer reading “Made with ♥ by Team Alpha.” Signup/login links use the existing
account routes. Android is a disabled “Coming later” button with an explicit note
that development has not started. There is no download, waitlist, or fabricated
release date.

The hero rotates one word: habits → money → savings. Its fixed measurement slot
reserves the longest word's width, and a stable accessible heading mentions all
three subjects without repeated screen-reader announcements. The flip runs every
few seconds, can be paused/resumed, and stops when hidden or outside the viewport.
The existing `HabitMotionPreference` controller remains authoritative: reduced
motion shows static “habits,” while explicit On/Off choices override the system.
There are no ornamental scroll reveals. Feature tabs are manually selected and
support arrow keys, Home and End. Content remains visible without JavaScript.

Product screenshots are WebP assets in `public/media/previews/`, captured from the
isolated database-free preview with sample data. Regenerate them with
`node scripts/capture-product-previews.cjs` after app UI changes. No live user
data or external service is used. The four assets total approximately 220 KB.
The landing page adds no framework or third-party runtime dependency.

Run `node scripts/verify-landing.cjs` on Windows with installed Chrome (or set
`CHROME_PATH`). It creates an isolated local preview and disposable headless
profile, checks 320/390/768/1024/1440px layouts, all four feature tabs, actual
word rotation and pause/resume, reduced motion, image loading, and the disabled
Android button. Screenshots/results go into
ignored `.cache/landing-review/`. The preview server now serves the landing page
at `/` and supports viewing the account forms; preview account submissions
remain unavailable.

Full-suite verification: 161 of 163 tests pass. Existing failures concern the
motion preference assertion finding an OS media query in unchanged `auth.css`,
and the habit-color test expecting five colors while the pre-existing workspace
changes supply six. Landing browser checks pass with no runtime exceptions or
failed HTTP resources. Browser viewport emulation does not replace physical
device or screen-reader testing.
