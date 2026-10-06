import Image from "next/image";
import { pacificDay } from "@/lib/drop";
import { seededShuffle } from "@/lib/seeded";
import { CATALOGUE, ROSTER } from "@/lib/station";
import { Reveal } from "./reveal";
import styles from "./roster.module.css";

/**
 * The roster in a new order every day, changing with Today's drop at
 * midnight Pacific, so no artist is always at the far end of the rail.
 * Everyone sees the same order on a given day. Today's drop artist leads.
 */
function todaysOrder(featured?: string) {
  const order = seededShuffle(ROSTER, `roster:${pacificDay(Date.now()).day}`);
  const lead = order.findIndex((a) => a.slug === featured);
  if (lead > 0) order.unshift(...order.splice(lead, 1));
  return order;
}

export function Roster({ featured }: { featured?: string }) {
  const roster = todaysOrder(featured);
  return (
    <section id="roster" className={`on-ink ${styles.section}`}>
      <div className="wrap">
        <Reveal className={styles.head}>
          <p className="mono eyebrow">
            The roster · {ROSTER.length} of {CATALOGUE.artists} artists
          </p>
          <h2 className={`display ${styles.title}`}>
            Who you&rsquo;re <em>hearing</em>
          </h2>
        </Reveal>
      </div>

      <ul className={styles.rail}>
        {roster.map((artist) => (
          <li key={artist.slug} className={styles.card}>
            <div className={styles.frame}>
              <Image
                src={artist.portrait}
                alt={artist.name}
                fill
                sizes="(max-width: 760px) 62vw, 22vw"
                className={styles.img}
              />
            </div>
            <p className={`display ${styles.name}`}>{artist.name}</p>
            <p className={`mono ${styles.lane}`}>{artist.lane}</p>
          </li>
        ))}
      </ul>

      <div className="wrap">
        <p className={`mono ${styles.drag}`}>Scroll the rail to see the rest &rarr;</p>
      </div>
    </section>
  );
}
