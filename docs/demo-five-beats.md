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

Same world, two verdicts — spoken PER-SILL, exactly as the wording law
below mandates: "This specific **0.09 m sill fails the rover and passes the
quadruped**." (Camera on that sill; the world-level step verdict fails both
robots and is never quoted as a contrast.) Both halves are measurements
(the quadruped via the traversal envelope check). "Sim-readiness is
relative to the robot" — the marquee sentence, protected narration time.

## Beat 4 — One repair, fail-and-adapt (~45s) — THE agentic beat

**Disclosure line first, two seconds:** "here's a failure mode we love —
watch it recover." **Architecture line second (C14 — a hostile expert
reviewer misread this, so judges will too):** "the agent never edits
geometry — it chooses from a closed menu of eleven tools (three read-only,
eight deterministic reversible actions), and the
instrument re-inspects every choice before it counts." Then: diagnosis fork
on the scale defect (vendor factor
1.624 vs our independent 1.60 estimate — one `apply_vendor_scale` re-measures
the world: doorway 1.27 → 2.02 m). Then the hole patch: fitted_slab →
regional recertify catches the NEW 0.48 m step the patch itself created →
revert → mesh_fill → holds. Close: "the certifier caught our own repair —
repaired is never invisible to this instrument." (This exact sequence
happened un-staged on the first real Marble world; cassette in traces/.)

## Beat 5 — Patrol close (~30s)

Re-certified grade on screen (F → A, **75/75 defect outcomes recorded** —
the number is read OFF THE SCREEN, never from memory). Rover
spawns at a verified point, drives OVER the patch, routes AROUND the
quarantined ghost geometry. Label: "navmesh waypoint-following." Certificate line:
"grade predicts navmesh-level traversability under the disclosed model
class — not policy transfer."

## Beat 5′ — The certificate executes (~20s, recorded-but-real)

**Video: `assets/isaac/g4-policy-lift.mp4`** (G4 PASSED — the selection rule
from ENDGAME's wording law; `g3c-box-lift.mp4` is the pre-committed fallback
with the "zero training required" caption). Spoken, verbatim: "This policy
was trained by NVIDIA on their stock task — it has never seen our world. In
the certified pack, at 1.62 m/s² — gravity set to the lunar mission
profile — the spawns, the no-go zones, and the friction ranges all came
from the certificate. It fumbles the grasp, chases the crate, and delivers
it to within 3 centimeters of the commanded goal. Zero training." (NEVER
say gravity came from the contract: the shipped contract is the Earth
compilation and a judge can open it. If the lunar-context contract ships in
the pack before the event, the stronger sentence unlocks.) Say "the
habitat," never "moon base." Pride line ONLY AFTER the publish lane runs:
"download this exact pack — the certificate hash on our Devpost was
printed before this demo." Until published: "this pack, hash on screen,
goes up for download today."

**Beat 3 sill line (wording law, verbatim):** "This specific 0.09 m sill
fails the rover and passes the quadruped." NEVER "this world fails the
rover" — the world-level verdict fails both robots.

## Gravity beat (only if time credit; else Q&A)

Order: **change first, integrity second.** Stopping distance 2.6x on Mars —
beat lands — then: "and slope: UNCHANGED. atan(µ) — gravity cancels. A tool
that faked physics would have moved it."

## Q&A arsenal — the three hostile questions, ranked by damage (final review, answers verbatim)

1. **"You claim the certificate is a training contract, but where's the
   ablation — does a policy trained in an A world beat one trained in an F
   world?"** — *"We do not have the final policy-transfer correlation yet.
   What we prove today is kinematic safety: contact dynamics violently
   reject a robot encountering non-manifold ghost geometry. Surveyor is the
   prerequisite filter that keeps the physics solver from exploding —
   mandatory before valid reinforcement learning can even begin. And here
   is the first empirical anchor: fifteen identical navigation routes, the
   same waypoint controller — the raw world completes ZERO of fifteen;
   the repaired world completes thirteen. The full transfer study is the
   next receipt."* (paired-receipt.json ships in the pack's contract/
   folder: raw 0/15 vs repaired 13/15, seed 1234, caveat printed.)
2. **"You say vision policies never crash to reveal these errors — but your
   learned robot is state-based and your vision-run is a heightfield
   planner. Where's the actual vision policy?"** — *"We explicitly isolated
   the geometric reality gap from the perception gap. A state-based policy
   plus a perfect geometric depth-planner proves that even with FLAWLESS
   perception of the visual layer, the physics mismatch still destroys the
   robot. We certify the environment's integrity, not the robot's brain."*
3. **"World Labs will ship watertight aligned colliders eventually — isn't
   the repair shop obsolete then?"** — *"Patching holes is the baseline.
   Even a mathematically perfect mesh needs semantic parameterization for
   training: Surveyor generates the executable domain-randomization
   ranges — friction uncertainty, verified spawn zones — which generative
   models inherently cannot provide without physical experimentation."*

**Twin-run vocabulary (C12 narration):** *"betrayal by fall"* (ghost
floor), *"betrayal by block"* (phantom mass). Say "a geometric planner
relying on the visual surface" — NEVER "a vision-planning robot."

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
