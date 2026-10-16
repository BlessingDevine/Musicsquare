import Image from "next/image";
import { pacificDay } from "@/lib/drop";
import { seededShuffle } from "@/lib/seeded";
import socials from "../../scripts/catalog/socials.json";
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

/**
 * Slugs of roster artists whose page on squaredrum.com is built. That site
 * shows an artist page once photos.mjs has published the artist's photo index,
 * so the same file decides here; a page published later links on its own.
 */
async function artistsWithPages(): Promise<Set<string>> {
  const audioBase = process.env.NEXT_PUBLIC_AUDIO_BASE_URL?.trim().replace(/\/$/, "");
  if (!audioBase) return new Set();
  const built = await Promise.all(
    ROSTER.map(async ({ slug }) => {
      try {
        const r = await fetch(`${audioBase}/audio/photos/${slug}/index.json`, { next: { revalidate: 300 } });
        return r.ok ? slug : null;
      } catch {
        return null;
      }
    }),
  );
  return new Set(built.filter((s): s is string => s !== null));
}

/** Instagram handles (no @), the same list the catalogue uses for squaredrum.com and GoSquare. */
const INSTAGRAM: Record<string, string> = socials;

export async function Roster({ featured }: { featured?: string }) {
  const roster = todaysOrder(featured);
  const pages = await artistsWithPages();
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
                    <rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="2" />
                    <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
                    <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" />
                  </svg>
                  @{INSTAGRAM[artist.slug]}
                </a>
              )}
            </li>
          );
        })}
      </ul>

      <div className="wrap">
        <p className={`mono ${styles.drag}`}>Scroll the rail to see the rest &rarr;</p>
      </div>
    </section>
  );
}
