# Veyra Orbit: plan

A calm study browser with a Zen-style layout (tabs down the side, workspaces, split view), built
on Electron (Chromium) in the Veyra design system, and joined up with Veyra Study.

**Engine: Electron.** Each tab is a sandboxed `WebContentsView`. That reuses the Veyra Study stack
(electron-vite, electron-builder, the updater, the design tokens). A real Chromium fork was ruled
out as team-sized work.

## Known gaps, compared with Zen or Chrome

These are planned for, not surprises:

| Gap | Plan |
|---|---|
| Chrome extensions | Partial support later (M3), through a community library. Some won't work. |
| Netflix and other DRM video | Needs a Widevine-enabled Electron build (M3). May be limited to lower quality. |
| Google sign-in in embedded browsers | Works via a narrow Firefox UA + stripped `Sec-CH-UA*` override on `accounts.google.com` only (see Site compatibility below). |
| Safe Browsing | None built in. Add a blocklist later. |
| Passwords and autofill | Build them (M3). Until then, use a password manager's desktop app. |
| Sync | Through the Veyra account, later. |
| Security fixes | Keep up with Electron releases. Each update needs a new browser release. |

## Security baseline (done in M0)

- Web pages are sandboxed and context-isolated, with no preload and no Node. They run in their own session (`persist:web`), apart from the browser UI.
- Only `http(s)` and `about:blank` can be opened or navigated to. That rules out `file:`, `javascript:`, `data:` and `chrome:`.
  - The one exception: `mailto:` links open the mail app. Today a page can do this without a click. A confirmation step is to do.
- Permissions are denied by default. Askable ones (camera, mic, notifications, location, ...) show a prompt. USB, HID and serial are always denied.
- Pages that ask to open a new tab get a tab. Real pop-ups (window.open with features, as used by "Sign in with ...") stay pop-ups.
- Bad certificates are refused, with a full-page explanation and no way to click through.
- The UI only listens to IPC from its own window and checks every argument. `<webview>` is blocked everywhere.

## Milestones

