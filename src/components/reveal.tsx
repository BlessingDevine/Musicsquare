"use client";

import { useEffect, useRef } from "react";

/**
 * Adds `is-in` once an element scrolls into view, and then stops watching.
 * One observer per element, no scroll listeners.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("is-in");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return ref;
}

export function Reveal({
  children,
  className = "",
  as: Tag = "div",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "section" | "li" | "article";
  id?: string;
}) {
  const ref = useReveal<HTMLElement>();
  return (
    <Tag ref={ref as React.Ref<never>} id={id} className={`reveal ${className}`}>
      {children}
    </Tag>
  );
}
