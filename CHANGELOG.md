# Changelog

All notable changes to Veyra Orbit are documented here.

## Unreleased

## 26.11.9 — 2026-11-22

- Screenshot tool: click the camera button in the toolbar, right-click any page → Take screenshot…, or press Ctrl+Shift+2 to capture the visible area, the full scrollable page, or a dragged selection area. Captures copy straight to your clipboard with a floating preview to Save PNG (saved into Downloads and shown in the sidebar downloads list) or Copy again. Works on `orbit://` pages too and never auto-saves in private workspaces.
- Tab and window behaviour options in Settings → General: choose to reopen only pinned tabs on start, open links from other apps in a new tab or the current tab, place new tabs at the end of the list or after the current tab, select the tab to the right, left, or last used when closing a tab, and optionally confirm before closing a window with many open tabs.
- Custom search engines and `!` keyword shortcuts in Settings → Search: add, edit, or remove `https://` search engines, set your default, and type shortcuts like `w cats` or `!w cats` in the address bar (with a live engine badge while typing). Includes built-in defaults for Google, DuckDuckGo, Bing, Brave, Ecosia, Wikipedia (`w`), YouTube (`yt`), GitHub (`gh`), and MDN (`mdn`).
- Custom UI CSS and built-in style mods in Settings → Appearance: toggle built-in look tweaks or add your own custom CSS for Orbit's interface, with `--safe-mode` (or holding Shift on launch) recovery if custom styles ever break the layout.
- Per-workspace look: give any workspace its own theme preset, accent colour, and start-page background.
- Tabs on top and sidebar width presets: switch between the vertical sidebar and a horizontal top tab bar in Settings → Appearance, or pick a sidebar width preset.
- Customisable toolbar: reorder, add, or remove toolbar buttons from Settings → Appearance or by right-clicking the toolbar → Customize toolbar.
- Keyboard shortcut editor in Settings → Keyboard shortcuts: search, rebind, disable, or reset Orbit's shortcuts, with automatic warnings if two shortcuts clash.
- Compact mode: the sidebar slides away again after you use a tab's right-click menu (for example Duplicate), instead of staying stuck open.
- Downloads now live in the bottom-left of the sidebar with a circular progress ring and count badge while files download. Click it (or press Ctrl+J) to expand recent downloads with pause, resume, cancel, show in folder, remove, drag-out to other apps, and "Show all" (`orbit://downloads`).
- Split view now supports top/bottom stacked panes in addition to left/right: drag a tab onto any of the four page edges, rotate between left/right and top/bottom from the tab right-click menu or View menu, drag tabs out of the compact-mode sidebar to split, and drag the active tab onto the page to split it with your most recently used tab.
- Automatic updates are now easier to see and control: choose "Automatic (recommended)" or "Notify only" in Settings → Updates, restart from a quiet toolbar pill or the Help menu once an update is ready, check automatically after waking from sleep or returning to Orbit after 4 hours, and see a small dismissible "Updated to … — What's new" notice after updating.
- Bookmark bar below the toolbar: shows favicons, truncated titles, folder dropdowns, an overflow `»` menu, click to open (middle-click or Ctrl+click for a new tab), right-click to edit or delete, drag to reorder, and drag links or the address-bar icon onto the bar to save. Toggle with Ctrl+Shift+B, the View menu, or Settings → Appearance (Always, Only on start page, or Never).
- A calmer, simpler look across Orbit: removed the moving glowing blobs on the start page (saved settings move cleanly to the plain background), switched to system fonts throughout, redesigned the start page with unboxed sections, Safari-style quick-link icons and a compact customize sheet, and refined the sidebar, toolbar, menus, command bar, Library, and Settings with grouped inset lists, sliding segmented controls, and clearer keyboard focus rings.
- Lower memory use: menus, compact panels, link previews, and the command bar now open on demand and free their memory after sitting unused for a minute.
- Smarter tab sleeping: choose a 5-minute sleep option in Settings → Performance; tabs using your camera, microphone, or screen sharing, or tabs with unsaved text you typed into a form, never sleep. Sleeping tabs look gently faded in the sidebar.
- Less background work: hidden windows and background tabs stay throttled, and the start page pauses its moving background when hidden or when reduced motion is on.
- Live memory view in Settings → Performance: see how much memory Orbit, each tab, and your extensions are using, and put any background tab to sleep with one click.

## 26.11.8 — 2026-11-22

- A new start page: a clock and greeting with your name, quick-link tiles you can add, rename and reorder, "Continue where you left off", your bookmarks, a "What are you studying today?" note and a daily quote. Pick a soft moving background, a plain colour, or your own picture (with dim and blur). Use the Customize button to turn widgets on or off and reorder them.
- Make Orbit yours in Settings → Appearance: seven themes (Veyra Clay, Midnight, Paper, Forest, Ocean, Rosé, Graphite), any accent colour, corner roundness, density, text size, sidebar on the left or right (drag its edge to resize, optionally see-through), address bar position, which toolbar buttons show, full menus or one ☰ menu, the gap and shadow around the page, and how much animation you want. Export and import your look as a file.
- Nicer empty History and Bookmarks pages.

