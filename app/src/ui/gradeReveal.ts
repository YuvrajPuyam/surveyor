/**
 * Grade reveal — Beat 3's animated full-center grade letter (and the Beat-5
 * "F → A" before/after variant). CSS-transition based, no rAF bookkeeping.
 *
 * showGradeReveal resolves when the animation finishes or is skipped
 * (Space via skipGradeReveal(), or a click on the letter).
 */
import "./panels.css";

export interface GradeRevealOptions {
  /** Render "before → after" instead of a single letter (Beat 5). */
  before?: string;
  /** Element the letter flies toward when done (e.g. the sidebar badge). */
  flyTo?: HTMLElement;
  /** How long the letter holds center-screen before flying off. */
  holdMs?: number;
}

let activeSkip: (() => void) | undefined;

/** Skip the active reveal, if any. Returns true when one was skipped. */
export function skipGradeReveal(): boolean {
  if (!activeSkip) return false;
  activeSkip();
  return true;
}

export function showGradeReveal(
  grade: string,
  story: string,
  opts: GradeRevealOptions = {},
): Promise<void> {
  skipGradeReveal(); // never two at once
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "sv-reveal";

    const letters = document.createElement("div");
    letters.className = "sv-reveal-letters";
    if (opts.before) {
      const before = document.createElement("span");
      before.className = `sv-reveal-letter sv-reveal-before sv-grade-${opts.before}`;
      before.textContent = opts.before;
      letters.appendChild(before);
      const arrow = document.createElement("span");
      arrow.className = "sv-reveal-arrow";
      arrow.textContent = "→";
      letters.appendChild(arrow);
    }
    const letter = document.createElement("span");
    letter.className = `sv-reveal-letter sv-grade-${grade}`;
    letter.textContent = grade;
    letters.appendChild(letter);
    overlay.appendChild(letters);

    if (story) {
      const line = document.createElement("div");
      line.className = "sv-reveal-story";
      line.textContent = story;
      overlay.appendChild(line);
    }

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("sv-reveal-in"));

    let finished = false;
    let holdTimer = 0;

    const finish = (): void => {
      if (finished) return;
      finished = true;
      activeSkip = undefined;
      clearTimeout(holdTimer);
      // fly toward the sidebar (or the supplied element) and fade
      const from = letters.getBoundingClientRect();
      let tx = innerWidth - from.left - from.width / 2 - 210;
      let ty = -(from.top + from.height / 2 - 44);
      const target = opts.flyTo?.getBoundingClientRect();
      if (target && target.width > 0) {
        tx = target.left + target.width / 2 - (from.left + from.width / 2);
        ty = target.top + target.height / 2 - (from.top + from.height / 2);
      }
      letters.style.transform = `translate(${tx.toFixed(0)}px, ${ty.toFixed(0)}px) scale(0.14)`;
      overlay.classList.add("sv-reveal-out");
      window.setTimeout(() => {
        overlay.remove();
        resolve();
      }, 460);
    };

    activeSkip = finish;
    // pointer-events are off on the overlay so the world stays interactive;
    // the letter itself is clickable to skip.
    letters.style.pointerEvents = "auto";
    letters.addEventListener("click", finish);
    holdTimer = window.setTimeout(finish, (opts.holdMs ?? 1600) + 400);
  });
}
