---
name: panel
description: Run the SURVEYOR advisory panel — a criticizer, an upgrader, and a resolver agent — and save a dated report to docs/panel/. Use occasionally when the project has moved meaningfully (feature landed, pivot, pre-demo), or whenever the user asks for a panel/critique/review of the project direction.
---

# SURVEYOR advisory panel

Three agents, run via the Workflow tool: a **criticizer** (major flaws in
concept, feasibility, usability), an **upgrader** (ambitious ideas for the
hackathon, the product, and the final vision), and a **resolver** (merges both
into one plan aimed at a complete, finished, polished product).

## Steps

1. Get today's date (`YYYY-MM-DD`). Find the most recent report in
   `docs/panel/` (files are named `<date>-panel.md`); if one exists, note its
   path and skim `git log --oneline` since that date to write a one-paragraph
   "what changed since last panel" focus note. Fold in anything specific the
   user asked the panel to look at.
2. Optionally re-fetch https://luma.com/u7pmhw92 and refresh
   `docs/hackathon-context.md` if the event page has new judging/schedule
   details (skip if fetched recently).
3. Invoke the Workflow tool:
   ```
   Workflow({
     scriptPath: "D:\\worlds-in-action\\.claude\\workflows\\project-panel.workflow.js",
     args: {
       date: "<YYYY-MM-DD>",
       focus: "<what changed since last panel + any user-specified focus>",
       previousReport: "<repo-relative path to last report, or 'none'>"
     }
   })
   ```
4. When it completes, write `resolution.report_markdown` verbatim to
   `docs/panel/<date>-panel.md`, then append a `## Appendix — raw panel output`
   section containing the criticizer findings and upgrader ideas (compact
   markdown, not raw JSON dumps).
5. Commit the report. Tell the user the resolver's `headline`, the top 3-5
   actions, and anything that contradicts the current plan in HANDOFF.md /
   PLAN.md — flag contradictions explicitly rather than silently adopting them.

## Notes

- Panel agents are read-only by instruction; they must not edit files, spend
  Marble credits, or launch `claude -p` episodes.
- Vocabulary rule applies to reports too: confirmed/observed/divergent, ghost
  geometry, phantom colliders — never "lying".
- The report is advisory. The user decides what enters PLAN.md.
