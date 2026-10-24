import type { Metadata } from "next";
import { Lineup, Record } from "@/components/lineup";
import { ALL_BLOCKS, WEEK } from "@/lib/station";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Schedule",
  description:
    "Your week on Musicsquare Radio: every programme, day by day, from Afro Mix at midnight to Sunday Church. Times are shown in your own timezone.",
};

const hhmm = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;

export default function SchedulePage() {
  return (
    <main>
      <header className={`on-ink ${styles.header}`}>
        <div className={`wrap ${styles.heroGrid}`}>
          <div>
            <p className="mono eyebrow">Good music. All week long.</p>
            <h1 className={`display ${styles.title}`}>
              Your week, <em>remixed.</em>
            </h1>
            <p className={styles.lede}>
              A little soul. A lot of rhythm. A whole world of music. Find your sound on Musicsquare Radio.
            </p>
            <a className="btn" href="#lineup">
              Explore the lineup <span aria-hidden="true">↘</span>
            </a>
          </div>
          <div className={styles.recordCol}>
            <Record />
            <p className={`mono ${styles.caption}`}>The best music you&rsquo;ve never heard before</p>
          </div>
        </div>
      </header>

      {/* Every programme on the schedule, not a handful. */}
      <div className={styles.strip}>
        {/* Two copies back to back so the ticker loops without a seam; the second is hidden from readers. */}
        <div className={`mono ${styles.ticker}`}>
          {[0, 1].map((copy) => (
            <p key={copy} className={styles.stripInner} aria-hidden={copy === 1}>
              {ALL_BLOCKS.map((label) => (
                <span key={label}>
                  {label}
                  <i aria-hidden="true">✳</i>
                </span>
              ))}
            </p>
          ))}
        </div>
      </div>

      <Lineup />

      <section id="sunday-reset" className={`on-ink ${styles.sunday}`}>
        <div className={`wrap ${styles.sundayGrid}`}>
          <div>
            <p className="mono eyebrow">The Sunday reset</p>
            <h2 className={`display ${styles.sundayTitle}`}>
              Slow down.
              <br />
              <em>Then turn it up.</em>
            </h2>
            <p className={styles.sundayLede}>
              Ease in with Sunday Lofi, make space for Sunday Church, and let Sunday House carry you into the afternoon.
            </p>
            {/* #sunday opens Sunday in the lineup above (see Lineup). */}
            <a className="btn" href="#sunday">
              Explore Sunday <span aria-hidden="true">↗</span>
            </a>
          </div>
          <ol className={styles.sundayList}>
            {WEEK[0].map((b) => (
              <li key={b.label}>
                <b>{b.label}</b>
                <span className="mono">
                  {hhmm(b.start)}–{hhmm(b.end)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  );
}
