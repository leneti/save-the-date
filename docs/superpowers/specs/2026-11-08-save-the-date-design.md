# Save-the-Date Website — Design Spec

**Date:** 2026-11-08
**Couple:** Emilija & Dominykas
**Wedding date:** Friday, 2027-08-20
**Status:** Approved in brainstorming; awaiting written-spec review

## 1. Goal

A one-page, mobile-first save-the-date site that friends open from a shared link. The visitor presses a brass button on an animated photobooth; a real photobooth strip of the couple "prints" into the slot. The page then shows the couple's names, the date, and a button that adds the wedding to the visitor's calendar.

Success: a friend opens the link, presses the button, smiles at the strip printing, and leaves with 2027-08-20 in their calendar. This takes about ten seconds.

Inspiration is screens 1–2 of `example.png` (press-to-print → printed strip). We are not copying its colours, art, or layout pixel-for-pixel.

### Out of scope

- QR code.
- RSVP, address collection, or any data from guests. The site has no backend and stores no personal data.
- Countdown timer, music/vinyl player, venue details, scrapbook screen (screen 3 of the example).
- Multiple strips, "print another", strip browsing.
- Language toggle. Custom domain. Analytics. Cookies.

## 2. Copy (final)

`<html lang="lt">`. "Save the Date" stays English; everything else is Lithuanian.

| Element | Text |
|---|---|
| Brass plate (waiting state) | **Paspausk mygtuką!** with a **↓** arrow beneath |
| Etched in empty slot | **Save the Date** |
| Heading after printing | **Emilija & Dominykas** |
| Date | **2027.08.20** |
| Primary calendar button | **Pridėti į kalendorių** |
| Secondary link (Apple/desktop) | **Google kalendorius** |
| Secondary link (Android) | **Kitas kalendorius** |
| Footer line | **Kvietimą atsiųsime vėliau** |
| Close-up close button (aria-label) | **Uždaryti** |
| Print button (aria-label) | **Spausdinti nuotraukas** |
| Strip image alt text | **Emilijos ir Dominyko nuotraukų juostelė** |
| Calendar event title | **Emilijos ir Dominyko vestuvės** |
| Calendar event description | **Kvietimą atsiųsime vėliau.** + site URL |
| Page `<title>` / OG title | **Save the Date · Emilija & Dominykas** |
| OG description | **2027.08.20** |

The couple will proofread the alt texts and aria-labels; they are not visible on the page.

## 3. Visual design

### Palette ("olive & brass")

| Token | Value | Use |
|---|---|---|
| `--olive` | `#3f4a32` | Page background |
| `--cream` | `#efe7cf` | Text on olive |
| `--brass-light` | `#f0dca2` | Brass highlight |
| `--brass` | `#a7843f` | Brass midtone |
| `--brass-dark` | `#8a6a2c` | Brass shadow |
| `--ink` | `#3a2c10` | Text engraved on brass |
| `--paper` | `#f6efdc` | Strip paper border |

Brushed brass = layered linear gradients plus a fine repeating stripe (and optional SVG noise). The machine is drawn entirely in CSS/SVG; there are no bitmap textures. The values above are starting points and may be tuned during implementation; the olive + brass direction is fixed.

### Typography (self-hosted woff2, OFL licences)

- **Pinyon Script**: names, etched "Save the Date".
- **Cormorant Garamond 500**: date.
- **Josefin Sans 400/600**: plate text, button, links, footer (uppercase, letter-spaced). Must include the latin-ext subset for ą č ę ė į š ų ū ž.

### Composition

Single centred column, `max-width: 440px`, olive fills the viewport. On desktop the column is centred on the olive ground. Use `svh`/`dvh` units and respect safe-area insets.

**Waiting state** (top → bottom): brass plate with four screws ("Paspausk mygtuką!" + ↓) → recessed brass slot with etched "Save the Date" → **print button**.

**Print button (option C):** round brushed-brass button about 64px across with an engraved inner ring. A pulsing halo ring expands outward on a loop (about 1.8s) to draw the eye. It is the obvious target. Tapping the plate or the slot also starts printing.

**Printed state** (top → bottom): "Emilija & Dominykas" in script (replaces the plate) → slot containing the strip → date → filled brass primary button → small underlined secondary link → footer line pinned near the bottom.

**Names must never overflow.** Use a fluid size (`clamp()` against viewport width). At widths ≤ about 340px the names wrap onto two lines ("Emilija &" / "Dominykas").

## 4. Interaction & animation

The page is a single view that changes in place through these states:

```
idle ──press──▶ countdown ──▶ flash ──▶ printing ──▶ printed ⇄ zoomed
```

The trigger is the print button, the plate, or the slot. The trigger works only in `idle`, so a double tap cannot start printing twice.

### Timeline (normal motion)

