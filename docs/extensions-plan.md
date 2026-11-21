# Veyra Orbit — Chrome Extension Support: Verified Research & Implementation Plan

**Target runtime:** Electron `45.3.0` (Chromium `156.0.8078.96`)  
**Research workspace & test harness:** `%TEMP%\orbit-ext-research`  
**Status legend:** Every technical claim below is explicitly tagged **[VERIFIED]** (empirically executed and observed in the Electron 45.3.0 throwaway test app) or **[UNVERIFIED]** (code-inspected, documented, or inferred without end-to-end execution).

---

## 1. Recommended Libraries & Versions

| Package | Recommended Version | License | Unpacked Size | Maintenance | Dependencies | Role in Orbit |
|---|---|---|---|---|---|---|
| `electron-chrome-extensions` | `4.10.0` | MIT | 301 KB | Active (published Oct 25, 2026; tracks Electron ≥35) | `debug` | Main-process & preload bridge for `chrome.action`, `chrome.tabs`, `chrome.windows`, `chrome.contextMenus`, `chrome.cookies`, `chrome.webNavigation`, `chrome.notifications`, `chrome.commands`, `chrome.runtime.connectNative`/`openOptionsPage`, `<browser-action-list>`, `PopupView` |
| `electron-chrome-web-store` | `0.13.0` | MIT | 113 KB | Maintained by same author (`samuelmaddock/electron-browser-shell`; published Jul 2, 2025) | `adm-zip`, `pbf`, `debug`, `@types/chrome` | Programmatic CWS install (`installExtension`), `https://chromewebstore.google.com` integration (`installChromeWebStore`), CRX3 unpacking, Omaha v3.1 background auto-updater (`updateExtensions`) |

### Electron 45.3.0 Native `session.extensions` API vs. `electron-chrome-extensions@4.10.0`

| API / Capability | Plain Electron 45.3.0 (`session.extensions`) | + `electron-chrome-extensions@4.10.0` | + Orbit `orbit-ext-compat.preload.js` | Status |
|---|---|---|---|---|
| `chrome.runtime`, `chrome.storage` (`local`, `session`, `sync`), `chrome.alarms`, `chrome.scripting`, `chrome.declarativeNetRequest`, `chrome.permissions`, `chrome.i18n`, `chrome.management`, `chrome.dom`, `chrome.extension` | Native | Native (plus `storage.managed`/`sync` fallback to `local`, `runtime.openOptionsPage`, `runtime.connectNative`/`sendNativeMessage`) | Mirrored to `globalThis.browser` | **[VERIFIED]** |
| `chrome.action` (toolbar icon, badge, popup window) | Basic stub (no UI/popup) | Full (`BrowserActionAPI`, `PopupView`, `crx://` icons, `<browser-action-list>`) | Mirrored to `globalThis.browser` | **[VERIFIED]** |
| `chrome.tabs`, `chrome.windows` | Minimal `tabs` stub (no window/tab model) | Mapped to Orbit's `WebContents`/`BrowserWindow` via `addTab`/`selectTab`/`removeTab` & hooks | Mirrored to `globalThis.browser` | **[VERIFIED]** |
| `chrome.contextMenus`, `chrome.cookies`, `chrome.webNavigation`, `chrome.notifications`, `chrome.commands` (`getAll`/`onCommand` stub) | Missing (`undefined`) | Implemented (note: `commands` has no OS hotkey dispatcher yet; `cookies` lacks permission check — see §4) | Mirrored to `globalThis.browser` | **[VERIFIED]** |
| `chrome.downloads`, `chrome.privacy`, `chrome.topSites` | Missing | No-op stubs (prevents crashes) | Mirrored to `globalThis.browser` | **[VERIFIED]** |
| `chrome.offscreen` | Missing (`undefined`) | Missing (`undefined`) | Missing (`undefined`) | **[VERIFIED]** |
| `chrome.sidePanel` | Missing (`undefined`) | Missing (`undefined`) | Missing (`undefined`) | **[VERIFIED]** |
| `chrome.identity` | Missing (`undefined`) | Missing (`undefined`) | Missing (`undefined`) | **[VERIFIED]** |
| `chrome.webRequest` (blocking/observing) | Blocked if `session.webRequest` is used | `onHeadersReceived` stub only (`onBeforeRequest` is `undefined`) | Same | **[VERIFIED]** |
| Non-persistent (in-memory) sessions | Unsupported (`loadExtension` throws) | Unsupported | Unsupported (Orbit uses `persist:*`) | **[UNVERIFIED]** (Electron 45 `electron.d.ts:8945` & README) |

### Alternatives Considered
1. **Raw Electron `session.extensions` only:** Insufficient — lacks `chrome.windows`, `chrome.tabs` window/tab mapping, action popups/badges, `chrome.contextMenus`, `chrome.webNavigation`, and CWS installation. **[VERIFIED]**
2. **Forking / vendoring `electron-chrome-extensions`:** Not needed upfront; `4.10.0` works on Electron 45.3.0 with two tiny, clean Orbit-side additions (the 30-line `browser`-mirror preload and 5-line `CookiesAPI` router hardening). If Orbit later needs `chrome.commands` shortcut dispatch or deeper `PopupView` customization without upstream PRs, `patch-package` or a thin fork is low-cost (~300 KB). **[VERIFIED]**
3. **Custom CWS downloader instead of `electron-chrome-web-store`:** `electron-chrome-web-store@0.13.0` works out of the box for `installExtension`, `https://chromewebstore.google.com`, and `updateExtensions`, **but** has three security/UX rough edges (no cryptographic CRX3 signature verification, loose `startsWith` origin check, macOS UA overwrite on CWS pages — see §4). Wrap or patch it rather than rewriting Omaha + CRX3 parsing from scratch. **[VERIFIED]**

---

## 2. Verified Findings from the Electron 45.3.0 Test App

All test scripts and raw JSON logs are kept in `%TEMP%\orbit-ext-research`:
- `test-core.js` → `result-core.json` (synthetic MV3 ext + no-perm ext + sandboxed `WebContentsView` + CDP + `<browser-action-list>` + `PopupView`)
- `test-sw-diag.js` → `diag-{plain,with-ece,with-ece-and-wr}.{out,err}` (MV3 service worker boot diagnostics)
- `test-real-extensions.js` → `result-real.json`, `test-real.err.log` (real uBlock Origin Lite `2026.1116.1650` + Bitwarden `2026.11.0` + Chrome Web Store + Omaha update check)
- `test-dnr.js` → `result-dnr-{no-wr,wr-all,wr-google-only,wr-response-only,ece-no-wr}.json` (5-mode DNR vs. `session.webRequest` matrix)
- `test-dnr-cdp.js` → `result-dnr-cdp.json` (CDP `Emulation.setUserAgentOverride` vs. redirects)
- `test-dnr-compat.js` → `result-dnr-compat.json` (built-in DNR `modifyHeaders` compat extension alongside uBlock Origin Lite)
- `test-wr-clear.js` → `result-wr-clear.json` (`onBeforeSendHeaders(null)` restoration, compat extension memory cost, `CookiesAPI` router hardening)
- `test-memory.js` → `result-memory.json` (multi-partition memory & `chrome.storage.local` isolation benchmark)

