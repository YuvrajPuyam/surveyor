export const meta = {
  name: 'scifi-panel-system-design',
  description: 'Design a sci-fi game-style panel/window system (minimize/expand/maximize) for the SURVEYOR viewer',
  phases: [
    { title: 'Concepts', detail: '4 independent design directions' },
    { title: 'Judge', detail: '3 lenses score all concepts' },
  ],
}

const CONCEPT_SCHEMA = {
  type: 'object',
  required: ['name', 'pitch', 'visualLanguage', 'panelSystem', 'beatChoreography', 'animationLanguage', 'keyboardMap', 'cssTechniques', 'signatureMoment', 'risks'],
  properties: {
    name: { type: 'string', description: 'Short evocative name for the direction' },
    pitch: { type: 'string', description: '2-3 sentences selling the direction' },
    visualLanguage: { type: 'string', description: 'Palette (hex values), typography, shape grammar, texture/effects — concrete' },
    panelSystem: { type: 'string', description: 'The window-state machine: every state a panel can be in (minimized/docked/expanded/maximized/etc), where each state lives on screen, what a panel shows in each state, how states transition. Map EVERY real SURVEYOR panel into this system.' },
    beatChoreography: { type: 'string', description: 'Per beat (1-5): which panels auto-promote/demote to which states, so the flow drives the windows' },
    animationLanguage: { type: 'string', description: 'The 3-5 signature motions (materialize, minimize, focus...), with rough CSS technique + duration each' },
    keyboardMap: { type: 'string', description: 'Keys for window management that do NOT collide with existing: W wireframe, B boxes, F flip, I inside/orbit, D dev, Space/arrows/1-5 stepper' },
    cssTechniques: { type: 'string', description: 'How to build it in vanilla CSS/TS, no external assets/fonts/libs: clip-path chamfers, gradients, masks, etc.' },
    signatureMoment: { type: 'string', description: 'The single most memorable interaction — the thing a hackathon judge remembers' },
    risks: { type: 'string', description: 'Where this direction could hurt legibility, performance, or the 3:00 demo' },
  },
  additionalProperties: false,
}

const JUDGE_SCHEMA = {
  type: 'object',
  required: ['scores', 'winner', 'grafts'],
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        required: ['concept', 'legibility', 'implementability', 'flowCoherence', 'wow', 'total', 'notes'],
        properties: {
          concept: { type: 'string' },
          legibility: { type: 'number', description: '0-10' },
          implementability: { type: 'number', description: '0-10' },
          flowCoherence: { type: 'number', description: '0-10' },
          wow: { type: 'number', description: '0-10' },
          total: { type: 'number' },
          notes: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    winner: { type: 'string' },
    grafts: { type: 'array', items: { type: 'string' }, description: 'Specific ideas from non-winning concepts worth grafting onto the winner' },
  },
  additionalProperties: false,
}

const CONTEXT = `
PRODUCT — SURVEYOR (hackathon demo, D:\\worlds-in-action): a browser inspection/repair
tool for AI-generated 3D worlds. A photoreal gaussian-splat world renders full-screen
(three.js); a teal collider wireframe can overlay it. The UI walks a five-beat flow
(bottom-center stepper rail, top-center one-line narrator bar):
 Beat 1 Meet the world (intro card, "Reveal the physics")
 Beat 2 Survey (live trust map paints on the ground: green confirmed / yellow observed
        / red divergent; trust legend chips with live counts; narrator cycles progress)
 Beat 3 Certificate (full-screen grade letter reveal flies into a right sidebar panel:
        grade badge + story line + 5 collapsible sections: TRUST, ROBOT VERDICTS,
        DEFECTS (28 entries, severity chips), MEASUREMENTS (values with uncertainty
        ranges), FINE PRINT)
 Beat 4 Repair (plan cards: "Fix the world's size (x1.615)", "Patch Hole #1",
        "Rope off 11 ghost surfaces", "Leave 2 sills as they are"; each card runs,
        can fail inspection — a LOUD fail-and-adapt banner ("Our own repair just
        failed inspection") with revert/retry sub-rows; collapsed "Show the work"
        raw log expander)
 Beat 5 Certified (F -> A before/after card, rover patrol drives the world, export button)
Also: an fps/steps HUD, a dev-mode (D) that shows raw machine strings under human ones.
Terminology rules: trust states are confirmed/observed/divergent; defect classes are
"ghost geometry" and "phantom colliders". NEVER the word "lying".
Existing keys (must not collide): W wireframe, B defect boxes, F flip, I inside/orbit,
D dev mode, Space/Enter advance, arrows/N/1-5 stepper.
Stack: vanilla TypeScript + hand-written CSS (app/src/ui/panels.css), no UI framework,
no external assets (fonts/images/libs) — everything must be CSS/SVG/canvas drawn.
Audience: hackathon judges at SIGGRAPH; the demo laptop projects at distance —
legibility beats density; the world must stay the hero (panels frame it, not bury it).

THE ASK (from the user): "a panel that can be enlarged, or multiple panels that can be
maximized/minimised for the flow — think of a sci-fi game based UI." Design a
window-management system: panels as sci-fi console modules with states like minimized
dock chips, standard cards, an enlarged focus state, maybe a fullscreen takeover —
with the five-beat flow auto-choreographing which panel is where, and the user free
to promote/demote any panel at any time.`

