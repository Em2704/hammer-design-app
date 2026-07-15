# Hammer Selector — front end (PWA)

Installable web app that recommends the hammer weight putting the **least strain on the body**
for a hammering job. Phase 1–2 prototype.

> **⚠️ Stub data.** All strain numbers on screen are placeholders shaped to look plausible —
> **not** study output. The real recommendation engine (Phase 3, built in the parent project's
> `engine/`) is finished but not yet wired into this deployed app; that happens in Phase 4 when
> the FastAPI backend lands.

## Live app

**<https://em2704.github.io/hammer-design-app/>** — served over HTTPS, so it installs directly
on desktop and on Android / Windows tablets (see [Installing as an app](#installing-as-an-app)).

## What's new

- **Deployed live on GitHub Pages** (HTTPS). Because it's a secure context, tablets can now
  install it straight from the URL above — no tunnel or local HTTPS needed anymore.
- **Network-first service worker** (`sw.js`, cache `hammer-selector-v3`). It now fetches the
  latest files whenever you're online (local dev included) and falls back to cache only when
  offline. This fixes the earlier bug where edits never showed because the old cache-first worker
  kept serving stale files.
- **"Strikes made (approx.)" input.** An optional rough strike count that sharpens the
  fatigue/workload estimate (more strikes → more cumulative strain). Leave it blank and the
  time-on-the-job value is used instead. When set, the report shows an `≈N strikes` badge.
- **Material approximation with a disclaimer.** Materials the study didn't measure
  (rubber, plastic, metal, concrete) are approximated to the nearest measured surface by hardness,
  and the report shows a warning banner saying so.
- **Weight interpolation.** The study measured 15, 16, 20 & 22 oz; any other weight you pick is
  interpolated between them (and extrapolated, clamped, past the ends).

## Run it locally

```bash
cd frontend
python -m http.server 8731
```
Open <http://localhost:8731/index.html>.

## How to test

### 1. Quick check (live or local)
Open the app, then on the **Job spec** panel:
- Pick a **Material struck**, drag **Hammer weight** and **Time on the job**, optionally type a
  **Strikes made** count, and click **Run strain report**.
- The **Strain report** panel lists *your* hammer plus the four study weights ranked by overall
  strain (lower bars = less load).

### 2. Test the new inputs specifically
- **Strikes input:** run a report with the field blank, then run again with e.g. `250`. Fatigue
  and workload should rise and an `≈250 strikes` badge should appear on your-hammer card.
- **Approximation disclaimer:** choose **Wood** or **Knob** (measured) → no banner. Choose
  **Metal**, **Concrete**, **Plastic**, or **Rubber** (not measured) → a warning banner appears
  saying results are approximated from the nearest measured surface.
- **Interpolation:** set the weight to a studied value (16/20/22) vs. an in-between value (e.g. 18)
  and confirm your-hammer strain moves smoothly between the neighbours.

### 3. Test the service worker (offline + freshness)
- **Freshness:** with DevTools open (Application → Service Workers), edit a file, reload — you
  should see the new version immediately while online (network-first). If not, tick
  *Update on reload* / *Bypass for network*, or bump `CACHE` in `sw.js`.
- **Offline:** load the app once, then go offline (DevTools → Network → *Offline*, or airplane
  mode) and reload — it should still open and run from cache.

### 4. Test install
See [Installing as an app](#installing-as-an-app) below.

## Files

| File | Purpose |
|---|---|
| `index.html` | The page (job-spec form + strain report) |
| `styles.css` | "Spec-sheet" visual design |
| `app.js` | Stub recommendation logic, weight interpolation, strike/duration scaling |
| `manifest.json` | PWA metadata (name, icons, colors) |
| `sw.js` | Service worker — network-first, offline fallback, precached app shell |
| `icons/` | App icons (192, 512, maskable) |
| `icon.html` | Source used to generate the icons (not shipped to users) |

## Installing as an app

A browser offers **Install** when the manifest loads, a service worker is active, and the page is
on a **secure context** (HTTPS or `localhost`).

- **From the live URL:** it's HTTPS, so install works directly on desktop
  (Chrome/Edge: install icon in the address bar, or menu → *Install Hammer Selector*) **and on
  Android / Windows tablets** (browser menu → *Install app* / *Add to home screen*).
- **Local dev on this computer:** `localhost` counts as secure, so install works from
  `http://localhost:8731` too.
- **Local dev reached from a tablet by IP** (e.g. `http://192.168.x.x:8731`): plain `http://` over
  the network is **not** a secure context, so the service worker won't register and install won't
  appear. Use the live URL instead, or run a tunnel
  (`cloudflared tunnel --url http://localhost:8731` or `ngrok http 8731`) and open its HTTPS link.

Once installed it launches in its own window (no browser chrome) and opens offline.

## Note on iOS
Not a target. iOS supports PWAs but with limitations; this project targets Android + Windows.
