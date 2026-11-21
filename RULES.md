# Working rules

These follow Veyra Study's rules (`C:\dev\veyra-study\RULES.md`). The owner can change them for any one change.

1. **No AI attribution** in commits or pull requests.
2. **Never commit secrets.** Update tokens and keys live in `C:\dev\tools\`, never in the repo.
3. **Never reuse Veyra Study's tokens.** That includes its dev updater token. Veyra Orbit gets its own.
4. **Don't change `carrotsz19/veyra`** or its account Worker. Reading them is fine.
5. **Test on a scratch profile** (`VEYRA_USERDATA`), never on the real browser profile or real Veyra Study data.
6. **Don't weaken the security baseline** in PLAN.md (sandboxing, allowed schemes, deny-by-default permissions) without the owner's OK.
7. **Changes that need Veyra Study** (like a `focus_status` tool) go through Veyra Study's own rules: Dev first, server changes additive.