### M0: a working browser
- [x] Window with Veyra title bar, acrylic and light/dark
- [x] Vertical tabs, pinned tabs, drag to reorder, middle-click to close
- [x] Address bar: search or URL, short display, padlock / not-secure mark
- [x] Back, forward, reload, stop, zoom, devtools; Ctrl+T/W/L/R, Ctrl+Tab, Ctrl+1–9, Ctrl+Shift+T
- [x] Start page and error pages
- [x] Permission prompts
- [x] Right-click menu (links, images, selection, spelling)
- [x] Tabs restored on launch, loading only when opened
- [x] Address bar suggestions (searches, open tabs, bookmarks, history). The page is swapped for a snapshot while they're open.
- [x] History (orbit://history, Ctrl+H)
- [x] Downloads panel in the sidebar (Ctrl+J): pause, resume, cancel, open, show in folder. Programs and scripts are only ever shown in their folder.
- [x] Bookmarks (star, Ctrl+D, orbit://bookmarks)
- [x] Find in page (Ctrl+F, F3) and zoom indicator
- [x] Settings page, orbit://settings: search engine, theme, what opens at start, downloads folder, and clearing cookies, cache and site data
- [x] Remember permission answers per site, with a way to change them in Settings
- [x] Full screen video (the sidebar and toolbar hide), tab sound indicator and mute, tab right-click menu
- [x] Print (Ctrl+P) and the built-in PDF viewer
- [x] Ask before a page opens another app (mailto:, zoommtg:, ...)
- [x] Electron fuses: cookie encryption on, RunAsNode, NODE_OPTIONS and `--inspect` off, only-load-from-asar and asar integrity on (`build.electronFuses`). File-protocol privileges stay on until the UI moves to a custom protocol.
- [x] Dev/Prod channels and auto-update, like Veyra Study, each with its own token
- [x] Check Google sign-in, YouTube, Google Docs and Classroom

### M1: Zen-style layout in Veyra's look
- Workspaces, each with its own session partition and accent colour
- Split view (two or more pages side by side)
- Compact mode (sidebar and toolbar hide until you hover)
- Link preview pop-up ("peek")
- Ctrl+K command palette, following Veyra Study's `Palette.tsx`
- Floating layer for menus and the palette above pages

### M2: the study twist
- Workspaces are Veyra Study **Subjects**
- Ctrl+K searches tabs, history, **tasks and notes**
- **Save to note**: a page or selection goes into a Veyra note, with its link
- **Tasks panel** in the sidebar
- **Focus mode**: while the focus timer runs, distracting sites are blocked or softened
- **Study time per site** feeds into Stats

### M3: hardening
- Extensions, DRM, passwords and autofill, a Safe Browsing-style blocklist, and a steady update schedule

## Veyra Study changes this depends on

- **Focus timer state.** The running timer is only in Veyra Study's renderer (`components/timer.tsx`, localStorage). Add a read-only `focus_status` MCP tool, or something like it, before focus mode.
- **v1 link: the local MCP server.** It runs on `127.0.0.1:47821+`, with a bearer token in Veyra Study's `userData/mcp.json`. It needs `mcpEnabled`. Writes need `mcpAllowWrites`.
- **Later: account sign-in and sync.** The same Worker endpoints as `src/main/account.ts`. Nothing changes in `carrotsz19/veyra`.
- **Updates.** Never reuse Veyra Study's embedded dev updater token.

## Code map

- `src/main/index.ts`: window, IPC (checked), profile location
- `src/main/tabs.ts`: tabs, page events, shortcuts, right-click menu, session restore
- `src/main/security.ts`: permissions, user agent, global hardening
- `src/main/compat.ts`: Chrome client hints, `accounts.google.com` sign-in compatibility, WebAuthn conditional-mediation shim
- `src/main/updater.ts`: quiet background auto-updater (Dev and Prod feeds)
- `src/shared/url.ts`: address bar input to URL, allowed schemes (tested in `tests/url.test.ts`)
- `src/renderer/src`: the UI (React). The page view is placed over `.page` by the main process.

## Site compatibility

Tested in a scratch profile (`VEYRA_USERDATA` + `VEYRA_DOWNLOADS`) with no real account credentials:

- **Google sign-in (`accounts.google.com`, tabs and `window.open` popups):** Previously rejected after entering an email (`This browser or app may not be secure`, `rrk=46`), even after adding `"Google Chrome"` to `Sec-CH-UA*` headers and `navigator.userAgentData.brands`. Google's sign-in checks for proprietary Google Chrome signals whenever a browser advertises Chrome. Fixed narrowly by using a current desktop Firefox UA and stripping `Sec-CH-UA*` headers for `accounts.google.com` only (both HTTP headers in `webRequest.onBeforeSendHeaders` and `navigator.userAgent` via CDP), while keeping consistent Chrome UA + Client Hints (`Google Chrome`, `Chromium`, `Not)A;Brand`) for all other sites. Verified in both tabs and sign-in popups that `accounts.google.com` now proceeds past the email step normally.
- **Sign-in passkey auto-prompt (Google, Microsoft 365, GitHub):** Electron lacks WebAuthn conditional-UI autofill, so sign-in pages calling `navigator.credentials.get({ mediation: 'conditional' })` on load popped up a modal Windows Security dialog. Fixed via a tiny main-world script injected through `webContents.debugger` (`Page.addScriptToEvaluateOnNewDocument`) on tabs and popups that makes `PublicKeyCredential.isConditionalMediationAvailable()` resolve `false`, sets `conditionalGet`/`conditionalCreate` to `false` in `getClientCapabilities()`, and rejects conditional `credentials.get()` calls quietly with `NotAllowedError` while leaving explicit passkey clicks untouched. Verified DevTools (`openDevTools` / `closeDevTools`) coexists cleanly without detaching the debugger.
- **YouTube (`youtube.com`):** Loads cleanly; 60fps video plays (`readyState === 4`, playback time advances) and HTML5 full screen enters and exits cleanly without leaving the UI stuck.
- **Google Docs (`docs.google.com`) & Google Classroom (`classroom.google.com`):** Landing and sign-in redirects load cleanly with no unsupported-browser warnings (redirecting to `accounts.google.com` automatically switches to the Google auth compatibility rule).
- **Wikipedia, GitHub (`/login`), Khan Academy, Quizlet, Microsoft 365 (`login.microsoftonline.com`):** All load cleanly with consistent Chrome UA + Client Hints, no unsupported-browser banners, and no unexpected Windows Security prompts.
- **Not tested:** Full interactive login flows with real user accounts (Google, Microsoft, GitHub, Quizlet, Khan Academy), real Windows Hello explicit passkey sign-in, and DRM-protected streaming (still planned for M3).
