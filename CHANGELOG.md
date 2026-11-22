# Changelog

All notable changes to Veyra Orbit are documented here.

## Unreleased

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
