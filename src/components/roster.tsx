import Image from "next/image";
import { CATALOGUE, ROSTER } from "@/lib/station";
import { Reveal } from "./reveal";
import styles from "./roster.module.css";

export function Roster() {
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
        {ROSTER.map((artist) => (
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
