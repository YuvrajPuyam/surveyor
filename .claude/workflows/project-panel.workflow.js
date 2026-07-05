export const meta = {
  name: 'project-panel',
  description: 'Advisory panel: criticizer + upgrader review SURVEYOR in parallel, resolver synthesizes a ship-a-polished-product plan',
  whenToUse: 'Run occasionally when the project has moved meaningfully (new feature, pivot, pre-demo). Pass args {date, focus, previousReport}.',
  phases: [
    { title: 'Panel', detail: 'criticizer and upgrader work independently' },
    { title: 'Resolve', detail: 'resolver merges both into one actionable plan' },
  ],
}

const date = (args && args.date) || 'undated'
const focus = (args && args.focus) || 'No specific focus. Assess the whole project as it stands.'
const previousReport = (args && args.previousReport) || 'none'

const SHARED_BRIEF = [
  'You are one seat on a recurring three-agent advisory panel for SURVEYOR,',
  'a hackathon project in the git repo at D:\\worlds-in-action.',
  '',
  'MANDATORY reading before you form any opinion:',
  '1. HANDOFF.md (repo root) — the single self-contained project brief.',
  '2. docs/hackathon-context.md — the event, tracks, judges, prizes.',
  '3. PLAN.md and docs/demo-five-beats.md — execution plan and demo script.',
  previousReport === 'none'
    ? 'This is the FIRST panel run; there is no previous report.'
    : 'Previous panel report to diff against (read it; say what got fixed vs. persists): ' + previousReport,
  '',
  'Current focus note from the maintainer: ' + focus,
  '',
  'Dig deeper wherever your argument needs evidence: docs/, src/certify/,',
  'app/src/, assets/marble/*/certificate.json, test/. You may run cheap',
  'read-only commands (npm test, npx tsx scripts/self-validate.ts).',
  'HARD RULES: do NOT modify, create, or delete any repo file; do NOT spend',
  'Marble API credits (no scripts/marble.ts generate/pano calls); do NOT launch',
  'claude -p agent episodes. Vocabulary: never say a world is "lying" — use',
  'confirmed/observed/divergent, ghost geometry, phantom colliders.',
  '',
  'Your final output must go through the StructuredOutput tool. Be concrete:',
  'every claim tied to a file, number, or observed behavior — no generic advice',
  'that could apply to any project.',
].join('\n')

const CRITIQUE_SCHEMA = {
  type: 'object',
  required: ['findings', 'biggest_risk'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['area', 'severity', 'title', 'detail'],
        properties: {
          area: { type: 'string', enum: ['concept', 'feasibility', 'usability'] },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          title: { type: 'string' },
          detail: { type: 'string', description: 'The flaw, the mechanism, and the evidence (files/numbers)' },
          evidence: { type: 'string', description: 'file paths, metrics, or observed behavior backing this' },
        },
      },
    },
    biggest_risk: { type: 'string', description: 'The single thing most likely to sink the demo or the product' },
    previous_findings_status: { type: 'string', description: 'If a previous report existed: which of its findings are fixed vs persist' },
  },
}

const UPGRADE_SCHEMA = {
  type: 'object',
  required: ['hackathon', 'product', 'moonshots'],
  properties: {
    hackathon: {
      type: 'array',
      description: 'Upgrades landable before demo day that raise the ceiling of the pitch',
      items: {
        type: 'object',
        required: ['title', 'pitch', 'effort'],
        properties: {
          title: { type: 'string' },
          pitch: { type: 'string', description: 'What it is and the moment it creates in the demo' },
          why_it_wins: { type: 'string', description: 'Which track/judging instinct it hits' },
          effort: { type: 'string', enum: ['S', 'M', 'L'] },
        },
      },
    },
    product: {
      type: 'array',
      description: 'The weeks-after version: what SURVEYOR becomes as a real product',
      items: {
        type: 'object',
        required: ['title', 'pitch'],
        properties: {
          title: { type: 'string' },
          pitch: { type: 'string' },
          why_it_wins: { type: 'string' },
          effort: { type: 'string', enum: ['S', 'M', 'L'] },
        },
      },
    },
    moonshots: {
      type: 'array',
      description: 'The final-product ambition: where this goes if everything works',
      items: {
        type: 'object',
        required: ['title', 'pitch'],
        properties: {
          title: { type: 'string' },
          pitch: { type: 'string' },
          why_it_wins: { type: 'string' },
        },
      },
    },
  },
}

const RESOLUTION_SCHEMA = {
  type: 'object',
  required: ['headline', 'top_actions', 'report_markdown'],
  properties: {
    headline: { type: 'string', description: 'One sentence: overall state + the most important move now' },
    top_actions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'why', 'acceptance'],
        properties: {
          title: { type: 'string' },
          why: { type: 'string', description: 'Which critique it fixes or which upgrade it lands' },
          acceptance: { type: 'string', description: 'Observable criterion for done' },
        },
      },
    },
    report_markdown: { type: 'string', description: 'The full panel report, saved verbatim to docs/panel/. Complete markdown document.' },
  },
}

phase('Panel')
log('Criticizer and upgrader reviewing independently…')