phase('Concepts')
const DIRECTIONS = [
  { key: 'diegetic-console', angle: `DIEGETIC SHIP CONSOLE — the UI pretends to be the survey vessel's own instrument console (think Alien: Isolation / Elite Dangerous cockpit): CRT phosphor glow, scanline hints, chunky bezels, panels as physical instrument modules that slide/flip out of an equipment rail. Design for tactility — panels feel mechanically docked/undocked.` },
  { key: 'tactical-glass', angle: `TACTICAL GLASS HUD — modern AAA shooter/space-sim glass (Destiny 2 / Titanfall / Halo Infinite): translucent frosted panels with chamfered corners, thin luminous strokes, floating in z-depth layers over the world; minimize = panels collapse into edge-docked holo-tabs with live micro-stats. Design for elegance and depth (backdrop-filter, parallax).` },
  { key: 'fui-motion', angle: `CINEMA FUI — Territory Studio / Interstellar / The Expanse operations screens: data-dense cards with fine hairline grids, technical annotations, reticles and callout leader-lines that physically point INTO the 3D world (defect boxes get screen-space callouts), panels as briefing layers. Design for the feeling that the world itself is annotated by the instrument.` },
  { key: 'command-deck', angle: `RTS COMMAND DECK — StarCraft/Homeworld command console: a persistent bottom "deck" of module slots; panels live as deck modules that can be promoted to a large center-stage viewer one at a time (like selecting a unit group), everything else stays as compact live-status modules. Design for one-panel-at-a-time clarity and muscle-memory hotkeys.` },
]
const concepts = (await parallel(DIRECTIONS.map(d => () =>
  agent(`${CONTEXT}

YOUR DIRECTION (commit to it fully; do not hedge toward a generic middle): ${d.angle}

Produce a complete, implementable design via the schema. Be concrete everywhere:
real hex colors, real durations, real clip-path ideas, the exact dock geometry,
what a minimized DEFECTS chip shows live during Beat 2, what maximize does to the
certificate on Beat 3, how the fail-and-adapt banner behaves in your system, and
your signature moment. Every real panel listed in the context must have a home in
every window state.`, { label: `concept:${d.key}`, phase: 'Concepts', schema: CONCEPT_SCHEMA, effort: 'high' })
))).filter(Boolean)

log(`${concepts.length}/4 concepts delivered`)

phase('Judge')
const conceptsText = concepts.map((c, i) => `--- CONCEPT ${i + 1}: ${c.name} ---
PITCH: ${c.pitch}
VISUAL: ${c.visualLanguage}
PANEL SYSTEM: ${c.panelSystem}
BEAT CHOREOGRAPHY: ${c.beatChoreography}
ANIMATION: ${c.animationLanguage}
KEYS: ${c.keyboardMap}
CSS: ${c.cssTechniques}
SIGNATURE: ${c.signatureMoment}
RISKS: ${c.risks}`).join('\n\n')

const LENSES = [
  { key: 'stage', lens: 'DEMO-STAGE LEGIBILITY: projected at distance for 3 minutes to SIGGRAPH judges; the world is the hero; every number must be readable; motion must clarify, not distract. Penalize anything that buries the splat view or adds visual noise to a serious measurement instrument.' },
  { key: 'build', lens: 'IMPLEMENTABILITY & PERFORMANCE: vanilla TS/CSS on top of an existing codebase (panels.css, stepper.ts, certificatePanel.ts, repairPanel.ts already exist), no external assets, must not cost WebGL frame budget (57-119 fps today), realistically buildable + polishable in about a day. Penalize backdrop-filter abuse over a full-screen WebGL canvas, per-frame JS layout work, and rewrites of working panels.' },
  { key: 'flow', lens: 'FLOW COHERENCE & GAME-FEEL AUTHENTICITY: does the window system make the five-beat story CLEARER (each beat naturally spotlights its panel)? Does it feel like a real sci-fi game UI rather than CSS glitter? Is manual promote/demote discoverable and satisfying? Penalize choreography that fights the stepper or window states without a clear purpose.' },
]
const verdicts = (await parallel(LENSES.map(l => () =>
  agent(`You are one judge on a three-judge panel scoring sci-fi UI design concepts for a hackathon demo tool. ${CONTEXT}

YOUR LENS (score primarily through this): ${l.lens}

Score all ${concepts.length} concepts 0-10 on legibility, implementability, flowCoherence, wow (total = sum), pick a winner through YOUR lens, and list specific graft-worthy ideas from the non-winners. Judge the concepts as written — do not redesign them.

${conceptsText}`, { label: `judge:${l.key}`, phase: 'Judge', schema: JUDGE_SCHEMA, effort: 'high' })
))).filter(Boolean)

return { concepts, verdicts }