# Veyra Orbit

A calm study browser: tabs down the side, Veyra's look, and (soon) your Veyra Study subjects,
tasks, notes and focus timer built in. Electron (Chromium) underneath.

The roadmap and known gaps are in [PLAN.md](PLAN.md).

## Run it from the code

Needs [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install
npm run dev     # live reload, with its own profile (%APPDATA%\veyra-orbit-local)
npm run build   # typecheck + production build
npm test        # address bar tests
```

`VEYRA_USERDATA=<folder>` runs it on a scratch profile, and `VEYRA_DOWNLOADS=<folder>` sends downloads somewhere other than your Downloads folder.