### Critical Discovery 1 — uBlock Origin Lite Service Worker Crash (`Status code: 15`) on Electron 45 & Exact Fix **[VERIFIED]**
- **Symptom:** Loading real uBlock Origin Lite `2026.1116.1650` (`ddkjiahejlhfcafbddmgiahcphecmpfh`) with stock `electron-chrome-extensions@4.10.0` on Electron 45.3.0 fails SW registration immediately:
  ```text
  Source:  chrome-extension://ddkjiahejlhfcafbddmgiahcphecmpfh/js/background.js (Line 897)
  Message: Uncaught TypeError: Cannot read properties of undefined (reading 'onCommand')
  Message: Service worker registration failed. Status code: 15
  ```
- **Root cause:** Chromium 156 (Electron 45) natively exposes `globalThis.browser` as a **distinct object** from `globalThis.chrome` inside extension contexts. `electron-chrome-extensions@4.10.0`'s preload (`dist/chrome-extension-api.preload.js:104,563`) only patches `globalThis.chrome` and never touches `globalThis.browser`. uBlock Origin Lite (`js/ext-compat.js:24`) does `export const webext = self.browser || self.chrome;`. On older Chromium where `self.browser` was `undefined`, it fell back to the patched `chrome`; on Electron 45, `self.browser` exists natively, lacks `commands` (and `tabs`/`windows`/`contextMenus`/`cookies`/`webNavigation`/`notifications`), and crashes at `browser.commands.onCommand.addListener(...)`.
- **Verified workaround (`orbit-ext-compat.preload.js`):** Register a 30-line companion preload script on every extension-enabled session (for both `type: 'frame'` and `type: 'service-worker'`) **after** `new ElectronChromeExtensions({ session })`. For `process.type === 'service-worker'` or `location.href.startsWith('chrome-extension://')`, it copies all 18 polyfilled APIs (`action`, `browserAction`, `commands`, `contextMenus`, `cookies`, `downloads`, `extension`, `i18n`, `notifications`, `permissions`, `privacy`, `runtime`, `storage`, `tabs`, `topSites`, `webNavigation`, `webRequest`, `windows`) from `globalThis.chrome` onto `globalThis.browser`.
- **Result after workaround:** uBOL `2026.1116.1650` SW starts with **zero errors**, loads all 6 default static rulesets + 183 dynamic rules, renders its 273×375 popup (`popup.html`) and `dashboard.html` cleanly, and blocks/redirects real ad/tracker requests. **[VERIFIED]**

### Critical Discovery 2 — `session.webRequest.*` Silently Disables ALL `declarativeNetRequest` (DNR) Blocking **[VERIFIED]**
- **Test matrix (`test-dnr.js`):**