const [critique, upgrades] = await parallel([
  () =>
    agent(
      SHARED_BRIEF +
        '\n\nSEAT: CRITICIZER. Your job is to find the MAJOR flaws — the things a' +
        '\nskeptical judge, a robotics customer, or a first-time viewer would hit.' +
        '\nCover all three areas and label each finding:' +
        '\n- CONCEPT: is "a physics certificate for AI-generated worlds" actually' +
        '\n  compelling and defensible? Where does the story break? Is the' +
        '\n  certificate trustworthy by its own standards (self-validation, CIs,' +
        '\n  the outdoor misfires in HANDOFF.md §5)? Would World Labs or a robotics' +
        '\n  lab dispute the premise?' +
        '\n- FEASIBILITY: demo-day risk (live browser demo, fps, worker timing,' +
        '\n  agent episodes billing a Max subscription, ~1,000 Marble credits left),' +
        '\n  the outdoor calibration failures (moon 81% probes fell through, canyon' +
        '\n  98.5%), confirmed-but-unfixed review findings in docs/review-triage-todo.md,' +
        '\n  and anything in the 2-day hackathon format that the plan underestimates.' +
        '\n- USABILITY: walk the five-beat UX as a cold viewer (docs/demo-five-beats.md,' +
        '\n  app/src/ui/). Where does a non-expert get lost? Is the humanize layer' +
        '\n  enough? Do grade F worlds read as "broken product" instead of "honest' +
        '\n  instrument"?' +
        '\nRank findings by severity. Do not pad: only flaws that materially change' +
        '\nan outcome. Aim for the 8-15 that matter, not an exhaustive lint.',
      { label: 'criticizer', phase: 'Panel', schema: CRITIQUE_SCHEMA }
    ),
  () =>
    agent(
      SHARED_BRIEF +
        '\n\nSEAT: UPGRADER. Your job is ambition — assume the flaws get fixed and' +
        '\nask what makes this UNFORGETTABLE. Three horizons:' +
        '\n- HACKATHON (landable by ~Jul 18): what creates the gasp moment in the' +
        '\n  demo room? Build on what exists: the live F-to-A agent repair, the' +
        '\n  fail-and-adapt beat, determinism (byte-identical certificates), the' +
        '\n  gravity falsification idea in HANDOFF.md §7, the Isaac Lab contract' +
        '\n  export. Think about the six tracks and sponsor tech in' +
        '\n  docs/hackathon-context.md — which prize are we actually gunning for' +
        '\n  and what tips it?' +
        '\n- PRODUCT (the weeks after): SURVEYOR as something real teams adopt.' +
        '\n  Who pays, for what workflow, integrated where (docs/customer-discovery.md,' +
        '\n  docs/pipeline-v2.md)?' +
        '\n- MOONSHOTS (the final product): certification as infrastructure for the' +
        '\n  sim-to-real economy. Be genuinely ambitious but keep each idea grounded' +
        '\n  in a capability the repo already demonstrates.' +
        '\nEvery idea: what it is, the moment/value it creates, why it wins, effort.' +
        '\nQuality over quantity — 4-6 per horizon, each one you would defend.',
      { label: 'upgrader', phase: 'Panel', schema: UPGRADE_SCHEMA }
    ),
])

if (!critique && !upgrades) {
  return { date, error: 'Both panel seats failed or were skipped; nothing to resolve.' }
}

phase('Resolve')
log('Resolver synthesizing critique + upgrades into one plan…')

const resolution = await agent(
  SHARED_BRIEF +
    '\n\nSEAT: RESOLVER. The other two seats have reported. Your job: reconcile' +
    '\nthem into ONE plan whose end state is a complete, finished, POLISHED' +
    '\nproduct — demo-ready first, product-ready behind it. You are the editor:' +
    '\nreject critique findings that are wrong (say why), merge duplicates,' +
    '\ndecline upgrades that endanger polish, and sequence what remains.' +
    '\n\nCRITICIZER OUTPUT:\n' +
    JSON.stringify(critique, null, 2) +
    '\n\nUPGRADER OUTPUT:\n' +
    JSON.stringify(upgrades, null, 2) +
    '\n\nVerify against the repo anything you doubt before ruling on it.' +
    '\nProduce report_markdown as a complete standalone document with exactly' +
    '\nthese sections:' +
    '\n# SURVEYOR panel report — ' + date +
    '\n## Verdict (3-5 sentences: state of the project, distance to "polished")' +
    '\n## Critical fixes (must happen; each: what, why, acceptance criterion)' +
    '\n## Polish list (finish quality: UX wording, edge cases, demo resilience)' +
    '\n## Adopted upgrades (which upgrader ideas made the cut and where they slot)' +
    '\n## Rejected / deferred (findings and ideas you overruled, one line of why each)' +
    '\n## Sequenced roadmap to demo day (~Jul 18) (ordered, with rough day targets)' +
    '\n## Definition of done for the demo (checklist a stranger could verify)' +
    '\nEvery item must trace back to a specific critique finding or upgrade —' +
    '\nno new ideas of your own unless flagged as [resolver addition].',
  { label: 'resolver', phase: 'Resolve', effort: 'high', schema: RESOLUTION_SCHEMA }
)

return { date, critique, upgrades, resolution }