| t (s) | Event | Sound | Vibration (Android) |
|---|---|---|---|
| 0.00 | Button depresses (≈120ms), halo stops | click/tick | 15ms |
| 0.20 | Plate text → **3** | tick | — |
| 0.90 | Plate → **2** | tick | — |
| 1.60 | Plate → **1** | tick | — |
| 2.30 | White full-screen flash: up in 60ms, hold 80ms, fade 400ms | shutter | — |
| 3.10 | Motor starts; strip feeds down into slot in **4 jerks** (≈450ms move + ≈300ms pause each, ≈3s total); etched "Save the Date" fades as strip covers it | whirr (loops through feed) | 40ms per jerk |
| 6.10 | Strip lands with a small bounce (≈200ms) | clunk | 30ms |
| 6.30 | Reveal, staggered by about 0.2s: plate crossfades to names; print button fades out; then date, primary button, secondary link, and footer fade/rise in | — | — |
| ≈7.4 | Fully revealed (`printed`) | — | — |

Durations live in CSS custom properties or one JS constants object so they can be tuned together.

### Close-up (`zoomed`)

- Tapping the strip in `printed` opens a native `<dialog>`. The strip animates up to fit the viewport height, and the backdrop dims.
- The dialog closes when the visitor taps anywhere, taps **Uždaryti**, presses Escape, or uses Back.
- Opening the dialog pushes a history entry, so the Android back gesture closes it instead of leaving the page.
- After closing, the strip animates back into the slot.

### Reduced motion (`prefers-reduced-motion: reduce`)

- The halo is shown as a static ring with no pulse.
- Countdown numbers swap with no movement.
- **There is no flash.**
- The strip fades in, already in place, over about 600ms with no jerks or bounce.
- Revealed elements fade in without translating.
- Sounds still play.
- The end state is the same as in normal motion.

### Sound

- There are 4 short CC0 samples (tick, shutter, whirr, clunk), about 60 KB in total, in mp3 format.
- **The developer picks the candidates and the couple approves them before they ship.** Record each source URL and licence in `assets/sounds/CREDITS.md`.
- Playback uses the Web Audio API. Buffers are fetched and decoded while the page is idle, and the `AudioContext` is resumed on the press gesture.
- An iPhone on silent stays silent, which is the default iOS Web Audio behaviour. There is no mute control.
- Any audio failure is swallowed; the animation proceeds silently.

### Vibration

`navigator.vibrate` if present (Android Chrome); otherwise skipped. iOS has no web vibration, which is acceptable.

### Accessibility

- The print button is a real `<button>`. The plate and slot use the same handler but are not separately focusable.
- An `aria-live="polite"` region announces "Emilija & Dominykas, 2027.08.20" on reveal.
- Calendar controls are real links with clear names.

## 5. Add to calendar

### Event

- All-day event: `DTSTART;VALUE=DATE:20270820`, `DTEND;VALUE=DATE:20270821`. This is a floating date with no time zone, so it never shifts between time zones.
- `SUMMARY:Emilijos ir Dominyko vestuvės`
- `DESCRIPTION:Kvietimą atsiųsime vėliau.\n<site URL>`
- No location and no alarm.
- Fixed `UID` (`20270820-emilija-dominykas@<site host>`) and a fixed `DTSTAMP`, so the file is deterministic.
- UTF-8, CRLF line endings, lines folded at 75 octets, `VERSION:2.0`, `PRODID`, `CALSCALE:GREGORIAN`, `METHOD:PUBLISH`.

### Delivery

- **`.ics`**: a static file `/save-the-date.ics` served via `netlify.toml` with:
  - `Content-Type: text/calendar; charset=utf-8`
  - `Content-Disposition: attachment; filename="emilijos-ir-dominyko-vestuves.ics"`

  iOS Safari opens this in Calendar's add-event sheet.
- **Google Calendar**: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates=20270820/20270821&details=…`, URL-encoded.

### Platform ordering

Detected client-side from the user agent:

| Platform | Primary "Pridėti į kalendorių" | Secondary link |
|---|---|---|
| Android | Google Calendar URL | **Kitas kalendorius** → `.ics` |
| iOS / iPadOS (incl. iPadOS reporting as Macintosh with touch) / desktop / unknown | `.ics` | **Google kalendorius** → Google URL |

Reason: Google Calendar on Android cannot import `.ics` files.

`calendar.js` exports pure functions: `buildIcs(event)`, `googleCalendarUrl(event)`, `calendarLinks(userAgent, maxTouchPoints)`. A unit test asserts that the committed `save-the-date.ics` equals `buildIcs()` output byte-for-byte.

## 6. Link preview (Open Graph)

- `og:title`, `og:description`, `og:type=website`, `og:url`, `og:image` (absolute URL, 1200×630 JPEG), `og:locale=lt_LT`, plus `twitter:card=summary_large_image`.
- Image design: olive ground, the couple's strip tilted about −4°, "Save the Date" in brass script, names and date in cream.
- The image is generated from the real strip by `scripts/prepare-strip.sh`; until then it uses the placeholder strip.
- The production origin is one constant, `SITE_URL` in `calendar.js`. It is used for the `.ics` description and UID host, and it is mirrored in the OG tags. A test asserts the OG tags in `index.html` use the same origin.
- Because `og:url` and `og:image` need the absolute production URL, the Netlify site name must be fixed before launch (proposed: `emilija-dominykas.netlify.app`).

## 7. File structure

```
index.html            markup, meta/OG tags, no-JS fallback
styles.css            tokens, machine, states, animations, reduced-motion
app.js                state machine, timeline, zoom dialog, sound, vibration, calendar link wiring
calendar.js           pure calendar helpers (ES module, importable by Node tests)
save-the-date.ics     static calendar file (checked against calendar.js by test)
netlify.toml          headers for .ics; cache headers for assets
assets/
  strip.webp          the single chosen strip (placeholder until real photo); ~2x for close-up, target ≤200 KB
  og-image.jpg        1200×630
  sounds/             tick.mp3, shutter.mp3, whirr.mp3, clunk.mp3, CREDITS.md
  fonts/              woff2 files + licence texts
  favicon.svg         "E & D" monogram
