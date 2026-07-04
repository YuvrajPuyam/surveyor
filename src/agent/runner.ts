/**
 * Repair-agent loop: Anthropic Messages API + the closed tool menu + the
 * replay cassette. Every episode records to JSONL; replay mode re-prints a
 * recorded episode with zero network and zero API spend — the dead-wifi
 * fallback and the deterministic demo mode are the same artifact.
 *
 * Prompt-caching discipline: the system prompt and tool definitions are
 * byte-stable (cache breakpoint on the system block); volatile world state
 * only ever enters through tool results.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import type { RepairEngine } from "../repair/engine.js";
import { TraceRecorder } from "../trace/cassette.js";
import { dispatchTool, REPAIR_TOOLS } from "./tools.js";

export const REPAIR_SYSTEM_PROMPT = `You are the Repair agent for a 3D-world inspection and repair instrument. The certificate lists defects with evidence. You diagnose root causes, choose repairs from a CLOSED MENU of reversible, deterministic operations, and every action is verified by re-inspection before it counts. You never edit geometry directly — tools operate; you diagnose, choose, and adapt.

I'm repairing this world so it can be re-certified and used for robot training. A repair that silently breaks something else is worse than no repair — that is why re-certification, not your judgment, decides success.

The loop, per defect: DIAGNOSE -> PLAN -> ACT -> RECERTIFY(regional) -> pass -> next defect; fail -> REVERT + ADAPT (max 2 attempts) -> exhausted -> QUARANTINE or ESCALATE. Every defect must end in exactly one recorded outcome: fixed, quarantined, escalated, or accepted. Accepted means you conclude the finding is correct as-is (a genuinely raised sill is a robot-relative verdict, not a defect to fix). No defect may be silently dropped.

Diagnosis before action. The same symptom has different root causes with different correct repairs: check whether a global mis-scale explains multiple defects before patching them individually; a genuinely narrow or raised feature needs NO action (outcome=accepted); carve_opening is only for phantom collider geometry with no visual support. Pick the discriminating measurement first, then act.

Hard rules:
- Never assert a number a tool didn't measure. Audit every claim in your report against a tool result from this session.
- Don't fix beyond the task: repair listed defects; do not tidy or improve anything nobody asked for.
- A failed repair is information: revert, read the new evidence, adapt. Report the failure and the adaptation.
- You are operating autonomously. Proceed without asking — everything on your menu reverts. End your turn only when every defect has an outcome and you have run rebuild_navmesh_and_spawns and a final recertify(full).
- Final summary: outcome first (grade before -> after, defects by outcome), then per-defect detail in complete sentences, for someone who did not watch the loop run.`;

export interface EpisodeOptions {
  model?: string;
  maxTurns?: number;
  cassettePath?: string;
  verbose?: boolean;
}

export interface EpisodeResult {
  turns: number;
  toolCalls: number;
  finalText: string;
  openDefects: number;
  stopReason: string | null;
}

export async function runRepairEpisode(engine: RepairEngine, opts: EpisodeOptions = {}): Promise<EpisodeResult> {
  const model = opts.model ?? process.env.SURVEYOR_AGENT_MODEL ?? "claude-sonnet-5";
  const maxTurns = opts.maxTurns ?? 24;
  const recorder = opts.cassettePath ? new TraceRecorder(`repair-${Date.now()}`, opts.cassettePath) : null;
  const log = (s: string) => opts.verbose !== false && console.log(s);

  const client = new Anthropic(); // ANTHROPIC_API_KEY / ant-profile resolution
  const initialCert = engine.getCertificate();
  recorder?.note(`episode start: world ${initialCert.worldId}, grade ${initialCert.grade}, ${initialCert.defects.length} defects`);

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Repair world '${initialCert.worldId}'. Start from get_certificate. Work every defect to an outcome, then rebuild spawns and run a final full recertification, and report.`,
    },
  ];

  const tools: Anthropic.Tool[] = REPAIR_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool.InputSchema,
  }));

  let turns = 0;
  let toolCalls = 0;
  let finalText = "";
  let stopReason: string | null = null;

  while (turns < maxTurns) {
    turns++;
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: [{ type: "text", text: REPAIR_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools,
      messages,
    });
    stopReason = response.stop_reason;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        recorder?.note(block.text);
        log(`\n[agent] ${block.text}`);
        finalText = block.text;
      } else if (block.type === "tool_use") {
        toolCalls++;
        log(`[tool]  ${block.name} ${JSON.stringify(block.input)}`);
        let result: unknown;
        try {
          result = recorder
            ? await recorder.record(block.name, block.input, () => dispatchTool(engine, block.name, block.input))
            : await dispatchTool(engine, block.name, block.input);
        } catch (e) {
          result = { error: (e as Error).message };
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
          ...(typeof result === "object" && result && "error" in result ? { is_error: true } : {}),
        });
      }
    }

    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "tool_use" && toolResults.length > 0) {
      messages.push({ role: "user", content: toolResults });
    } else {
      break; // end_turn (or refusal/max_tokens — surfaced via stopReason)
    }
  }

  const open = engine.openDefects().length;
  recorder?.note(`episode end: ${turns} turns, ${toolCalls} tool calls, ${open} open defects`);
  return { turns, toolCalls, finalText, openDefects: open, stopReason };
}

/** Replay a recorded episode to stdout — no network, no LLM, no API key. */
export function replayEpisode(cassettePath: string, delayMs = 0): void {
  const lines = readFileSync(cassettePath, "utf-8")
    .split("\n")
    .filter((l) => l.trim());
  for (const line of lines) {
    const ev = JSON.parse(line);
    if (ev.kind === "note") console.log(`\n[agent] ${ev.name}`);
    else if (ev.kind === "tool_call") console.log(`[tool]  ${ev.name} ${JSON.stringify(ev.args)}`);
    else if (ev.kind === "tool_result") {
      const s = JSON.stringify(ev.result);
      console.log(`[result] ${s.length > 300 ? s.slice(0, 300) + "…" : s}`);
    }
    if (delayMs > 0) {
      const end = Date.now() + delayMs;
      while (Date.now() < end) {
        /* paced playback for on-stage replay */
      }
    }
  }
}
