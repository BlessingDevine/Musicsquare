import Image from "next/image";
import { artistsWithPages } from "@/lib/canvas-wall";
import { pacificDay } from "@/lib/drop";
import { seededShuffle } from "@/lib/seeded";
import socials from "../../scripts/catalog/socials.json";
import { CATALOGUE, ROSTER } from "@/lib/station";
import { Reveal } from "./reveal";
import { RosterRail } from "./roster-rail";
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

/** Instagram handles (no @), the same list the catalogue uses for squaredrum.com and GoSquare. */
const INSTAGRAM: Record<string, string> = socials;

export async function Roster({ featured }: { featured?: string }) {
  const roster = todaysOrder(featured);
  const pages = await artistsWithPages(ROSTER.map((a) => a.slug));
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

      {/* Drifts right to left on a loop; roster-rail.tsx moves each card and wraps it round. */}
      <RosterRail className={styles.viewport}>
        <ul className={styles.rail}>
          {roster.map((artist) => {
            const card = (
              <>
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
              </>
            );
            return (
              <li key={artist.slug} className={styles.card}>
                {pages.has(artist.slug) ? (
                  // A new tab, so the radio keeps playing.
                  <a
                    href={`https://squaredrum.com/artists/${artist.slug}`}
                    target="_blank"
                    rel="noopener"
                    className={styles.link}
                  >
                    {card}
                    <p className={`mono ${styles.page}`}>Artist page &#8599;</p>
                  </a>
                ) : (
                  card
                )}
                {INSTAGRAM[artist.slug] && (
                  <a
                    href={`https://www.instagram.com/${INSTAGRAM[artist.slug]}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`mono ${styles.ig}`}
                    aria-label={`${artist.name} on Instagram (@${INSTAGRAM[artist.slug]})`}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <rect
                        x="3"
                        y="3"
                        width="18"
                        height="18"
                        rx="5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <circle
                        cx="12"
                        cy="12"
                        r="4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" />
                    </svg>
                    @{INSTAGRAM[artist.slug]}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </RosterRail>

      <div className="wrap">
        <p className={`mono ${styles.drag}`}>
          The whole roster, on a loop &larr; hover or hold to pause
        </p>
      </div>
    </section>
  );
}
