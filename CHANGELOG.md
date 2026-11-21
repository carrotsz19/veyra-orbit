# Changelog

All notable changes to Veyra Orbit are documented here.

## Unreleased

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
