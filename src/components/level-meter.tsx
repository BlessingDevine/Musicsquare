"use client";

import { useEffect, useRef } from "react";
import styles from "./level-meter.module.css";

// Enough bars to cross the widest screen; the ones that don't fit are clipped. Each gets a fixed
// pseudo-random resting height and pace, so the meter looks the same on every visit. The same
// meter runs on squaredrum.com's "Always on air" panel.
const BARS = Array.from({ length: 140 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  return { h: 0.3 + r(1) * 0.7, s: 0.8 + r(2) * 0.9 };
});

/**
 * A faint gold level meter along the bottom of the hero, made of the logo's
 * rounded bars. Only moves while on screen; "reduce motion" stands it still.
 */
export function LevelMeter() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => el.classList.toggle(styles.on, e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div className={styles.meter} ref={ref} aria-hidden="true">
      {BARS.map(({ h, s }, i) => (
        <i key={i} style={{ "--h": h.toFixed(2), "--s": `${s.toFixed(2)}s`, "--d": `${(-i * 0.37).toFixed(2)}s` } as React.CSSProperties} />
      ))}
    </div>
  );
}