## 26.11.7 — 2026-11-22

- A more polished look: a deep, even window background, the page on a softly shadowed card, quieter menus, a filled address bar, the active tab as a raised pill, a round workspace switcher, slim scrollbars, styled dropdowns and checkboxes, and one consistent look and animation for every popup. Light mode got the same care.
- The start page greeting, search box and import card are more refined.
- Sharper app icon on the taskbar, Start menu and desktop: every size is drawn for its own size, and the window and installer use the same icon.

## 26.11.6 — 2026-11-22

- Google sign-in: Orbit's sign-in fix now switches on properly from the very first launch, so a brand-new install should sign in first time.
- The address bar shows the right address when you switch to Settings, History or Bookmarks, and no longer selects the previous tab's address.
- Adding an extension: the confirmation is now a compact bar (long permission lists scroll inside it), and the Chrome Web Store no longer scrolls sideways.
- Compact mode: after dragging the window, hovering the top edge brings the title bar back again without clicking.
- Security: updated the library that unpacks extensions, and Orbit now refuses extension files with duplicate file names.

## 26.11.5 — 2026-11-21

- Extensions: install Chrome extensions from the Chrome Web Store ("Add to Veyra Orbit"). Orbit shows what an extension can do, in plain words, before adding it. Extensions work straight away, have buttons in the title bar, and are managed in Settings → Extensions (on/off, remove, permissions, memory use). Private workspaces never run extensions. Some extensions won't fully work, because Orbit doesn't support every Chrome feature (for example side panels).
- Compact mode: you can drag the window by the title bar that slides in, double-click it to maximise, and its window buttons work.
- Google sign-in: a brand-new install may be turned away the first time or two; trying again works.

## 26.11.4 — 2026-11-21

- Compact mode no longer makes the page jump: the sidebar and title bar now slide in over the page while it stays where it is.
- Split view: show two to four tabs side by side. Right-click a tab → Split with active tab, drag a tab onto the left or right half of the page, or press Ctrl+Shift+\. Drag the divider to resize; your split comes back after a restart.
- Command bar (Ctrl+K): search your open tabs in every workspace, bookmarks, history and Orbit's own commands, or type a search or an address.
- Link previews: Shift+click a link to open it in a floating preview, then open it as a tab, in split view, or close it.
- Import bookmarks and the last 90 days of browsing history from Google Chrome, Microsoft Edge, or Brave in Settings → Import data (and offered once on first run on the start page). Nested bookmark folders are kept in titles as "Folder › Title", duplicates are skipped, and source browser files are never modified. Saved passwords are not imported yet.
- Private workspaces (File → New private workspace, or Ctrl+Shift+N): browse in a separate in-memory workspace with a dark private accent and eye-off icon. History, cookies, site data, permissions and open tabs are never saved and are cleared when you close the private workspace or quit Orbit. You can still bookmark pages deliberately.

## 26.11.3 — 2026-11-21

- A new title bar like Veyra Study's: the Orbit mark and name, then File, Edit, View, History, Bookmarks, Workspaces and Help menus, with the address bar on the same row. Menus open above the page and work from the keyboard (Alt, arrows, Enter, Esc). In a narrow window they fold into one ☰ menu.
- Choose Windows window buttons or Veyra's coloured dots in Settings → Appearance.
- Workspaces: each has its own name, icon, colour and tabs. Switch at the bottom of the sidebar or with Ctrl+Alt+1–9. They share your sign-ins unless you choose "Keep sign-ins separate". Your tabs from before are in "Personal".
- Compact mode (Ctrl+Shift+S): the page fills the window. Move to the left or top edge to bring back the sidebar or the title bar.
- Sleeping tabs: tabs you haven't used for 30 minutes free their memory and reload when you open them. Change or turn it off in Settings → Performance.
- In Settings, the highlighted section now follows where you are on the page.

## 26.11.2 — 2026-11-21

- A new icon: a clay moon on its orbit. Veyra Orbit Dev has a dark tile with a clay corner, so you can tell the two apart.
- Settings has a new look, with sections down the side, and it scrolls properly now.
- Google sign-in works ("This browser or app may not be secure" is gone), in tabs and sign-in pop-ups.
- Sign-in pages no longer open the Windows Security passkey window by themselves. Choosing a passkey still works.
- Orbit now updates itself: a small "Update ready" note appears when a new version has downloaded, and Settings can check for updates.

## 26.11.1 — 2026-11-21

- First Veyra Orbit Dev release alongside Veyra Orbit, with its own app ID, profile, and DEV badge.
- Vertical sidebar tabs with pinning, drag-to-reorder, mute/audio indicators, and right-click tab menu.
- Address bar with search, short URL display, and suggestions from open tabs, history, and bookmarks.
- Built-in History (`orbit://history`), Bookmarks (`orbit://bookmarks`), and Settings (`orbit://settings`) pages.
- Downloads panel (`Ctrl+J`), find in page (`Ctrl+F`), zoom controls, printing (`Ctrl+P`), and built-in PDF viewer.
- Full-screen video support, remembered per-site permissions, external app confirmation prompts, and Electron security fuses.
