"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Logo } from "./logo";
import { usePlayer } from "./player-provider";
import { NAV } from "@/lib/station";
import styles from "./site-nav.module.css";

export function SiteNav() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const [docked, setDocked] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [section, setSection] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const { status, source, toggleLive } = usePlayer();
  const liveOn = source.kind === "live" && status === "playing";

  useEffect(() => {
    // The home page has a full-height hero to clear; other pages have a much
    // shorter header, so the bar docks sooner.
    const onScroll = () =>
      setDocked(window.scrollY > (isHome ? window.innerHeight * 0.82 : 260));
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isHome]);

  // Mark the section you're reading, so the nav says where you are.
  useEffect(() => {
    if (!isHome) return;

    const sections = NAV.filter((item) => item.href.startsWith("/#"))
      .map((item) => document.querySelector(item.href.slice(1)))
      .filter((el): el is Element => el !== null);
    if (!sections.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((e) => e.isIntersecting);
        if (hit) setSection(`/#${hit.target.id}`);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    sections.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [isHome, pathname]);

  // Section links only ever light up on the home page, so a stale value can't
  // leak across a navigation.
  const isActive = (href: string) =>
    href.startsWith("/#") ? isHome && section === href : pathname === href;

  /**
   * The sheet declares `aria-modal`, so it has to behave like one: focus moves
   * into it on open, Tab cycles inside it, Escape closes it, and focus returns
   * to the button that opened it.
   */
  useEffect(() => {
    if (!menuOpen) return;

    const sheet = sheetRef.current;
    const opener = burgerRef.current;
    document.body.style.overflow = "hidden";

    const focusable = () =>
      Array.from(
        sheet?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    focusable()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        return;
      }
      if (e.key !== "Tab") return;

      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === first || !sheet?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [menuOpen]);

  return (
    <>
      <header className={`${styles.bar} ${docked ? styles.docked : ""}`}>
        <div className={styles.inner}>
          <Link href="/" className={styles.brand} aria-label="Musicsquare Radio, home">
            <Logo collapsible compact={docked} tone={docked ? "light" : "dark"} />
          </Link>

          <nav className={styles.links} aria-label="Sections">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`mono ${styles.link} ${
                  isActive(item.href) ? styles.linkActive : ""
                }`}
                aria-current={isActive(item.href) ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className={styles.actions}>
            <button
              type="button"
              className={`btn ${styles.live}`}
              onClick={toggleLive}
              aria-pressed={liveOn}
            >
              <span className="pip" aria-hidden="true" />
              <span className={styles.liveLong}>
                {liveOn ? "Stop the stream" : "Listen live"}
              </span>
              <span className={styles.liveShort} aria-hidden="true">
                {liveOn ? "Stop" : "Live"}
              </span>
            </button>

            <button
              ref={burgerRef}
              type="button"
              className={styles.burger}
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              aria-expanded={menuOpen}
            >
              <span />
              <span />
            </button>
          </div>
        </div>
      </header>

      <div
        ref={sheetRef}
        className={`${styles.sheet} ${menuOpen ? styles.sheetOpen : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        hidden={!menuOpen}
      >
        <button
          type="button"
          className={`mono ${styles.close}`}
          onClick={() => setMenuOpen(false)}
        >
          Close
        </button>
        <nav className={styles.sheetLinks}>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              className="display"
              aria-current={isActive(item.href) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* The sheet covers the header, so playback has to be reachable here. */}
        <button
          type="button"
          className={`btn ${styles.sheetCta}`}
          onClick={() => {
            toggleLive();
            setMenuOpen(false);
          }}
        >
          <span className="pip" aria-hidden="true" />
          <span>{liveOn ? "Stop the stream" : "Listen live"}</span>
        </button>
      </div>
    </>
  );
}