scripts/
  prepare-strip.sh    one-off: crop/straighten/colour-correct photo → strip.webp + og-image.jpg
tests/
  calendar.test.js    node --test
  e2e/flow.spec.js    Playwright
package.json          dev-only deps (@playwright/test); no runtime deps; scripts: test, test:e2e, serve
```

Plain HTML/CSS/JS with **no build step**; deploy the repo root as-is. JS is loaded as ES modules.

### Graceful degradation

- **No JavaScript:** `<html class="no-js">` is swapped to `js` by an inline script; CSS shows the printed state (names, strip, date, `.ics` primary link, Google secondary link, footer) without animation.
- **Strip image:** preloaded during idle; the slot shows a paper-coloured frame if the image fails.
- **Audio and vibration:** failures are ignored.

### Performance budget

Total transfer under 1 MB (target: about 500 KB with the real strip). Fonts preloaded with `font-display: swap`. Nothing render-blocking beyond `styles.css`.

## 8. Photos

- The couple will photograph their favourite physical 4-frame strip: daylight, no flash, flat on a matte surface, shot straight down, at full resolution.
- `prepare-strip.sh` (ImageMagick/cwebp) crops, straightens, colour-corrects, and exports the strip.
- Black-and-white vs. a warm/sepia tint is decided by comparing both versions once the real photo exists.
- Until then, a generated placeholder strip (four warm-toned frames on paper) is used everywhere.

## 9. Testing

### Unit tests (`node --test`)

- `.ics`:
  - all-day `DATE` values 20270820/20270821;
  - UTF-8 title with ė/ų intact;
  - CRLF endings;
  - line folding ≤75 octets;
  - required properties present;
  - static file matches `buildIcs()`.
- Google URL: correct params and encoding.
- `calendarLinks`: Android UA → Google primary; iPhone UA → `.ics` primary; iPadOS-as-Mac + touch → `.ics`; desktop → `.ics`.

### End-to-end (Playwright)

Devices: iPhone 13, Pixel 7, and a 320px-wide viewport (iPhone SE class).

- Waiting state shows plate, slot, and button; no names, date, or calendar controls.
- Pressing the button reaches `printed` within 10s with names, date, both calendar controls, and the footer visible.
- Tapping the plate, and separately the slot, also starts printing. A double press does not double-run.
- No horizontal overflow in any state (`scrollWidth ≤ clientWidth`); the names fit at 320px.
- Close-up opens on strip tap and closes via tap, Escape, and browser Back.
- Calendar hrefs are correct per device (Pixel → Google primary; iPhone → `.ics` primary).
- With reduced motion emulated, the flow reaches the same final state and no flash element is shown.
- With JS disabled, the printed state renders statically.

### Manual pre-launch checklist

- Real iPhone: `.ics` opens the Calendar add sheet; sound with silent mode on and off.
- Real Android: Google Calendar opens prefilled; vibration felt.
- Desktop: `.ics` downloads and imports into Outlook or Apple Calendar.
- Link preview correct in Messenger and WhatsApp (and the Facebook Sharing Debugger).
- `curl -I https://<site>/save-the-date.ics` shows the `text/calendar` content type.

## 10. Deployment

- GitHub repository connected to Netlify with continuous deployment from `main`. The publish directory is the repository root and there is no build command.
- The Netlify site is renamed to `emilija-dominykas.netlify.app` (or the couple's choice) before the OG URLs are finalised.
- Use a deploy preview to review before the link is shared.
- `.gitignore`: `.superpowers/`, `.llms/`, `node_modules/`, `test-results/`, `playwright-report/`.

## 11. Inputs needed from the couple

1. A photo of the chosen strip (can arrive late; the placeholder is used until then).
2. The final Netlify site name.
3. Approval of the four sound samples.
4. Proofreading of the alt text and aria-label wording.
5. GitHub and Netlify accounts, or permission to create and connect them.
