import type { Metadata } from "next";
import Link from "next/link";
import { ListenButton } from "@/components/listen-button";
import { ALL_BLOCKS, CATALOGUE, GENRES, ROSTER, STATION } from "@/lib/station";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "About",
  description:
    "Musicsquare Radio is a 24/7 station playing AI-made, human-assisted music across sixteen genres and several languages — over 2,000 songs from close to 300 artists. Operated by Squaredrum LLC, founded 2024.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <main>
      <header className={`on-ink ${styles.header}`}>
        <div className="wrap">
          <p className="mono eyebrow">About</p>
          <h1 className={`display ${styles.title}`}>
            A station for music <em>made both ways</em>
          </h1>
          <p className={styles.lede}>
            {STATION.name} runs twenty-four hours a day, playing music that was
            made by artificial intelligence and finished by people. One signal,
            sixteen genres, several languages, and a catalogue of more than two
            thousand songs that exist nowhere else.
          </p>

          <dl className={styles.summary}>
            <div>
              <dt className="mono">Founded</dt>
              <dd>{STATION.founded}</dd>
            </div>
            <div>
              <dt className="mono">Songs</dt>
              <dd>{CATALOGUE.songs}</dd>
            </div>
            <div>
              <dt className="mono">Artists</dt>
              <dd>{CATALOGUE.artists}</dd>
            </div>
            <div>
              <dt className="mono">Genres</dt>
              <dd>{GENRES.length}</dd>
            </div>
          </dl>
        </div>
      </header>

      <article className={styles.body}>
        <section className={`wrap ${styles.block}`}>
          <p className="mono eyebrow">How it&rsquo;s made</p>
          <h2 className={`display ${styles.h2}`}>
            AI magic, <em>human expertise</em>
          </h2>
          <div className={styles.prose}>
            <p>
              Every record on this station starts with a machine and ends with a
              person. The models generate; the writers, producers and engineers
              decide what is worth keeping, what needs rewriting, and what never
              leaves the room. Nothing goes into rotation because it was easy to
              make.
            </p>
            <p>
              That is the whole proposition, and it is why the station exists as
              a station rather than a playlist. Somebody has to be listening,
              choosing and sequencing — otherwise it is just output.
            </p>
          </div>
        </section>

        {/* The range is the story here, so it gets set as type rather than
            buried in a sentence. */}
        <section className={`${styles.block} ${styles.rangeBlock}`}>
          <div className="wrap">
            <p className="mono eyebrow">What&rsquo;s in rotation</p>
            <h2 className={`display ${styles.h2}`}>
              Sixteen genres, <em>several languages</em>
            </h2>
            <ul className={styles.genres}>
              {GENRES.map((genre) => (
                <li key={genre} className="display">
                  {genre}
                </li>
              ))}
            </ul>
            <p className={`${styles.prose} ${styles.rangeNote}`}>
              Not all of it is in English. The schedule carries a standing French
              Mix, and the Afro, Latin and Caribbean blocks bring their own
              languages with them. {ALL_BLOCKS.length} named blocks share the
              signal across a week —{" "}
              <Link href="/schedule">the timetable shows all of them</Link>.
            </p>
          </div>
        </section>

        <section className={`wrap ${styles.block}`}>
          <p className="mono eyebrow">Who runs it</p>
          <h2 className={`display ${styles.h2}`}>{STATION.label}</h2>
          <div className={styles.prose}>
            <p>
              The station is operated by {STATION.label}, an AI record label with
              close to three hundred artists on it. The label makes the records;
              the station is where they go — {CATALOGUE.songs} songs so far, and
              the number goes up every week.
            </p>
            <p>
              {ROSTER.length} of those artists are featured on this site. The
              rest are on the air whether or not you have seen their faces.
            </p>
            <p>
              It was founded in {STATION.founded} by a Los Angeles based music
              producer and industry executive — award-winning, and more than
              twenty-five years in the business before any of this involved a
              machine. That matters to how the place is run: the standards
              applied to an AI-generated record here are the ones you would apply
              to any other.
            </p>
            <p>
              <Link href="/#roster">Meet the roster</Link>, or{" "}
              <Link href="/channels">see what each channel plays</Link>.
            </p>
          </div>
        </section>

        <section className={`wrap ${styles.cta}`}>
          <h2 className={`display ${styles.ctaTitle}`}>
            It&rsquo;s on right now
          </h2>
          <p className={styles.prose}>
            The quickest way to understand any of this is to hear it.
          </p>
          <ListenButton />
        </section>
      </article>
    </main>
  );
}
