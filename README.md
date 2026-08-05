# Hammer Selector — front end (PWA)

Installable web app that recommends the hammer weight putting the **least strain on the body**
for a hammering job.

> **Real study data.** Rankings come from the actual recommendation engine
> (`engine/recommend.js`) run over group means from a MATLAB biomechanics study
> (participants P10–P17, n = 8). The earlier stub numbers are gone. See
> [Where the numbers come from](#where-the-numbers-come-from) for what is measured
> versus approximated.

## Live app

**<https://em2704.github.io/hammer-design-app/>** — served over HTTPS, so it installs directly
on desktop and on Android / Windows tablets (see [Installing as an app](#installing-as-an-app)).

## Where the numbers come from

The app ranks the four studied hammers (**S ≈ 15 oz, 16, 20, 22 oz**) on four *visible*
components — muscle effort, shock to arm, fatigue, workload — and never on a single
black-box score. Only metrics the study measured reliably are used; the study's own
composite "injury risk index" is deliberately **excluded** because its weights were
never validated.

| | |
|---|---|
| **Measured surfaces** | `knob`, `wood` — direct study data, shown as high confidence |
| **Approximated** | `rubber`, `plastic`, `metal`, `concrete` — mapped to the nearest measured surface by hardness, with a visible disclaimer |
| **Task** | Hammering only (that is all the study covers) |

Two results worth knowing, straight out of the data:

- **Knob** behaves as you'd expect — strain rises with weight: `S < 16 < 20 < 22`.
- **Wood does not.** The ranking is `S < 22 < 20 < 16` — the **16 oz is the worst**
  choice on wood (highest energy per strike), and the 22 oz comes second-best. This is
  a real, non-monotonic finding, not a bug.

## What's new

- **The real engine is wired in.** `app.js` no longer computes stub numbers — it fetches
  `engine/profiles.v1.json` and calls `window.HammerEngine.recommend`, the same pure
  function that the project's FastAPI backend runs server-side. Online, offline, or via the
  API, the numbers agree.
- **Works offline with the real data.** The service worker (`sw.js`, cache
  `hammer-selector-v4`) precaches the engine and its dataset alongside the app shell.
- **Network-first service worker.** It fetches the latest files whenever you're online
  (local dev included) and falls back to cache only when offline. This fixed an earlier bug
  where edits never showed because a cache-first worker kept serving stale files.
- **"Strikes made (approx.)" input.** An optional rough strike count that sharpens the
  fatigue/workload estimate. Leave it blank and time-on-the-job is used instead. When set,
  the report shows an `≈N strikes` badge.
- **Material approximation with a disclaimer.** Unmeasured materials are approximated to the
  nearest measured surface by hardness, and the report shows a warning banner saying so.
- **Weight interpolation.** Any weight you pick that isn't 15/16/20/22 oz is interpolated
  between the studied hammers (and extrapolated, clamped, past the ends).

## Run it locally

```bash
cd frontend
python -m http.server 8731
```
Open <http://localhost:8731/index.html>.

No backend is required — the engine runs client-side.

## How to test

### 1. Quick check (live or local)
Open the app, then on the **Job spec** panel:
- Pick a **Material struck**, drag **Hammer weight** and **Time on the job**, optionally type a
  **Strikes made** count, and click **Run strain report**.
- The **Strain report** panel lists *your* hammer plus the four study weights ranked by overall
  strain (lower bars = less load).

### 2. Confirm it's the real engine
- Choose **Wood**, 30 minutes → the order should be **S, 22, 20, 16** (non-monotonic).
- Choose **Knob**, 30 minutes → the order should be **S, 16, 20, 22** (monotonic).

If wood comes back in plain weight order, you're looking at a stale cached build — see the
service-worker step below.

### 3. Test the inputs specifically
- **Strikes input:** run a report with the field blank, then again with e.g. `250`. Fatigue
  and workload should rise and an `≈250 strikes` badge should appear on your-hammer card.
- **Approximation disclaimer:** **Wood** or **Knob** (measured) → no banner. **Metal**,
  **Concrete**, **Plastic**, or **Rubber** → a warning banner appears saying results are
  approximated from the nearest measured surface.
- **Interpolation:** set the weight to a studied value (16/20/22) vs. an in-between value
  (e.g. 18) and confirm your-hammer strain moves smoothly between the neighbours.

### 4. Test the service worker (offline + freshness)
- **Freshness:** with DevTools open (Application → Service Workers), edit a file, reload — you
  should see the new version immediately while online (network-first). If not, tick
  *Update on reload* / *Bypass for network*, or bump `CACHE` in `sw.js`.
- **Offline:** load the app once, then go offline (DevTools → Network → *Offline*, or airplane
  mode) and reload — it should still open **and still produce rankings**, since the engine and
  its dataset are precached.

### 5. Test install
See [Installing as an app](#installing-as-an-app) below.

## Files

| File | Purpose |
|---|---|
| `index.html` | The page (job-spec form + strain report) |
| `styles.css` | "Spec-sheet" visual design |
| `app.js` | Gathers inputs, calls the engine, draws the report (no logic of its own) |
| `engine/recommend.js` | The real recommendation engine — pure, deterministic ranking function |
| `engine/profiles.v1.json` | Study group means per hammer × surface + material mapping |
| `manifest.json` | PWA metadata (name, icons, colors) |
| `sw.js` | Service worker — network-first, offline fallback, precaches shell **and engine** |
| `icons/` | App icons (192, 512, maskable) |
| `icon.html` | Source used to generate the icons (not shipped to users) |

> `engine/` here is a **deploy copy**. The canonical engine, its unit tests, and the backend
> that shares the same math live in the project's private internal repo.

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