| Mode | `session.webRequest` listener attached | uBOL static rulesets enabled | Dynamic DNR rule blocked `/blocked-dynamic.js`? | Real ad/tracker requests blocked? |
|---|---|---|---|---|
| `no-wr` | None | `[]` (no `browser` shim) | **YES** (`net::ERR_BLOCKED_BY_CLIENT`) | N/A |
| `ece-no-wr` | None (+ `orbit-ext-compat.preload.js`) | 6 (`ublock-filters`, `easylist`, `easyprivacy`, `pgl`, `ublock-badware`, `urlhaus-full`) + 183 dynamic | **YES** (`net::ERR_BLOCKED_BY_CLIENT`) | **YES** |
| `wr-all` | `onBeforeSendHeaders(fn)` (Orbit's current `compat.ts`) | N/A | **NO — bypassed** | **NO** |
| `wr-google-only` | `onBeforeSendHeaders({ urls: ['https://accounts.google.com/*'] }, fn)` | N/A | **NO — bypassed even for non-matching URLs** (`wrCalls: 0`!) | **NO** |
| `wr-response-only` | `onHeadersReceived(fn)` | N/A | **NO — bypassed** | **NO** |
| `wr-cleared` (`test-wr-clear.js`) | `onBeforeSendHeaders(fn)` then `onBeforeSendHeaders(null)` | N/A | **YES — restored!** (`dynBlocked: true`) | **YES** |

- **Why:** In Electron, attaching *any* `session.webRequest` listener (even with a narrow URL filter or on a different event) switches the session's `URLLoaderFactory` to Electron's proxy, bypassing Chromium's `extensions::WebRequestAPI` factory that evaluates `declarativeNetRequest`.
- **Why CDP alone is insufficient (`test-dnr-cdp.js`):** Switching `Emulation.setUserAgentOverride` in `will-redirect` races with HTTP 302 redirects (the redirected request still carried Chrome's `User-Agent` on the wire). **[VERIFIED]**
- **VERIFIED Solution — Internal Built-In DNR `modifyHeaders` Extension (`test-dnr-compat.js`):**
  - When a session has **0 enabled user extensions**, keep Orbit's existing zero-overhead `attachSessionCompat(sess)` (`sess.webRequest.onBeforeSendHeaders`).
  - As soon as a session has **≥1 enabled user extension**, call `sess.webRequest.onBeforeSendHeaders(null)` (verified to restore DNR!) and load a tiny generated MV3 internal extension from `path.join(app.getPath('userData'), 'internal-extensions', 'orbit-compat')` (works under `onlyLoadAppFromAsar: true`, has no `action` so `compatAppearsInToolbar: false`, and stays hidden from Settings → Extensions).
  - Its 2 dynamic DNR `modifyHeaders` rules:
    - Priority 1 (`urlFilter: "*"`): set `Sec-CH-UA` and `Sec-CH-UA-Full-Version-List` to `chromeIdentity()`.
    - Priority 2 (`urlFilter: "||accounts.google.com/"`): set `User-Agent` to `chromeIdentity().firefoxUserAgent` and remove `Sec-CH-UA`, `Sec-CH-UA-Mobile`, `Sec-CH-UA-Platform`, `Sec-CH-UA-Full-Version-List`, `Sec-CH-UA-Arch`, `Sec-CH-UA-Bitness`, `Sec-CH-UA-Model`.
  - **Verified in `test-dnr-compat.js`:**
    - Normal requests on `localhost` received the rewritten `Sec-CH-UA` header.
    - 302 redirect target received the Firefox `User-Agent` and `Sec-CH-UA*` headers were all stripped (`null`).
    - Simultaneously, uBlock Origin Lite blocked `https://doubleclick.net/pixel.js` (`net::ERR_BLOCKED_BY_CLIENT`) and redirected `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js` and `https://www.google-analytics.com/analytics.js` to its `web_accessible_resources` noop surrogates!
  - **Cost of `orbit-compat`:** +1 SW process, **+27.2 MB private / +82.6 MB working set** (`result-wr-clear.json`), incurred **only** on sessions with ≥1 enabled extension. **[VERIFIED]**

### Critical Discovery 3 — MV3 Service Worker Registration Race & Per-Tab CDP Coexistence **[VERIFIED]**
- **SW race (`test-core.js` vs `test-sw-diag.js`):** Calling `sess.serviceWorkers.startWorkerForScope(...)` immediately after `sess.extensions.loadExtension(...)` races with Chromium's automatic MV3 worker registration and throws `Failed to start service worker. (Status code: 2)`. Electron 45 auto-starts MV3 SWs upon `loadExtension()`. Do **not** call `startWorkerForScope` immediately after `loadExtension` (or catch & ignore errors if waking an idle worker later). **[VERIFIED]**
- **Per-tab `webContents.debugger` CDP compatibility (`test-core.js`):** Orbit's `attachPageCompat(wc)` (`dbg.attach('1.3')`, `Emulation.setUserAgentOverride`, `Page.addScriptToEvaluateOnNewDocument`) stayed attached (`cdpStillAttached: true`, `cdpShim: true`) while content scripts injected, `chrome.scripting.executeScript` executed, and extension popups ran. Keep `dbg.sendCommand(...)` fire-and-forget before `loadURL` (awaiting before `loadURL` deadlocks). **[VERIFIED]**
- **Sandboxed `WebContentsView` with no preload (`test-core.js`):** Content scripts injected cleanly (`contentScriptInjected: "injected-ok"`), round-tripped `chrome.runtime.sendMessage` to the MV3 SW (`contentScriptReply` received `tabId` and `url`), and exposed zero preload globals to web pages (`hasElectronGlobal: false`, `hasChromeRuntimeInPage: false`). **[VERIFIED]**
- **Sandboxed UI preload bundling (`test-core.js`):** `injectBrowserAction()` cannot be `require()`d unbundled inside a `sandbox: true` preload; it must be bundled (Orbit's `electron-vite` already bundles `src/preload/index.ts` and `src/preload/compact.ts`). **[VERIFIED]**

---

## 3. Real Extension Verification: uBlock Origin Lite & Bitwarden

### uBlock Origin Lite `2026.1116.1650` (`ddkjiahejlhfcafbddmgiahcphecmpfh`)
- **Works [VERIFIED]:**
  - Downloads & unpacks cleanly via `electron-chrome-web-store` (`installExtension`).
  - With `orbit-ext-compat.preload.js` and without `session.webRequest`, SW starts with zero errors, enables all 6 default static rulesets (`ublock-filters`, `easylist`, `easyprivacy`, `pgl`, `ublock-badware`, `urlhaus-full`) + 183 dynamic rules.
  - Real network ad/tracker blocking (`doubleclick.net` → `net::ERR_BLOCKED_BY_CLIENT`) and surrogate script redirection (`adsbygoogle.js`, `google-analytics.com/analytics.js` → `web_accessible_resources/*`).
  - Toolbar icon (`crx://`) + popup (`popup.html`, 273×375) renders filtering mode slider ("optimal"), site hostname, and controls.
  - Options/dashboard page (`dashboard.html`) loads cleanly with zero console errors.
- **Does not work / limitations:**
  - `chrome.offscreen` (`undefined` **[VERIFIED]**): uBOL declares `"offscreen"` (used for certain cosmetic/parsing helpers); SW booted cleanly without it, though edge features relying on offscreen documents will degrade. **[UNVERIFIED]** for element picker/zapper interactive flows.
  - `chrome.commands` hotkeys (`enter-picker-mode`, `enter-zapper-mode`): `electron-chrome-extensions@4.10.0` registers `commands.onCommand` so uBOL doesn't crash, but does not dispatch keyboard shortcuts. **[VERIFIED]** (code inspection of `commands.ts`).
  - `chrome.userScripts`: uBOL checks `supportsUserScripts()` gracefully and skips if unavailable. **[VERIFIED]**

### Bitwarden Password Manager `2026.11.0` (`nngceckbapebfimnlniiiahkandclblb`)
- **Works [VERIFIED]:**
  - Downloads & unpacks cleanly via `electron-chrome-web-store`.
  - MV3 service worker boots and loads Bitwarden's Rust WASM SDK (`WASM SDK loaded in 94ms`), tracks tab navigation (`webNavigation.onCommitted`, `tabs.onUpdated`, `tabs.get`), and updates its toolbar icon/badge (`browserAction.setIcon`, `setBadgeText`, `setBadgeBackgroundColor`).
  - Toolbar popup (`popup/index.html#/intro-carousel`, 480×600) renders cleanly (`WASM SDK loaded in 81ms`, "Create account" / "Log in" buttons).
  - `chrome.storage.local` & `chrome.storage.session` work and persist within the partition.
  - `chrome.runtime.connectNative` / `sendNativeMessage` IS implemented by `electron-chrome-extensions@4.10.0` (reads Windows registry `HKLM/HKCU\Software\Google\Chrome\NativeMessagingHosts\<app>`). **[UNVERIFIED]** end-to-end with the Bitwarden Desktop app installed.
- **Does not work / limitations:**
  - `chrome.sidePanel` (`undefined` **[VERIFIED]**): Bitwarden declares `"sidePanel"`; Electron logs `Permission 'sidePanel' is unknown`. Opening Bitwarden in a side panel will not work (popup and popped-out tab/window work instead).
  - `chrome.offscreen` (`undefined` **[VERIFIED]**): Bitwarden declares `"offscreen"` (used in MV3 for clipboard clearing & certain background DOM/crypto tasks) and logs benign `Could not establish connection. Receiving end does not exist.` warnings on startup; logged-out boot and popup UI still succeed, but **auto-clear clipboard after timeout** and any offscreen-dependent helper may fail. **[UNVERIFIED]** with a real logged-in vault.
  - `chrome.webRequest` / `webRequestAuthProvider` (`undefined` **[VERIFIED]**): HTTP Basic Auth autofill interception won't fire.
  - `chrome.commands` shortcuts (`Ctrl+Shift+Y`, `Ctrl+Shift+L`, `Ctrl+Shift+9`): not dispatched by `electron-chrome-extensions@4.10.0`. **[VERIFIED]**
  - Full logged-in Bitwarden vault unlock + inline autofill overlay (`overlay/menu-button.html`, `overlay/menu-list.html` sandboxed frames) + WebAuthn/passkey (`content/fido2-page-script.js`) was **not** tested with real credentials (**[UNVERIFIED]** — note Bitwarden logged `"Autofill monitoring disabled; the active account is logged out."` confirming its content-script pipeline connected to the SW).
  - `NOTREACHED hit. Unexpected view type found: 0` logged once in Chromium stderr when opening Bitwarden popup (non-fatal; popup still rendered cleanly). **[VERIFIED]**

### Chrome Web Store (`electron-chrome-web-store@0.13.0`)
- **Works [VERIFIED]:**
  - Navigating to `https://chromewebstore.google.com/detail/ublock-origin-lite/ddkjiahejlhfcafbddmgiahcphecmpfh` injects `chrome.webstorePrivate` (`hasWebstorePrivate: true`), reports installed extensions via `chrome.management.getAll`, and renders "Remove from Electron" / "Add to Veyra Orbit".
  - `updateExtensions(sess)` succeeds against Google's Omaha v3.1 JSON endpoint (`https://update.googleapis.com/service/update2/json`) (`updateCheckOk: true`).
- **Caveats [VERIFIED]:**
  - `chrome-web-store.preload.js:78-86` overwrites `navigator.userAgent` to macOS (`Macintosh; Intel Mac OS X 10_15_7`) on `chromewebstore.google.com`. Harmless for CWS browsing, but differs from Orbit's Windows Chrome identity.
  - Clicking "Add to Veyra Orbit" interactively inside the CWS DOM was **not** automated (**[UNVERIFIED]**; programmatic `installExtension()` + `beforeInstall` hook code path was verified).

---

## 4. Security Findings & Required Hardening Rules

### Verified Vulnerabilities Found in Testing & Exact Fixes

1. **`CookiesAPI` Missing Permission Check — Arbitrary Cookie Theft [VERIFIED]**
   - **Finding:** In `electron-chrome-extensions@4.10.0` (`dist/cjs/index.js:2026-2030`), `cookies.get`, `cookies.getAll`, `cookies.set`, `cookies.remove`, and `cookies.getAllCookieStores` are registered **without** `{ permission: 'cookies' }` and without host-permission checks. In `test-core.js`, `ext-noperm` (manifest `"permissions": []`, no `host_permissions`) successfully read `orbit_secret_cookie` (`"cookiesLeaked": 1, "cookieNames": ["orbit_secret_cookie"]`).
   - **Fix in Orbit [VERIFIED in `test-wr-clear.js`]:** Immediately after constructing `new ElectronChromeExtensions(...)`, patch `ece.ctx.router.handlers`:
     - Set `h.permission = 'cookies'` on all 5 `cookies.*` handlers (verified: `ext-noperm` was immediately blocked).
     - Wrap each handler's `callback` to also verify the extension has matching `host_permissions` for the target cookie domain/URL (`<all_urls>` or matching host pattern), filtering `cookies.getAll` results to only permitted hosts.

2. **`chrome.tabs.create` / `chrome.tabs.update` / `chrome.windows.create` Scheme Bypass (`file:`, `data:`, `orbit:`) [VERIFIED]**
   - **Finding:** `electron-chrome-extensions`'s `validateExtensionUrl` (`dist/cjs/index.js:63-73`) only rejects `chrome:` and `javascript:`. In `test-core.js`, `ext-noperm` called `chrome.tabs.create({ url: 'file:///C:/Windows/win.ini' })` and it passed straight through to our `createTab` callback.
   - **Fix in Orbit [VERIFIED]:** Enforce Orbit's own allowlist inside `createTab`, `createWindow`, and (via wrapping `tabs.update` handler) `chrome.tabs.update`:
     - Allow ONLY `http:`, `https:`, `about:blank`, or `chrome-extension://<id>/...` where `<id>` is a currently loaded extension in that session.
     - Explicitly reject `file:`, `data:`, `javascript:`, `orbit:`, `chrome:`, and external app schemes.

3. **No Cryptographic CRX3 Signature Verification in `electron-chrome-web-store@0.13.0` [VERIFIED by code inspection]**
   - **Finding:** `parseCrx()` (`dist/cjs/browser/index.js:1010-1050`) parses the CRX3 protobuf header and checks that `sha256(public_key)` matches `expectedExtensionId`, but **never verifies the RSA/ECDSA signature** over `signed_header_data` + ZIP archive (relying solely on HTTPS to `clients2.google.com`).
   - **Fix in Orbit:** Before calling `loadExtension()`, either wrap `downloadExtension` with a CRX3 verifier using Node's `crypto.createVerify('RSA-SHA256')` over `"CRX3 SignedData\0" + uint32LE(signedHeaderData.length) + signedHeaderData + zipBytes` against `keyProof.public_key` & `keyProof.signature`, and enforce Zip-Slip path traversal checks before extracting. **[UNVERIFIED]** (not yet implemented in test app).

4. **Loose Chrome Web Store Origin Check [VERIFIED by code inspection]**
   - **Finding:** `electron-chrome-web-store` (`dist/cjs/browser/index.js:1278`) validates IPC with `senderOrigin.startsWith("https://chromewebstore.google.com")`, which would match `https://chromewebstore.google.com.attacker.test`.
   - **Fix in Orbit:** Patch or guard via `web-contents-created` / `patch-package` to require exact origin equality `senderOrigin === 'https://chromewebstore.google.com'`, and only register the CWS preload/API when the user hasn't disabled CWS installs.

5. **Session & UI Isolation [VERIFIED]**
   - Orbit's main `BrowserWindow`, `MenuPopup`, and `CompactPanel` run in `session.defaultSession`.
   - Web tabs run in `persist:web` or `persist:ws-<id>`.
   - **Verified in `test-core.js`:** Extensions loaded into `persist:web` **cannot** inject content scripts into Orbit's UI window (`contentScriptLeakedToUi: null`), **cannot** read `defaultSession` cookies (`ui_only_cookie` did not leak), and **cannot** access `orbit://settings`, `orbit://history`, or `orbit://bookmarks` (since those are rendered inside Orbit's main UI `BrowserWindow`, not inside a web `WebContentsView`).
   - **Verified in `test-memory.js`:** `chrome.storage.local` is strictly isolated per partition (`persist:web` vs `persist:ws-1`: `isolated: true`).
   - **Rule:** NEVER load extensions into `session.defaultSession`, NEVER pass `win.webContents` or any `FloatingWindow.webContents` to `extensions.addTab()`, and NEVER call `attachSessionCompat` or `ElectronChromeExtensions` on `session.defaultSession` (only call `ElectronChromeExtensions.handleCRXProtocol(session.defaultSession)` if using `<browser-action-list>`, or avoid `crx://` altogether by serving icons through Orbit's own `fromUi`-gated IPC!).

6. **IPC Surface Hardening (`crx-msg-remote`) & Native Messaging & Permissions**
   - **`crx-msg-remote`:** `electron-chrome-extensions` registers `ipcMain.handle('crx-msg-remote', ...)` with `allowRemote: true, extensionContext: false`. Regular web pages have no preload so they can't reach it, and `chrome-extension://` preloads only call `crx-msg`. Still, prefer driving Orbit's TitleBar buttons through Orbit's own `fromUi(e)`-checked IPC (calling `extensions.api.browserAction` in the main process) so `injectBrowserAction()` / `crx-msg-remote` isn't even needed in renderers. **[UNVERIFIED]**
   - **Native Messaging:** `electron-chrome-extensions` exposes `runtime.connectNative` / `sendNativeMessage` to any extension declaring `"nativeMessaging"` (spawning local binaries registered in Windows Chrome registry keys). Disable by default in Orbit by wrapping `runtime.connectNative` / `runtime.sendNativeMessage` handlers in `ece.ctx.router.handlers` unless the user explicitly enables "Allow native messaging (for desktop apps like Bitwarden biometrics)" for that extension in Settings. **[UNVERIFIED]**
   - **Site Permissions (`src/main/security.ts`):** `normalizePermissionOrigin()` currently returns `''` for `chrome-extension://` URLs, denying all permissions in extension popups/pages (except `ALWAYS`: `fullscreen`, `clipboard-sanitized-write`, `pointerLock`). For loaded extensions in `sess.extensions`, allow `clipboard-read` / `notifications` **only** when the requesting `chrome-extension://<id>` matches a loaded extension whose manifest explicitly declares `clipboardRead` / `notifications`. Keep `setDevicePermissionHandler(() => false)` (USB/HID/serial stay denied). **[UNVERIFIED]**
   - **Install Policy & Prompts:**
     - **Default:** Chrome Web Store installs only (`allowUnpackedExtensions: false`, `minimumManifestVersion: 3`).
     - **Install prompt (`beforeInstall`):** Must display an Orbit confirmation dialog/modal showing extension name, icon, ID, version, and plain-English translations of every requested `permissions` + `host_permissions` (highlighting `<all_urls>`, `cookies`, `tabs`, `scripting`, `declarativeNetRequest`, `nativeMessaging`) before returning `{ action: 'allow' }`.
     - **Unpacked extensions (Developer mode):** Behind an explicit "Developer mode" switch in Settings → Extensions (off by default), with a warning banner; loaded unpacked paths persisted in `extensions.json` and only loaded when Developer mode is on.

---

## 5. Memory & Performance Measurements [VERIFIED]

Measured in `test-memory.js` (`result-memory.json`) and `test-wr-clear.js` (`result-wr-clear.json`) on Windows x64, Electron `45.3.0`, via `app.getAppMetrics()`:

| Configuration | Processes | Total Working Set (MB) | Total Private Bytes (MB) | Incremental Delta (Private) | Notes |
|---|---:|---:|---:|---:|---|
| 1. Baseline (UI + 1 blank tab in `persist:web`, 0 ext) | 5 | 391.3 | 176.6 | — | Browser 40.4 + GPU 79.2 + Util 12.5 + 2 Renderers 44.6 |
| 1b. + `orbit-compat` DNR ext only (`test-wr-clear.js`) | +1 | +82.6 | +27.2 | +27.2 MB | Only loaded when ≥1 user extension is enabled |
| 2. + uBlock Origin Lite `2026.1116.1650` (1 session) | 6 | 552.6 | 275.4 | **+98.8 MB** | +33.4 MB in Browser (56 DNR rulesets) + 65.1 MB SW renderer |
| 3. + Bitwarden `2026.11.0` (1 session, both loaded) | 7 | 723.8 | 386.4 | **+111.0 MB** | +109.8 MB SW renderer (Rust WASM SDK) |
| 4a. Bitwarden popup open (480×600) | 7 | 723.8 | 386.2 | ~0 MB extra | Shares Bitwarden's existing extension renderer process! |
| 4b. Bitwarden popup closed | 7 | 722.2 | 384.3 | -1.9 MB | Releases cleanly |
| 5. 2 sessions (`persist:web` + `persist:ws-1`), both ext in each | 10 | 1,141.1 | 611.5 | **+225.1 MB / session** | +3 processes (1 tab + 2 ext SWs) + Browser DNR copy (+27.8 MB) |
| 6. 4 sessions (`persist:web` + `ws-1..3`), both ext in all 4 | 16 | 1,978.2 | 1,056.2 | **+222.4 MB / session** | Strictly linear scaling — **~1 GB private / ~2 GB WS** for 4 isolated workspaces! |

### Multi-Partition Strategy (Required to Keep Orbit Light)
Because Electron loads extensions **per `Session` partition** (and `chrome.storage.local` is isolated per partition **[VERIFIED]**):
1. **Shared workspaces (`isolated: false`) share `persist:web`** → 0 extra extension memory regardless of how many non-isolated workspaces exist.
2. **Isolated workspaces (`persist:ws-<id>`):**
   - **Lazy session activation:** Do NOT eagerly call `setupWebSession('persist:ws-<id>')` or load extensions for isolated workspaces at startup; load them only when the user actually switches to / loads a tab in that isolated workspace.
   - **Opt-in / configurable extension scope for isolated workspaces:** Default to loading enabled extensions into `persist:web` + the active isolated workspace on demand, with a per-extension or per-workspace setting ("Run in isolated workspaces") and unloading extensions from idle isolated workspaces if all their tabs are closed/slept (optional M3.1 optimization).
   - **Live per-extension memory readout in Settings → Extensions:** Correlate `sess.serviceWorkers.getAllRunning()` (`renderProcessId` + `scope` → `extensionId`) with `app.getAppMetrics()` (`pid` / `privateBytes` / `workingSetSize`) to show exact MB per extension (note: `renderProcessId` vs OS `pid` mapping via `webContents.getOSProcessId()` or `app.getAppMetrics()` should be verified during implementation **[UNVERIFIED]**).

---

## 6. Integration Design Mapped to Veyra Orbit's Actual Files

### 6.1 New Files
1. **`src/shared/extensions.ts`** (pure, unit-tested)
   - Types: `ExtensionSummary` (`id`, `name`, `version`, `description`, `enabled`, `pinned`, `source: 'webstore' | 'unpacked'`, `permissions`, `hostPermissions`, `optionsUrl`, `iconDataUrl`, `memoryMB`, `error`), `ExtensionActionView` (`id`, `title`, `badgeText`, `badgeColor`, `iconDataUrl`, `hasPopup`), `ExtensionInstallPrompt` (`requestId`, `id`, `name`, `version`, `iconDataUrl`, `permissions`, `hostPermissions`, `warnings`), `ExtensionsState`.
   - Pure helpers: `isAllowedExtensionTabUrl(url, loadedIds)`, `describeManifestPermissions(manifest)` (human-readable risk labels for install prompt & Settings), `validateExtensionId(id)` (`/^[a-p]{32}$/`), `filterCookiesByHostPermissions(cookies, hostPermissions)`.
2. **`src/preload/ext-compat.ts`** (built as a standalone entry in `electron.vite.config.ts` → `out/preload/ext-compat.js`)
   - The verified 30-line `globalThis.browser` ← `globalThis.chrome` mirror preload for Electron 45+ (`service-worker` and `chrome-extension://` frames only; no-op on `http(s):` pages).
3. **`src/main/extensions.ts`** (`ExtensionManager`)
   - Owns persistent registry at `join(app.getPath('userData'), 'extensions.json')` (installed IDs, enabled state, pinned-to-toolbar order, developer mode flag, unpacked directories, native-messaging opt-in per ID).
   - Stores CWS extensions on disk once at `join(app.getPath('userData'), 'Extensions')`.
   - Maintains `Map<Session, { partition: string; ece: ElectronChromeExtensions; loadedIds: Set<string>; compatExtId: string | null }>`.
   - `attachSession(partition: string, sess: Session)`:
     - Only attaches `ElectronChromeExtensions` + `ext-compat.js` + hardened `CookiesAPI` + `orbit-compat` DNR extension (after `detachSessionCompat(sess)`) when ≥1 user extension is enabled (or on-demand when the first extension is installed).
     - Wires `createTab`, `selectTab`, `removeTab`, `assignTabDetails`, `createWindow`, `removeWindow`, `requestPermissions` to `Tabs`.
     - Subscribes to `ece.on('browser-action-popup-created', popup => ...)` (see §6.5).
     - Registers `installChromeWebStore({ session: sess, extensionsPath, loadExtensions: false, autoUpdate: false, minimumManifestVersion: 3, beforeInstall })` (Orbit drives loading across sessions and runs a single deduplicated `updateExtensions` timer across `persist:web` rather than one updater per workspace!).
   - Exposes `list()`, `toolbarActions(partition, tabWcId)`, `activateAction(partition, extId, tabWcId, anchorRect)`, `setEnabled(id, enabled)`, `setPinned(id, pinned)`, `installFromStore(id)`, `loadUnpacked(dir)`, `uninstall(id)`, `checkUpdates()`, `openOptions(id)`, `getContextMenuItems(wc, params)`, `hasLoadedExtension(sess, id)`.
   - Generates `userData/internal-extensions/orbit-compat/{manifest.json,bg.js}` from `chromeIdentity()` whenever Chrome version/platform changes, and hides `compatExtId` from `list()` and `toolbarActions()`.

### 6.2 `src/main/compat.ts`
- Add `detachSessionCompat(sess: Session): void`:
  ```ts
  export function detachSessionCompat(sess: Session): void {
    if (!attachedCompatSessions.has(sess)) return
    sess.webRequest.onBeforeSendHeaders(null)
    attachedCompatSessions.delete(sess)
  }
  ```
- Export `chromeIdentity()` (already exported) for `src/main/extensions.ts` to bake into `orbit-compat`'s DNR rules.
- Keep `attachPageCompat(wc)` unchanged (verified compatible with extensions & content scripts).

### 6.3 `src/main/index.ts`
- Instantiate `extManager = new ExtensionManager(w, t, ...)` after `tabs` and `perms` are created.
- In `setupWebSession(partition)`:
  - Keep `perms.attach(sess)`, `d.attach(sess)`, `sess.on('will-download', onDownload)`.
  - If `extManager.hasEnabledExtensions()`: call `void extManager.attachSession(partition, sess)` (skips `attachSessionCompat(sess)` and loads `orbit-compat` DNR + enabled user extensions). Else: call `attachSessionCompat(sess)` as today (zero overhead for users with no extensions!).
- In `isAnyOrbitFocused()`: include `!!extManager?.isPopupFocused()` so opening an extension popup in Compact Mode doesn't auto-hide the compact titlebar.
- In `w.on('closed')`: dispose `extManager` (destroy open popups, stop update timer).
- In `privacy:clear`: keep `sess.clearStorageData()` scoped or exclude extension storage? **Warning:** `sess.clearStorageData()` without `origins` / `storages` will wipe `chrome.storage.local` (logging the user out of Bitwarden and resetting uBOL rules)! Pass `{ storages: ['cookies', 'filesystem', 'indexdb', 'localstorage', 'shadercache', 'websql', 'serviceworkers', 'cachestorage'] }` carefully OR warn / exclude `chrome-extension://` data — **[UNVERIFIED]** exact behavior of `sess.clearStorageData()` on extension `chrome.storage.local` in Electron 45; verify during implementation.
- Add `fromUi(e)`-gated IPC channels:
  - `extensions:list`, `extensions:actions`, `extensions:set-enabled`, `extensions:set-pinned`, `extensions:install-store`, `extensions:install-unpacked`, `extensions:uninstall`, `extensions:open-options`, `extensions:check-updates`, `extensions:set-dev-mode`, `extensions:action-click`, `extensions:action-context-menu`, `extensions:install-answer` (for `beforeInstall` modal).
  - Push channels via `broadcastUi`: `extensions:state`, `extensions:actions`, `extensions:install-ask`.
- `ready` handler: send initial `extensions:state` and `extensions:actions`.

### 6.4 `src/main/tabs.ts`
- Add optional `TabHooks` callbacks:
  - `onTabViewCreated?(wc: WebContents, tabId: number, partition: string): void` → calls `extManager.addTab(partition, wc, win)`.
  - `onTabViewDestroyed?(wc: WebContents, tabId: number, partition: string): void` → calls `extManager.removeTab(partition, wc)`.
  - `onActiveTabChanged?(wc: WebContents | null, partition: string): void` → calls `extManager.selectTab(partition, wc)`.
  - `extensionContextMenuItems?(wc: WebContents, params: Electron.ContextMenuParams): Electron.MenuItem[]`.
  - `isAllowedExtensionUrl?(partition: string, url: string): boolean`.
- **Tab lifecycle hooks:**
  - `createView(tab)`: after wiring, call `this.hooks.onTabViewCreated?.(view.webContents, tab.info.id, partition)`.
  - `destroyView(tab)` (close, sleep, workspace isolation toggle): before `view.webContents.close()`, call `this.hooks.onTabViewDestroyed?.(view.webContents, tab.info.id, partition)`.
  - `activate(id)` & `focusPane(id)` & `switchWorkspace(id)`: call `this.hooks.onActiveTabChanged?.(active?.view?.webContents ?? null, partition)` (note: when active tab is on an `orbit://` internal page or empty start page, pass `null` or keep view hidden; extension popups should know active tab is non-web).
  - `togglePin(id)` / `sleepTab(id)`: emit `tab.view?.webContents.emit('tab-updated')` so `electron-chrome-extensions`'s `assignTabDetails` propagates `pinned`/`discarded` to `chrome.tabs.onUpdated`.
- **URL allowlisting for extension pages (`options_page`, Bitwarden popped-out vault):**
  - Keep `isAllowedUrl()` in `src/shared/url.ts` strict (`http:`, `https:`, `about:blank`).
  - Add a separate `createExtensionTab(url, opts)` / allow `chrome-extension://<loadedId>/...` ONLY when initiated by `ExtensionManager` (from `chrome.tabs.create`, `chrome.runtime.openOptionsPage`, or Settings "Options" click). In `will-navigate`/`will-redirect`, allow same-extension `chrome-extension://<loadedId>/...` navigation ONLY on tabs that already opened an extension URL; web tabs (`http(s):`) remain strictly blocked from navigating to `chrome-extension://` main frames.
- **Context menu (`contextMenu()` in `tabs.ts:1533`):**
  - Append `this.hooks.extensionContextMenuItems?.(wc, p)` (separated by a divider) before `Inspect`.
- **Expose helpers for `ExtensionManager`:**
  - `tabByWebContents(wc)` (to populate `assignTabDetails`: `pinned`, `index`, `discarded`), `activeWebContents()` + `activePartition()`, `activateByWebContents(wc)`, `closeByWebContents(wc)`.

### 6.5 Extension Popups: `PopupView` vs. `FloatingWindow` (`src/main/floating.ts`)
- **Recommendation: Keep `electron-chrome-extensions`'s `PopupView` and harden/align it via the `'browser-action-popup-created'` event — do NOT host extension HTML inside `FloatingWindow`.**
  - **Why:** `FloatingWindow` (`src/main/floating.ts`) loads Orbit's own renderer bundle in `session.defaultSession` with Orbit's preload and fixed size; extension popups must run in the workspace's `persist:*` session with `enablePreferredSizeMode: true` so Chromium's `preferred-size-changed` dynamically resizes popups (e.g., uBOL 273×375, Bitwarden 480×600), and `chrome.action.openPopup()` instantiates `PopupView` directly.
- **Fixes to apply in `ece.on('browser-action-popup-created', popup => ...)`:**
  1. **Close Orbit's `menuPopup`** if open, and set `compactPins.extPopup = true` (similar to `compactPins.titleMenu`) until `popup.browserWindow` closes so Compact Mode's floating titlebar stays visible while interacting with the popup.
  2. **Fix positioning & display clamping:** `PopupView.updatePosition()` uses raw `parent.getBounds()` without `parent.webContents.getZoomFactor()` and without clamping to `screen.getDisplayNearestPoint().workArea`. Listen to `popup.on('will-move', ...)` / `popup.on('resized', ...)` and clamp bounds via Orbit's existing `clampPopupBounds()` (`src/shared/menu.ts`) using `parent.getContentBounds()` + zoom factor!
  3. **Close on parent move/resize & external focus loss:** Attach `parent.once('move', popup.destroy)` / `parent.once('resize', popup.destroy)` (cleaning up on popup `closed`), and optionally close on `blur` unless DevTools is open on the popup.
  4. **Lock down navigation in popup:** Attach `will-navigate` (allow same-extension origin only; open `http(s):` links via `tabs.create` instead) and `setWindowOpenHandler` (route `http(s):` / same-extension popups safely into `tabs.create` or sandboxed popup windows).

### 6.6 Preload, IPC, Packaging & `electron.vite.config.ts`
- **`electron.vite.config.ts`:**
  - Add `extCompat: resolve('src/preload/ext-compat.ts')` to `preload.build.rollupOptions.input`.
  - Copy `node_modules/electron-chrome-extensions/dist/chrome-extension-api.preload.js` and `node_modules/electron-chrome-web-store/dist/chrome-web-store.preload.js` into `out/preload/` during `main` build (or resolve them from `node_modules` in dev and `out/preload/` in prod) AND pass explicit paths (via `modulePath` or resolving next to `__dirname`).
  - **Packaged ASAR fuse caveat (`package.json:52`):** Orbit sets `onlyLoadAppFromAsar: true`. Electron's `session.registerPreloadScript` supports paths inside `app.asar` in modern Electron, **but** this MUST be verified in a real `npm run dist:dev` packaged build before shipping (**[UNVERIFIED]** — if `registerPreloadScript` for `service-worker` rejects an `.asar` path, add `out/preload/chrome-*.preload.js` and `out/preload/ext-compat.js` to `build.asarUnpack` or verify `onlyLoadAppFromAsar` interaction).
- **`src/preload/index.ts` & `src/preload/compact.ts` & `src/shared/types.ts`:**
  - Add `extensions` namespace to `VeyraApi` (and action-bar subset to `src/preload/compact.ts` so pinned extension icons also work in Compact Mode's floating titlebar).
  - Do **not** expose `injectBrowserAction()` / `crx-msg-remote` if using Orbit's own React toolbar buttons + `fromUi`-gated IPC (cleaner styling in Veyra's design system, native support for pinning/reordering/overflow menu, and smaller IPC attack surface).

### 6.7 Renderer UI: `TitleBar.tsx` & `SettingsPage.tsx`
- **`src/renderer/src/components/TitleBar.tsx`:**
  - Add an `<ExtensionToolbar>` right after `.tb-center` (before the right `.tb-drag` / `WindowDots` / `.caption-space`), hidden when 0 extensions are installed.
  - Renders pinned extension buttons (28×28 icon buttons matching `.icon-btn`, badge pill overlay, tooltip with action title) + a subtle puzzle-piece overflow button (opens an Orbit `MenuPopup` listing unpinned extensions + "Manage extensions" → `orbit://settings` `#set-extensions`).
  - Clicking a button sends `api.extensions.clickAction(ext.id, rect)` (passing `btn.getBoundingClientRect()` relative to viewport so main process anchors `PopupView` cleanly below the button); right-clicking sends `api.extensions.contextMenu(ext.id, rect)`.
  - Works identically in `CompactTitlebarWindow` (`src/renderer/src/components/CompactPanels.tsx`), adding `compactTitlebar.offsetCss()` to the anchor rect in main process (same pattern as `MenuPopup.open(..., offsetCss)`).
- **`src/renderer/src/components/SettingsPage.tsx`:**
  - Add `{ id: 'set-extensions', label: 'Extensions' }` to `SETTING_SECTIONS` (between `set-permissions` and `set-updates`).
  - Section contents (in Orbit's calm `.set-card` / `.set-row` style):
    - Top bar: "Browse Chrome Web Store" button (opens `https://chromewebstore.google.com/` in active/new tab), "Install by ID / URL" inline input, "Check for updates" button, and "Developer mode" toggle (reveals "Load unpacked…" folder picker using `dialog.showOpenDialog({ properties: ['openDirectory'] })`).
    - Extension cards list: icon, name, version, source badge (Web Store / Unpacked), live memory readout (`~XX MB`), Enable/Disable switch, Pin to toolbar switch, collapsible "Permissions" list, "Options" button (if `optionsUrl`), "Allow native messaging" toggle (only shown if extension declares `nativeMessaging`), and "Remove" button with confirm.
    - Inline install confirmation bar/modal (similar to `PermissionBar.tsx`) when `extensions:install-ask` fires from `beforeInstall`.

---

## 7. Known Limitations to Communicate to the Owner

1. **Some MV3 Chrome APIs do not exist in Electron 45:** `chrome.sidePanel`, `chrome.offscreen`, and `chrome.identity` are absent (`undefined`), and `chrome.commands` keyboard shortcuts are not dispatched. Extensions relying strictly on these (e.g., side-panel-only AI assistants, Google OAuth via `chrome.identity`, or Bitwarden's side-panel mode / offscreen clipboard auto-clear) will have reduced functionality or fail. **[VERIFIED]**
2. **Memory scales linearly with isolated workspaces:** Each enabled extension runs its own service worker renderer per session partition (`~99 MB` private for uBOL, `~111 MB` private for Bitwarden, plus `~27 MB` for Orbit's internal DNR compat extension). Running both in 4 isolated workspaces uses `~1.05 GB` private / `~2.0 GB` working set. Lazy-loading isolated workspaces and letting users keep non-isolated workspaces on `persist:web` is essential. **[VERIFIED]**
3. **Separate extension state per isolated workspace:** `chrome.storage.local` is isolated per partition, so signing into Bitwarden in `persist:web` does not sign into Bitwarden in an isolated `persist:ws-<id>` workspace. **[VERIFIED]**
4. **Native Chromium extension warnings in dev logs:** Electron prints harmless `ExtensionLoadWarning: Permission 'contextMenus' / 'sidePanel' / 'webNavigation' / 'notifications' / 'privacy' is unknown` warnings for APIs polyfilled by `electron-chrome-extensions` or unsupported by Electron. **[VERIFIED]**
5. **MV2 extensions are not supported by default:** `minimumManifestVersion: 3` is enforced to match Chrome Web Store and security policy. **[VERIFIED]**
6. **Unverified before shipping (must verify in implementation):** Full logged-in Bitwarden vault unlock + inline autofill shadow-DOM overlay, Bitwarden Desktop biometrics via Native Messaging, interactive "Add to Veyra Orbit" click inside `chromewebstore.google.com`, packaged `.asar` preload loading under `onlyLoadAppFromAsar: true`, and `privacy:clear` preservation of `chrome.storage.local`. **[UNVERIFIED]**

---

## 8. Step-by-Step Implementation Checklist & Tests

### Phase 1 — Core Foundation & Compat Switch (Main Process)
1. [ ] Install `electron-chrome-extensions@4.10.0` and `electron-chrome-web-store@0.13.0` as production dependencies in Orbit's `package.json`; verify `npm audit` and `allowScripts`.
2. [ ] Create `src/shared/extensions.ts` (types, `validateExtensionId`, `isAllowedExtensionTabUrl`, `describeManifestPermissions`, `filterCookiesByHostPermissions`) + unit tests in `tests/extensions.test.ts`.
3. [ ] Create `src/preload/ext-compat.ts` (`browser` ← `chrome` mirror) and update `electron.vite.config.ts` to build it and copy `chrome-extension-api.preload.js` & `chrome-web-store.preload.js` into `out/preload/`.
4. [ ] Add `detachSessionCompat(sess)` in `src/main/compat.ts` and internal `orbit-compat` DNR extension generator in `src/main/extensions.ts`.
5. [ ] Implement `ExtensionManager` in `src/main/extensions.ts`:
   - `extensions.json` persistence, lazy session attachment, `ElectronChromeExtensions` instantiation.
   - Harden `CookiesAPI` (`permission = 'cookies'` + host-permission filter), gate `runtime.connectNative`/`sendNativeMessage` behind per-extension opt-in, enforce URL allowlist in `createTab`/`createWindow`/`tabs.update`.
   - Implement CRX3 RSA-SHA256 signature verification + Zip-Slip check around `electron-chrome-web-store` downloads, and enforce exact `=== 'https://chromewebstore.google.com'` origin check.
   - Implement `PopupView` clamping/zoom/compact-pinning/navigation lockdown in `browser-action-popup-created`.

### Phase 2 — Tabs, Security & IPC Wiring
6. [ ] Update `src/main/tabs.ts` with `onTabViewCreated`, `onTabViewDestroyed`, `onActiveTabChanged`, `extensionContextMenuItems`, `createExtensionTab` (same-extension navigation only), and `tab-updated` emissions on pin/sleep.
7. [ ] Update `src/main/security.ts` so loaded `chrome-extension://<id>` origins can use `clipboard-read` / `notifications` only if declared in their manifest; verify `privacy:clear` does not unintentionally wipe extension storage.
8. [ ] Wire `ExtensionManager` into `src/main/index.ts` (`setupWebSession`, `fromUi`-checked `extensions:*` IPC, `isAnyOrbitFocused`, `compactPins`, `closed` cleanup) and expose typed methods in `src/preload/index.ts`, `src/preload/compact.ts`, and `src/shared/types.ts`.

### Phase 3 — UI (TitleBar, Compact TitleBar, Install Prompt, Settings)
9. [ ] Add `<ExtensionToolbar>` to `src/renderer/src/components/TitleBar.tsx` (pinned action buttons with badges + overflow menu) and verify anchor offsets in `CompactTitlebarWindow`.
10. [ ] Add `Settings → Extensions` (`#set-extensions`) in `src/renderer/src/components/SettingsPage.tsx` (enable/disable, pin, permissions list, memory MB readout, options link, remove, CWS button + ID install, updates check, Developer mode + load unpacked).
11. [ ] Add extension install permission-review modal/bar for `beforeInstall` (`extensions:install-ask` / `extensions:install-answer`).

### Phase 4 — Verification & Automated Tests
12. [ ] **Unit tests (`tests/extensions.test.ts`):** ID validation, URL scheme allowlist (rejects `file:`, `javascript:`, `data:`, `orbit:`; allows `http(s):` and loaded `chrome-extension://<id>/...`), permission-label mapping, cookie host-permission filtering, CRX3 signature verification (valid + tampered payload rejection), `extensions.json` migration/sanitization.
13. [ ] **Electron smoke tests (with `VEYRA_USERDATA`, `VEYRA_TEST_EXIT_MS`, unset `ELECTRON_RUN_AS_NODE`):**
    - Load synthetic MV3 extension + no-perm extension: verify content script in sandboxed tab, zero leakage to UI window or web globals, `ext-noperm` blocked from `chrome.cookies.getAll` and `file://` tab creation.
    - Install real **uBlock Origin Lite**: verify zero SW errors, Google Auth header rewrite + Client Hints still work via `orbit-compat` DNR, AND uBOL blocks/redirects ad/tracker scripts (`net::ERR_BLOCKED_BY_CLIENT` / surrogate redirect), popup opens & clamps inside window, dashboard opens.
    - Install real **Bitwarden**: verify SW + WASM SDK boot, popup renders cleanly, content script attaches, storage persists across restart and stays isolated across `persist:ws-<id>`.
    - **Packaged build check (`npm run dist:dev`):** verify `registerPreloadScript` works under `onlyLoadAppFromAsar: true` and `orbit-compat` loads cleanly from `userData/internal-extensions`.
    - **Interactive manual checks:** Chrome Web Store "Add to Veyra Orbit" prompt flow, logged-in Bitwarden vault autofill, Compact Mode popup interaction, `privacy:clear` behavior with installed extensions.
