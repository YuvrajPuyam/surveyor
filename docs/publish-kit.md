# Publish kit — everything pre-written so publishing is one sitting

**Status: STAGED, NOT EXECUTED.** Publishing is outward-facing and
user-gated. When the go is given, work top to bottom; total ~30 minutes.
Rule from ENDGAME: the Devpost prints the **certificate content-hash**
(`6b2909f1c8daa84f0234921f4c1828118f7921a6dbfa734ade349b8a1bb467a2`),
generated on the exact demo laptop + browser that will re-hash it live —
re-verify on that machine before printing.

---

## 1. GitHub release (the code + small artifacts)

```bash
# from a clean main with tests green:
npm test
git tag -a v0.9-hackathon -m "Worlds in Action (SIGGRAPH 2026) submission"
git push origin main --tags
# create the release; attach the two videos (small enough for a release)
gh release create v0.9-hackathon \
  assets/isaac/g3c-box-lift.mp4 assets/isaac/g4-policy-lift.mp4 \
  --title "SURVEYOR v0.9 — the Certified World Pack" \
  --notes-file docs/publish-kit.md-release-notes   # section 1a below, saved to a file
```

### 1a. Release notes (paste)

> **SURVEYOR — an inspection and repair shop for AI-generated 3D worlds.**
>
> Generated worlds ship as photoreal splats plus an invisible physics
> collider that nobody checks against each other. SURVEYOR runs physical
> experiments inside the world (2,000 seeded probes, virtual LiDAR, two-way
> visual-vs-physics divergence, an image-depth audit), grades it per robot
> with uncertainty ranges, repairs it through an agent restricted to nine
> deterministic reversible tools, and compiles the certificate into
> executable Isaac Lab configuration.
>
> **The receipts in this release:**
> - Self-validation: recall 96.8% (95% CI ≥85.6%, n=31), precision 100%
>   (CI ≥90.5%); byte-identical certificates across runs and runtimes.
> - Agent repair: first real Marble world F→A, 75/75 outcomes recorded,
>   including an un-staged fail-revert-adapt. Replayable cassette included.
> - PhysX corroborates the Rapier-certified floor to 1 mm.
> - Scripted Franka pick-and-place at lunar gravity: set-down 0.3 mm from
>   the probe-measured surface (video attached).
> - NVIDIA's pretrained lift policy, zero training: delivers the crate to
>   2.6 cm of goal at lunar gravity in the certified world (video attached).
> - **The paired receipt: 15 identical navmesh routes, one controller —
>   raw world 0/15, repaired world 13/15.**
> - Certificate content-hash: `6b2909f1c8daa84f0234921f4c1828118f7921a6dbfa734ade349b8a1bb467a2`
>   — re-run the certification and get these exact bytes.
>
> Scope discipline: the grade predicts navmesh-level traversability under a
> disclosed model class — not policy transfer. Worlds generated using World
> Labs Marble ("Generated using World Labs").

## 2. Hugging Face (the pack — 121 MB, too big for git)

```bash
pip install -U huggingface_hub  # once
hf auth login                   # once (browser token)
hf repo create surveyor-certified-world-pack --repo-type dataset
hf upload surveyor-certified-world-pack assets/packs/artemis-supply-hab-pack . --repo-type dataset
```

### 2a. Dataset card (README.md on the HF repo — paste)

> # SURVEYOR Certified World Pack — artemis-supply-hab
>
> One AI-generated world (World Labs Marble), physically certified,
> repaired, and taken all the way to a working robot. Contents:
> - `world/` — Isaac-ready USD: NuRec splat visuals + repaired collider
>   (static tri-mesh) + verified spawn points + quarantine volumes. Drag
>   into Isaac Sim ≥5.1 and press Play.
> - `dataset/` — 500 labeled frames (RGB / depth / 2D boxes / semantic
>   seg), labeled objects at certificate-verified spawns, cameras confined
>   to certified free space; every rejected frame itemized in the manifest.
> - `policy/` — the pretrained rsl_rl lift checkpoint + inference reference
>   + two task videos (scripted 0.3 mm set-down; learned policy to 2.6 cm
>   of goal, both at lunar gravity).
> - `contract/` — the certificate compiled to executable training config
>   (spawns→resets, quarantine→termination masks, friction uncertainty→DR
>   ranges) + `paired-receipt.json`: **15 identical routes: raw 0/15,
>   repaired 13/15.**
> - `certificate.json` + self-validation appendix + `HASHES.txt` (header =
>   certificate content-hash).
>
> License: code Apache-2.0; world content "Generated using World Labs".
> Claim scope: navmesh-level traversability under a disclosed model class —
> not policy transfer.

## 3. Devpost page essentials

- Title: **SURVEYOR — the trust layer between world models and robot training**
- One-liner: *"World models generate the pixels. Surveyor certifies the
  physics. Isaac trains the robot. The certificate is the contract."*
- **Print the hash prominently:** `certificate content sha256: 6b2909f1c8daa84f0234921f4c1828118f7921a6dbfa734ade349b8a1bb467a2`
  with the line *"re-run the certification live and get these exact bytes —
  we'll do it on stage."*
- Links: GitHub release, HF pack, both videos.
- Disclosure sentence (pride, not fine print): *"The certifier core is a
  public open-source library we built and disclosed before the event; what
  we built at the event is the product around it."*
- Attribution: "Generated using World Labs" on world imagery; NASA credit
  line if any NASA-derived world ships.

## 4. Post-publish verification (10 min)

1. Fresh clone on another machine/folder → `npm install && npm test` green.
2. Download the HF pack → `HASHES.txt` verifies (`sha256sum -c` style spot-check).
3. On the DEMO LAPTOP + demo browser: run certify, confirm the sha matches
   the printed one. If it does not, STOP — the printed hash must be
   regenerated from the demo machine before judging (ENDGAME wording law).
