import type { Metadata } from "next";
import { STATION } from "@/lib/station";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What this site does and does not collect, and which third parties are involved when you press play.",
};

export default function PrivacyPage() {
  return (
    <main>
      <header className={`on-ink ${styles.header}`}>
        <div className="wrap">
          <p className="mono eyebrow">Privacy</p>
          <h1 className={`display ${styles.title}`}>
            What we <em>know about you</em>
          </h1>
          <p className={styles.lede}>
            Short version: this site sets no cookies and runs no analytics.
            Pressing play connects you to our streaming provider, and they see
            your request the way any web server would.
          </p>
        </div>
      </header>

      <article className={`wrap ${styles.body}`}>
        <section>
          <h2 className={`display ${styles.h2}`}>What this site collects</h2>
          <p>
            Nothing. There is no analytics script, no advertising pixel, no
            tag manager and no cookie set by this site. Nothing you do here is
            stored between visits — the schedule and the on-air times are worked
            out in your browser from your device&rsquo;s own clock, and never
            sent anywhere.
          </p>
        </section>

        <section>
          <h2 className={`display ${styles.h2}`}>What happens when you press play</h2>
          <p>
            The audio stream and the now-playing information come from RadioKing,
            the platform the station broadcasts on. When you start the stream
            your browser connects to their servers directly, and they receive
            what any web server receives: your IP address, your browser and
            device type, and which stream you asked for. That connection is what
            makes the radio work.
          </p>
          <p>
            Track information shown on the site is requested by our server, not
            yours, so simply reading the page does not connect you to RadioKing.
            Cover artwork is loaded from their image host, which means your
            browser does request those images directly.
          </p>
        </section>

        <section>
          <h2 className={`display ${styles.h2}`}>Fonts and hosting</h2>
          <p>
            Typefaces are served from this site rather than from Google Fonts, so
            no font request leaves for a third party. The site is hosted on
            Vercel, whose servers keep standard request logs.
          </p>
        </section>

        <section>
          <h2 className={`display ${styles.h2}`}>Links out</h2>
          <p>
            Our social links take you to Instagram, X, YouTube and Facebook.
            Once you are there you are on their terms, not ours.
          </p>
        </section>

        <section>
          <h2 className={`display ${styles.h2}`}>Getting in touch</h2>
          <p>
            Questions about any of this go to{" "}
            <a href="mailto:hello@musicsquareradio.com">
              hello@musicsquareradio.com
            </a>
            . {STATION.name} broadcasts from {STATION.city}, United States.
          </p>
        </section>

        <p className={`mono ${styles.note}`}>
          This page describes how the site is built, and is accurate as of the
          last deploy. It is not legal advice — if the station adds analytics,
          advertising or accounts, this page needs updating and a lawyer should
          look at it.
        </p>
      </article>
    </main>
  );
}
