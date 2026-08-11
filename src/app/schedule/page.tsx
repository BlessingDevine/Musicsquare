import type { Metadata } from "next";
import { WeekGrid } from "@/components/week-grid";
import { ALL_BLOCKS, BLOCKS_BY_AIRTIME, HOURS_A_WEEK } from "@/lib/station";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Schedule",
  description:
    "The full week on Musicsquare Radio — every block, hour by hour, from Afro Mix at midnight to Sunday Church. All times shown in your own timezone.",
  alternates: { canonical: "/schedule" },
};

export default function SchedulePage() {
  const busiest = BLOCKS_BY_AIRTIME.slice(0, 8);
  const most = busiest[0]?.hours ?? 1;

  return (
    <main>
      <header className={`on-ink ${styles.header}`}>
        <div className="wrap">
          <p className="mono eyebrow">Schedule</p>
          <h1 className={`display ${styles.title}`}>
            The week, <em>hour by hour</em>
          </h1>
          <p className={styles.lede}>
            One signal, seven days, nothing repeated in the same order twice.
            Times are shown in your own timezone, not ours.
          </p>

          <dl className={styles.summary}>
            <div>
              <dt className="mono">Blocks</dt>
              <dd>{ALL_BLOCKS.length}</dd>
            </div>
            <div>
              <dt className="mono">Hours a week</dt>
              <dd>{HOURS_A_WEEK}</dd>
            </div>
            <div>
              <dt className="mono">Days</dt>
              <dd>7</dd>
            </div>
            <div>
              <dt className="mono">Off air</dt>
              <dd>0</dd>
            </div>
          </dl>
        </div>
      </header>

      <section className={`wrap ${styles.gridSection}`}>
        <WeekGrid />
      </section>

      {/* Ranked from the timetable itself — this is the shape of the station. */}
      <section className={`wrap ${styles.ranking}`}>
        <p className="mono eyebrow">What gets the most air</p>
        <h2 className={`display ${styles.rankTitle}`}>
          The station, <em>by the hour</em>
        </h2>

        <ol className={styles.rankList}>
          {busiest.map((block) => (
            <li key={block.label}>
              <span className={`display ${styles.rankName}`}>{block.label}</span>
              <span className={styles.rankBar} aria-hidden="true">
                <span style={{ width: `${(block.hours / most) * 100}%` }} />
              </span>
              <span className={`mono ${styles.rankHours}`}>
                {block.hours}h · {block.days}{" "}
                {block.days === 1 ? "day" : "days"}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
