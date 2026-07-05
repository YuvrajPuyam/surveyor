# Customer discovery — simulated panel (2026-07-05) + real-outreach plan

**What this is:** five evidence-grounded persona interviews (each agent
researched real forum threads, GitHub issues, job postings, and community
guides for its niche before answering in character). **What this is not:**
real customer conversations. It predicts and prepares them; §4 is the plan
for running the real ones this week. Treat every claim here as a
hypothesis with a citation, not a validated fact.

**Verdicts:** Ken (indie Marble→Isaac user) **ADOPT** · Dana (AMR startup
sim eng) **PILOT** · Tomasz (SDG/perception eng) **PILOT** · Miguel
(locomotion PhD) **POLITE-PASS** · Priya (sim infra lead, budget
authority) **POLITE-PASS** with standing invitation.

---

## 1. The pattern in who converted

Adoption tracked **distance from the actual Marble→Isaac workflow**, not
seniority or budget. The one persona who had personally run the NVIDIA
blog workflow (Ken: three days, one thrown-away world, "I trust maybe 70%
of it") said ADOPT within the hour. The two whose pipelines the defects
silently poison (Dana: intermittent doorway-hole clip blamed on her own
nav stack; Tomasz: 7% scale error discovered at customer deployment) said
PILOT with concrete conditions. The two furthest from the workflow
(blind-locomotion academia; a buyer whose production pipeline has no
generated assets yet) passed politely — while both independently pointing
back at the same value slice.

**Implication for real outreach:** qualify hard for "have you actually
imported a generated/scanned world into a simulator?" People who haven't
will give warm useless feedback. People who have will give you incidents
with dollar costs attached.

## 2. Consensus findings (≥3 personas independently)

1. **The repaired copy / headless CLI is the product; the certificate as
   a document is packaging.** Dana: "the repaired copy is the product and
   you've buried it third in your sentence… we delete your import
   checklist wiki page." Ken: "`npx surveyor certify ./world` — that day,
   within the hour… the mode of success is 'the eslint of generated
   worlds.'" Tomasz: "'certifier' makes me expect a PDF; give me masks
   and scalars." Priya: "buyers pay for the removed ticket, not the green
   checkmark."
2. **The universal conversion artifact is downstream correlation.**
   Priya converts to PILOT on ~30 worlds showing verdicts predict task
   success; Ken posts unprompted in three Discords on a
   raw-vs-certified policy-success before/after; this matches what the
   robotics and VC judges demanded. **Cheaper near-term variant
   (Tomasz):** an instrument-calibration table — 10 public splat scenes,
   predicted scale error vs. ground-truth, "if your uncertainty envelope
   contains the true error on 9/10 scenes, I trust the instrument and
   compute the mAP impact myself."
3. **Different customers consume different certificate fields** — the
   certificate is a platform, the fields are the products:
   - Dana: per-robot pass/fail against *her* robot YAML; CI exit code.
   - Tomasz: `scale_factor: 1.07 ± 0.02`; camera-placement mask;
     surface-placement validity mask; quarantine wired into bbox
     visibility flags.
   - Ken: splat/collider agreement number; spawn validity; baked −90°/
     collision-preset export.
   - Miguel: emitted Isaac Lab config (verified spawns kill his
     NaN-reward incident class).
4. **Open-source core is mandatory; money is support/repair, annual,
   on-prem.** Per-world pricing DOA (the point is hundreds of worlds);
   SaaS DOA (assets don't leave the building). Numbers: Priya "$12k/yr
   and be the no-brainer, >$50k I build it internally"; Dana $15–40k/yr
   signable by her director; Tomasz free-or-nothing for the core, paid
   certification-as-deliverable for customer datasets.
5. **Cold outreach is dead; forum-thread rescue is alive.** Every persona:
   answer a specific thread someone is suffering in, with a working
   script attached. Instant-ignore list: "quick 15-minute call,"
   "AI-powered," demo video with no runnable artifact, "book a call for
   pricing."

## 3. New product intelligence (things nobody on the team predicted)

- **Far-from-origin recentering preflight (Ken; highest surprise-value).**
  The community's nastiest *unresolved* bug — float16 layered-rendering
  artifacts after ply→USDZ when scene coordinates sit 300+ m from origin
  (NVIDIA forum #360930) — is officially unfixable downstream (closed RTX
  renderer) but **trivially preventable upstream** by detecting offset
  coordinates and recentering before conversion. Nobody is positioned to
  ship this except a pre-flight certifier. Small code, real community
  gratitude, likely the best launch-post hook.
- **Scale error hurts perception more than RL (Tomasz).** Depth labels
  and object-size distributions are silently poisoned; discovery is
  weeks-later at customer eval. The SDG persona is a *stronger* scale
  customer than the RL persona the pitch targets.
- **Semantic lies are the next defect class (Dana).** Geometry-correct
  can be semantics-wrong: a "shelf" meshed as a solid slab has no
  pick-under gap; probes verify solidity, not meaning. Roadmap item, and
  a Q&A answer to have ready.
- **Repair provenance (Dana).** Mark patched triangles as patches:
  "I need to know which triangles are measured and which are your
  hallucination stacked on Marble's hallucination." (Partially shipped —
  the operation ledger — but not yet *in the exported mesh*.)
- **Uncertainty must widen at the periphery (Dana).** Marble quality
  decays meters from capture origin (HN consensus); flat confidence at
  the edges will burn credibility on the first bad edge verdict.
- **Competitive map is more crowded than the plan assumed:**
  **SimReady Foundation** (NVIDIA, open, machine-checkable validation
  rules) commoditizes generic asset checks — the moat is splat-specific
  fidelity, per-robot task-conditioned verdicts, and repair, none of
  which SimReady covers. **GaussGym** (Berkeley, Oct 2025) owns
  open-source pixels-to-locomotion in splat worlds — don't pitch into
  that lane; certify *for* it instead.
- **Academia's adoption currency is a benchmark, not a tool (Miguel).**
  "N certified worlds, fixed splits, baselines, released seeds — then
  citing you is mandatory. Tools get a footnote; footnotes aren't
  citations."
- **Determinism is a sales asset already in hand (Priya).** Her eval
  checklist includes "rerun 10 times: identical verdicts?" — the repo's
  byte-identical determinism tests answer a buyer question verbatim;
  surface them in the README.

## 4. The real conversations (run this week — simulation doesn't count)

**Where (specific, from all five personas):**
NVIDIA Isaac Sim forum (esp. the NuRec subcategory and the Marble-blog
thread #355009) · IsaacSim/IsaacLab GitHub Discussions · NVIDIA Omniverse
Discord #isaac-sim · LeRobot (Hugging Face) Discord · Gaussian Splatting
Discord + r/GaussianSplatting · ROS Discourse simulation category ·
r/robotics, r/computervision.

**How (the only approach every persona endorsed):** reply to a specific
existing thread with a working script/fix, then mention the tool once.
Candidate threads to rescue, all cited in §2–3: the layered-USDZ artifact
thread (ship the recentering preflight as the fix), a
falling-through-floor thread (link the probe+raycast cross-check), the
Marble-blog forum thread itself (post the auto-alignment writeup Dana
suggested: "here's how to auto-align Marble colliders — no reference
cube").

**Interview guide (Mom-test; 6 questions, ~20 min):**
1. Walk me through the last time you brought a new environment into your
   simulator. What did it cost you? (Get the story, not the opinion.)
2. Have you tried a generated/scanned world? What happened, specifically?
3. Tell me about the last time physics in a world was wrong. How did you
   find out? What did the incident cost?
4. [Only now, the pitch — one sentence.] What would you actually consume:
   the report, the repaired file, or the emitted config? What would you
   *not* trust?
5. If this existed as a headless CLI today, what would stop you running
   it this week?
6. Who else should I talk to who has hit this? (The referral is the
   metric — a real "yes, talk to X" is stronger evidence than any praise.)

**Success criteria for the pitch claim "we talked to users":** 3+ real
conversations logged with names/dates; at least one incident story with a
cost figure; at least one "run it on MY world" offer. One real Dana-grade
quote on a slide outweighs this entire simulated panel.

## 5. What changes in the pitch (one line each)

- Lead the product sentence with the repaired copy and the CLI; the
  certificate is the evidence trail behind it.
- Add the recentering preflight (small build, big community hook).
- Say "SimReady Foundation checks assets; we certify *worlds* — splat
  fidelity, per-robot verdicts, repair" before a judge says it first.
- Quote the incident economics: intermittent physics lies masquerade as
  nav-stack bugs; scale errors surface weeks later in customer evals.
- Q&A ready: semantic lies (roadmap), repair provenance (ledger → mesh
  tags), periphery-widened uncertainty, GaussGym ("we certify their
  worlds too").
