/**
 * Stepper — the five-beat rail (docs/ui-redesign-spec.md §1).
 *
 * Owns: the bottom-center rail DOM, the top-center narrator bar, the
 * primary-action hint line, and the beat keyboard map (→ ← N 1-5 Space
 * Enter). Does NOT own W/T/P/B/F/I/D — those stay in main.ts so existing
 * behavior is untouched.
 */
import "./panels.css";
import { BEAT_LABELS } from "./humanize";

export type Beat = 1 | 2 | 3 | 4 | 5;

export interface StepperOptions {
  /** Called when a beat becomes current. Host shows/hides UI here. */
  onEnter(beat: Beat, from: Beat): void;
  /** Space / primary button pressed while `beat` is current. */
  onPrimary(beat: Beat): void;
  /** Return false to refuse a forward jump (e.g. beat 3 before survey done). */
  canEnter(beat: Beat): boolean;
}

export interface StepperHandle {
  el: HTMLElement; // the rail
  current: Beat;
  go(beat: Beat): void; // respects canEnter for forward moves
  advance(): void; // go(current+1)
  back(): void;
  /** Set the Space-hint line, e.g. "Space — run the repair plan". */
  setPrimaryHint(text: string): void;
  /** Narrator bar (top-center). Empty string hides it. */
  narrate(text: string): void;
  /** Pulse the next dot when the beat's exit condition is met. */
  armAdvance(on: boolean): void;
  destroy(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** True when the key event targets a form control — never steal its keys. */
function isUiTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || t.isContentEditable
  );
}

export function mountStepper(parent: HTMLElement, opts: StepperOptions): StepperHandle {
  // ---- narrator bar (top-center)
  const narrator = el("div", "sv-narrator");
  narrator.style.display = "none";
  parent.appendChild(narrator);

  // ---- rail (bottom-center)
  const rail = el("div", "sv-stepper");
  const dotsRow = el("div", "sv-stepper-rail");
  rail.appendChild(dotsRow);
  const hint = el("div", "sv-stepper-hint");
  hint.style.display = "none";
  rail.appendChild(hint);
  parent.appendChild(rail);

  interface DotView {
    btn: HTMLButtonElement;
    dot: HTMLElement;
  }
  const dots: DotView[] = [];
  for (let i = 1 as Beat; i <= 5; i = (i + 1) as Beat) {
    const beat = i;
    const btn = el("button", "sv-stepper-item") as HTMLButtonElement;
    const dot = el("span", "sv-stepper-dot");
    btn.appendChild(dot);
    btn.appendChild(el("span", "sv-stepper-label", `${beat} ${BEAT_LABELS[beat - 1]}`));
    btn.addEventListener("click", () => {
      btn.blur(); // keep Space owned by the stepper, not the focused button
      go(beat);
    });
    dotsRow.appendChild(btn);
    dots.push({ btn, dot });
  }

  let current: Beat = 1;
  let armed = false;

  function renderDots(): void {
    for (let i = 0; i < dots.length; i++) {
      const beat = (i + 1) as Beat;
      const v = dots[i];
      v.btn.classList.toggle("sv-stepper-current", beat === current);
      v.btn.classList.toggle("sv-stepper-done", beat < current);
      v.btn.classList.toggle("sv-stepper-future", beat > current);
      v.dot.classList.toggle("sv-stepper-armed", armed && beat === current + 1);
    }
  }
  renderDots();

  function go(beat: Beat): void {
    if (beat === current) return;
    if (beat > current && !opts.canEnter(beat)) return; // host narrates the refusal
    const from = current;
    current = beat;
    armed = false;
    renderDots();
    opts.onEnter(beat, from);
  }

  function advance(): void {
    if (current < 5) go((current + 1) as Beat);
  }

  function back(): void {
    if (current > 1) go((current - 1) as Beat);
  }

  function onKey(e: KeyboardEvent): void {
    if (isUiTarget(e)) return;
    const k = e.key;
    // arrows belong to camera flight (main.ts WASD/arrow navigation);
    // beats advance on N / Space / Enter / 1–5
    if (k === "n" || k === "N") {
      advance();
    } else if (k.length === 1 && k >= "1" && k <= "5") {
      go(Number(k) as Beat);
    } else if (k === " " || k === "Enter") {
      e.preventDefault();
      opts.onPrimary(current);
    }
  }
  addEventListener("keydown", onKey);

  const handle: StepperHandle = {
    el: rail,
    get current() {
      return current;
    },
    go,
    advance,
    back,
    setPrimaryHint(text: string): void {
      hint.textContent = text;
      hint.style.display = text ? "" : "none";
    },
    narrate(text: string): void {
      narrator.textContent = text;
      narrator.style.display = text ? "" : "none";
    },
    armAdvance(on: boolean): void {
      armed = on;
      renderDots();
    },
    destroy(): void {
      removeEventListener("keydown", onKey);
      rail.remove();
      narrator.remove();
    },
  };
  return handle;
}
