# Hammer Selector — front end (PWA)

Phase 1–2 prototype. **All metric values are stub/placeholder data**, not study output.
Real numbers arrive once the MySQL database + API are built (Phases 4–5).

## Run it locally

```bash
cd frontend
python -m http.server 8731
```
Open <http://localhost:8731/index.html>.

## Run it Hosted by Github 

Open <https://em2704.github.io/hammer-design-app/>

## Files

| File | Purpose |
|---|---|
| `index.html` | The page (input form + strain report) |
| `styles.css` | "Spec-sheet" visual design |
| `app.js` | Stub recommendation logic + weight interpolation |
| `manifest.json` | PWA metadata (name, icons, colors) |
| `sw.js` | Service worker — precaches the app shell for offline use |
| `icons/` | App icons (192, 512, maskable) |
| `icon.html` | Source used to generate the icons (not shipped to users) |

## Installing as an app

A browser will offer **Install** when three things are true: the manifest loads, a
service worker is active, and the page is on a **secure context**.

- **On this computer:** `localhost` counts as secure, so install works directly from the URL above
  (Chrome/Edge: install icon in the address bar, or menu → *Install Hammer Selector*).
- **On a tablet (Android / Windows):** the tablet reaches this machine over the network by IP
  (e.g. `http://192.168.x.x:8731`), and plain `http://` over the network is **not** a secure
  context — the service worker won't register and install won't appear. To test on a tablet you
  need HTTPS. Easiest options:
  - Deploy the `frontend/` folder to a static host (GitHub Pages, Netlify, Cloudflare Pages) — all serve HTTPS free.
  - Or run a tunnel (`cloudflared tunnel --url http://localhost:8731` or `ngrok http 8731`) and open the HTTPS link it gives you on the tablet.

Once installed it launches in its own window (no browser chrome) and opens offline.

## Note on iOS
Not a target. iOS supports PWAs but with limitations; this project targets Android + Windows.
