# Kickoff prompt for Claude Code

Copy everything below into Claude Code, from the repo root of **RAKIT - Task Tracker**.

---

Unzip `design_handoff_workspace_command_center/` into the repo root (or point me at where you put it), then:

1. Read `design_handoff_workspace_command_center/README.md` in full.
2. Read `design_handoff_workspace_command_center/project/Rakit Prototype.dc.html` top to bottom — the markup is the layout, the `class Component` script at the bottom is the state and behavior. Read `renderVals()` carefully; it defines every value the screens render.
3. Skim `project/Rakit Redesign.dc.html` for the token and component inventory (light + dark, mobile + desktop).
4. Do **not** open these files in a browser or screenshot them.

Then, before writing any code:

- Cross-check the README's "What already exists" table against the repo. Tell me what is already there, what needs restyling, and what is genuinely new.
- Confirm how workspace scope should persist: `?ws=` search param (shareable, plays well with TanStack Router loaders) or localStorage. Recommend one.
- Confirm whether the Command Center replaces the current `/` route or lives beside it while I compare.
- Flag anything in the design that the current Supabase schema can't back — especially "late" and "needs attention" — and propose how to derive it from existing columns before adding migrations.

Then propose a plan in phases following the README's suggested build order, and stop for my approval before implementing.

Constraints:
- Reuse `src/styles.css` tokens; do not introduce new hex values.
- Reuse existing data functions (`fetchDashboard`, `fetchNav`, `listMyWorkspaces`, `fetchPendingApprovalsFn`, `resolveApprovalFn`) before writing new queries.
- Keep the existing tests green; add tests for any new lib function.
- Mobile-first. Desktop layouts are in `Rakit Redesign.dc.html` section 05.

---

## Two other ways to get this to Claude Code

**A. Point it at the folder.** Everything here also lives in your mounted project folder, so you can just say:
```
Read design_handoff_workspace_command_center/README.md and project/Rakit Prototype.dc.html, then plan the implementation.
```

**B. Track it in TASKS.md.** Append the six build-order phases to the repo's `TASKS.md` and let Claude Code work through them one at a time — that keeps the work reviewable between phases.
