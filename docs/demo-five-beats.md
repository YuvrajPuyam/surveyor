# The five-beat demo (3:00, from the judge cut)

Isaac PIP, Mars flourish, and MCP move to **Q&A ammunition and the booth**.
Default execution mode is **replay-decisions / execute-tools-live** — not
gated on a rehearsal failure; the countdown clock can't tell and neither can
anyone else.

## Opening line (creative-tech panel sentence — Poeia XR / Machine Cinema / FBRC.AI hold scorecards)

> "A world whose pixels don't match its physics breaks presence the moment
> a foot goes through the floor. We built the instrument that catches
> ghost geometry before anyone — human or robot — steps in."

Plus one sentence of disclosure, said with pride, hour-zero commits on screen:

> "The certifier is a public open-source library we built and disclosed
> before the event; what we built here is the product around it."

## Beat 1 — Wireframe reveal (~20s)

Walk the photoreal world. Toggle the physics shell. The two files disagree
on screen before a word of pitch. **Lead with the ghost geometry, not the
hole**: "this wall you're seeing? Physics says it isn't there. A vision
policy trained here learns an affordance that doesn't exist — and no
training run ever crashes to tell you."

## Beat 2 — Survey (~40s)

Scripted sweep shown as ablation, then the agent directs the marginal probe
budget with the live reasoning log. Trust map paints: confirmed / observed /
divergent. Certificate line lands on screen:

> recall 96.8% (95% CI ≥ 85.6%, n=31) on planted defects — the certifier
> ships its own error bars.

## Beat 3 — The sill verdict (~30s)

Same world, two verdicts: 0.15 m sill **fails the rover, passes the
quadruped**. Both halves are measurements (the quadruped via the traversal
envelope check). "Sim-readiness is relative to the robot" — the marquee
sentence, protected narration time.

## Beat 4 — One repair, fail-and-adapt (~45s) — THE agentic beat

**Disclosure line first, two seconds:** "here's a failure mode we love —
watch it recover." **Architecture line second (C14 — a hostile expert
reviewer misread this, so judges will too):** "the agent never edits
geometry — it chooses from nine deterministic, reversible tools, and the
instrument re-inspects every choice before it counts." Then: diagnosis fork
on the scale defect (vendor factor
1.624 vs our independent 1.60 estimate — one `apply_vendor_scale` re-measures
the world: doorway 1.27 → 2.02 m). Then the hole patch: fitted_slab →
regional recertify catches the NEW 0.48 m step the patch itself created →
revert → mesh_fill → holds. Close: "the certifier caught our own repair —
repaired is never invisible to this instrument." (This exact sequence
happened un-staged on the first real Marble world; cassette in traces/.)

## Beat 5 — Patrol close (~30s)

Re-certified grade on screen (F → A, 81/81 defect outcomes recorded). Rover
spawns at a verified point, drives OVER the patch, routes AROUND the
quarantined ghost geometry. Label: "navmesh waypoint-following." Certificate line:
"grade predicts navmesh-level traversability under the disclosed model
class — not policy transfer."

## Gravity beat (only if time credit; else Q&A)

Order: **change first, integrity second.** Stopping distance 2.6x on Mars —
beat lands — then: "and slope: UNCHANGED. atan(µ) — gravity cancels. A tool
that faked physics would have moved it."

## Q&A ammunition (not in the 3:00)

- Isaac receipt clip (cross-engine concordance when cluster evenings land)
- Mars/Perseverance flourish
- MCP front door (Claude certifying a world over localhost, live if asked)
- Self-validation appendix: per-world bench results incl. the honest miss
  (local mis-scale — outside current taxonomy, disclosed as a scope line)
- The business beat: repair is the LAST MILE of a filter pipeline —
  generate 5, certify all, auto-select, repair only what filtering can't fix
- The moat slide: the defect-outcome ledger — an accumulating corpus of how
  generated worlds fail and which repairs hold; neither NVIDIA nor World
  Labs has it

## Q&A arsenal — the Gemini breaking questions (C15; rehearse verbatim)

**Q1 "A kinematic test in Rapier can't guarantee dynamic stability in
PhysX — engines differ exactly where sim-to-real breaks: contact."**
Answer in three steps. (1) The certificate never claims it: it prints
"predicts navmesh-level traversability under the disclosed model class —
not policy transfer." (2) The static receipt: PhysX corroborated the
Rapier-certified repaired floor to 1 mm (G3a). (3) The DYNAMIC receipt:
G3b is a contact-rich pick-lift-traverse-place in PhysX ON THE REPAIRED
GEOMETRY at lunar gravity — set-down 0.3 mm from the probe-measured
surface. That also answers "LLM patches destabilize solvers": the patched
mesh ran clean through the whole choreography. Bounded claim, receipted.

**Q2 "Why repair a $1.20 asset instead of regenerating until one is
clean?"** Agree — filtering IS the pipeline: `hero-fish.ts` certifies a
fleet and ranks it ("the certificates pick the hero", mechanically).
Repair is the LAST MILE for the world you've already invested in — and
the repair tools are deterministic engine operations; the agent only
chooses among them (see the Beat-4 architecture line). The audited repair
is also the layer no filter, SimReady rule, or vendor fix replicates.

**Q3 "Your scale prior is circular — a door-height assumption scales the
whole world."** The prior is one of THREE independent signals: vendor
metadata (cross-checked, not trusted), the door prior (disclosed ±10%),
and the pano-depth audit (instrument #3, imagery-side). Where they
disagree, the certificate says so; where none applies (outdoor, no
doors), metric verdicts are SUSPENDED and printed as suspended — never
computed on fake meters. The failure mode Gemini describes is the one
thing the schema makes unrepresentable.
