"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Pixels per second the roster drifts. */
const SPEED = 32;
/** Finger movement (px) after which a touch counts as a swipe, not a tap on the card. */
const SWIPE = 6;

/**
 * Drifts the roster right to left on a loop. Each card is moved on its own (a small layer
 * per card) and wraps from the left edge back round to the right, so there is no wide strip
 * at all: Safari painted the old 80-card strip in tiles that came out of step while it moved,
 * printing names over each other and doubling photos. Cards off screen are hidden.
 *
 * It pauses under the pointer, while a finger is down and while a link has focus. Fingers
 * and trackpads can push it either way. Without JavaScript, or with Reduce motion, the list
 * stays a plain row you scroll sideways (the CSS for that is the default).
 */
export function RosterRail({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const list = el?.querySelector("ul");
    if (!el || !list || matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    const cards = [...list.children] as HTMLElement[];
    if (!cards.length) return;
    el.dataset.drift = "";

    let step = 0,
      total = 0;
    const measure = () => {
      step =
        cards[0].offsetWidth +
        (parseFloat(getComputedStyle(list).columnGap) || 0);
      total = step * cards.length;
      list.style.height = `${Math.max(...cards.map((c) => c.offsetHeight))}px`;
    };

    let offset = 0;
    const place = () => {
      offset = ((offset % total) + total) % total;
      const width = el.clientWidth;
      cards.forEach((card, i) => {
        // From -step (just gone off the left) to total - step, so a card leaving on the left comes back on the right.
        const x =
          ((((i * step - offset + step) % total) + total) % total) - step;
        card.style.transform = `translate3d(${x}px,0,0)`;
        card.style.visibility = x < width ? "" : "hidden";
      });
    };

    let hover = false,
      focus = false,
      drag: { x: number; offset: number; moved: boolean } | null = null;
    let resumeAt = 0;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      // Keeps the same speed on slow or throttled frames; a long gap (tab in the background) doesn't jump.
      const dt = Math.min(now - last, 250) / 1000;
      last = now;
      if (!hover && !drag && !focus && now >= resumeAt) {
        offset += SPEED * dt;
        place();
      }
      frame = requestAnimationFrame(tick);
    };

    const onEnter = (e: PointerEvent) => {
      if (e.pointerType === "mouse") hover = true;
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType === "mouse") hover = false;
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse")
        drag = { x: e.clientX, offset, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > SWIPE) drag.moved = true;
      offset = drag.offset - dx;
      place();
    };
    // A swipe that ends on a card shouldn't open that artist's page.
    const swallow = (e: MouseEvent) => e.preventDefault();
    const onUp = () => {
      if (!drag) return;
      const swiped = drag.moved;
      drag = null;
      resumeAt = performance.now() + 1500; // a moment to read after letting go
      if (!swiped) return;
      el.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => el.removeEventListener("click", swallow, true), 400);
    };
    // Trackpads and sideways mouse wheels push the row; ordinary up-down scrolling passes through to the page.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      offset += e.deltaX;
      resumeAt = performance.now() + 1500;
      place();
    };
    // Tabbing to a card's link brings that card to the left edge.
    const onFocusIn = (e: FocusEvent) => {
      focus = true;
      const i = cards.findIndex((c) => c.contains(e.target as Node));
      if (i >= 0) {
        offset = i * step;
        place();
      }
    };
    const onFocusOut = () => {
      focus = false;
    };

    measure();
    place();
    const resize = new ResizeObserver(() => {
      measure();
      place();
    });
    resize.observe(el);
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("focusin", onFocusIn);
    el.addEventListener("focusout", onFocusOut);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("focusin", onFocusIn);
      el.removeEventListener("focusout", onFocusOut);
      el.removeEventListener("click", swallow, true);
      delete el.dataset.drift;
      list.style.height = "";
      cards.forEach((c) => {
        c.style.transform = "";
        c.style.visibility = "";
      });
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
