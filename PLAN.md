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
| Google sign-in in embedded browsers | The user agent already looks like Chrome. Check early with a real sign-in. |
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
- [ ] Address bar suggestions (history, open tabs). Needs a floating layer above the page view.
- [ ] History
- [ ] Downloads panel (for now, Electron's own Save dialog)
- [ ] Bookmarks / saved pages
- [ ] Find in page (Ctrl+F)
- [ ] Settings page (search engine, theme)
- [ ] **Electron fuses, before the first installer anyone uses.** Turn on cookie encryption, turn off RunAsNode, NODE_OPTIONS and `--inspect`, and turn on only-load-from-asar and asar integrity. Without these, a packaged app stores cookies unencrypted on disk. Switching cookie encryption on later wipes existing sign-ins, so settle it before the first real build (electron-builder's fuse settings).
- [ ] Dev/Prod channels and auto-update, like Veyra Study, each with its own token
- [ ] Check Google sign-in, YouTube, Google Docs and Classroom

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
- `src/shared/url.ts`: address bar input to URL, allowed schemes (tested in `tests/url.test.ts`)
- `src/renderer/src`: the UI (React). The page view is placed over `.page` by the main process.
