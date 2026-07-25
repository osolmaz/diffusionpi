// diffusionpi hack: smooth viewport scroll.
//
// Pi's TUI renders the whole chat in one frame and its differential renderer
// appends every new line at once, so a diffusion commit (~a whole canvas,
// often 15+ lines) shoves the viewport up in a single jump. There is no
// public extension API over the chat container or the viewport, so this
// extension deliberately reaches into the live TUI instance (grabbed through
// a throwaway widget factory) and wraps the chat container's render() to
// reveal appended lines at a bounded rate instead of all at once. Real
// content, paced only at the render layer.
//
// This is version-sensitive by design: it checks that the component tree
// looks like Pi 0.8x (nine TUI children, chat at index 2) and no-ops
// otherwise, so a Pi upgrade degrades to the stock jumpy behavior rather
// than breaking.
//
// Tuning:
//   DIFFUSIONPI_SMOOTH_SCROLL=0        disable the hack
//   DIFFUSIONPI_SCROLL_SPEED=40        reveal rate in lines per second
//   DIFFUSIONPI_SCROLL_DEBUG=<path>    append per-frame pacing decisions to a file
import { appendFileSync } from "node:fs";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type RenderComponent = {
  render(width: number): string[];
  invalidate?(): void;
};

type TuiLike = {
  children: RenderComponent[];
  requestRender(force?: boolean): void;
};

type WidgetUi = {
  setWidget(
    key: string,
    content: ((tui: TuiLike, theme: unknown) => RenderComponent) | undefined
  ): void;
};

const enabled = process.env["DIFFUSIONPI_SMOOTH_SCROLL"] !== "0";
const linesPerSecond = positiveNumber(process.env["DIFFUSIONPI_SCROLL_SPEED"], 40);
const debugPath = process.env["DIFFUSIONPI_SCROLL_DEBUG"];

function debugLog(message: string): void {
  if (debugPath === undefined || debugPath === "") {
    return;
  }
  try {
    appendFileSync(debugPath, `${String(Date.now())} ${message}\n`);
  } catch {
    // Debug logging must never break rendering.
  }
}
// A growth this large is a session restore or theme redraw, not streaming:
// show it instantly instead of animating through it.
const snapThresholdLines = 300;
// Upper bound on the time credited between renders, so the first paced frame
// after an idle period does not instantly spend seconds of accumulated budget.
const maxTickSeconds = 0.1;
const catchUpDelayMs = 33;
const expectedTuiChildren = 9;
const chatChildIndex = 2;

function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export default function diffusionpiSmoothScroll(pi: ExtensionAPI): void {
  if (!enabled) {
    return;
  }
  let patched = false;
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || patched) {
      return;
    }
    patched = tryPatch(ctx);
  });
}

// The widget factory is invoked synchronously with the live TUI instance;
// registering and immediately removing a probe widget is the only way an
// extension can get its hands on the TUI outside a dialog.
function tryPatch(ctx: ExtensionContext): boolean {
  let tui: TuiLike | undefined;
  const ui = ctx.ui as unknown as WidgetUi;
  if (typeof ui.setWidget !== "function") {
    return false;
  }
  ui.setWidget("diffusionpi-smooth-scroll-probe", (liveTui) => {
    tui = liveTui;
    return { render: () => [], invalidate: () => undefined };
  });
  ui.setWidget("diffusionpi-smooth-scroll-probe", undefined);
  if (tui === undefined || !Array.isArray(tui.children)) {
    return false;
  }
  if (tui.children.length !== expectedTuiChildren) {
    return false;
  }
  const chat = tui.children[chatChildIndex];
  if (chat === undefined || typeof chat.render !== "function") {
    return false;
  }
  installPacer(tui, chat);
  debugLog("pacer installed");
  return true;
}

function installPacer(tui: TuiLike, chat: RenderComponent): void {
  const original = chat.render.bind(chat);
  let revealed = Number.POSITIVE_INFINITY; // first render snaps to full
  let lastWidth = -1;
  let lastTickAt = 0;
  let carry = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const scheduleCatchUp = (): void => {
    if (timer !== undefined) {
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      tui.requestRender();
    }, catchUpDelayMs);
  };

  chat.render = (width: number): string[] => {
    const lines = original(width);
    const now = Date.now();
    if (width !== lastWidth) {
      // Rewrap after a resize changes every line count; animating the reflow
      // would look like scrolling through the whole session.
      lastWidth = width;
      revealed = lines.length;
      return lines;
    }
    if (lines.length <= revealed || lines.length - revealed > snapThresholdLines) {
      revealed = lines.length;
      lastTickAt = now;
      carry = 0;
      return lines;
    }
    const dt = Math.min(maxTickSeconds, Math.max(0, (now - lastTickAt) / 1000));
    lastTickAt = now;
    carry += linesPerSecond * dt;
    const step = Math.floor(carry);
    carry -= step;
    revealed = Math.min(lines.length, revealed + step);
    debugLog(`pacing revealed=${String(revealed)} total=${String(lines.length)} step=${String(step)}`);
    if (revealed < lines.length) {
      scheduleCatchUp();
    }
    return lines.slice(0, revealed);
  };
}
