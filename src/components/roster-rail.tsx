"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Pixels per second the roster drifts. */
const SPEED = 32;

/**
 * Drifts the roster right to left by scrolling the row itself, not by sliding one giant layer:
 * a strip that wide gets split into tiles that Safari repaints out of step, mixing up names.
 * The row holds two copies of the list, so at the halfway point it jumps back by one copy
 * without a visible seam. It pauses under the pointer, while a finger is down, and while a link
 * has focus, and people can still swipe or scroll it themselves. Reduced motion: no drift.
 */
export function RosterRail({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let pos = el.scrollLeft; // fractional position; scrollLeft itself may round to whole pixels
    let hover = false, touch = false, focus = false;
    let resumeAt = 0;
    let last = performance.now();
    let frame = 0;

    const wrap = () => {
      const half = el.scrollWidth / 2;
      if (pos >= half) pos -= half;
      if (pos < 0) pos += half;
    };

    const tick = (now: number) => {
      // Keeps the same speed on slow or throttled frames; a long gap (tab in the background) doesn't jump.
      const dt = Math.min(now - last, 250) / 1000;
      last = now;
      if (!hover && !touch && !focus && now >= resumeAt) {
        pos += SPEED * dt;
        wrap();
        el.scrollLeft = pos;
      }
      frame = requestAnimationFrame(tick);
    };

    // When people scroll it themselves, carry on from where they left it.
    const onScroll = () => {
      if (Math.abs(el.scrollLeft - pos) > 2) {
        pos = el.scrollLeft;
        wrap();
        if (pos !== el.scrollLeft) el.scrollLeft = pos;
      }
    };
    const onEnter = (e: PointerEvent) => { if (e.pointerType === "mouse") hover = true; };
    const onLeave = (e: PointerEvent) => { if (e.pointerType === "mouse") hover = false; };
    const onDown = (e: PointerEvent) => { if (e.pointerType !== "mouse") touch = true; };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      touch = false;
      resumeAt = performance.now() + 1500; // a moment to read after letting go
    };
    const onFocusIn = () => { focus = true; };
    const onFocusOut = () => { focus = false; };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("focusin", onFocusIn);
    el.addEventListener("focusout", onFocusOut);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("focusin", onFocusIn);
      el.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
