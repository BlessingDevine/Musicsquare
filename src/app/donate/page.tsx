import type { Metadata } from "next";
import Link from "next/link";
import { ListenButton } from "@/components/listen-button";
import { CATALOGUE, SOCIALS, SUPPORT_URL } from "@/lib/station";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Support the station",
  description:
    "Musicsquare Radio runs 24 hours a day with no ads and no paywall. Here is what actually keeps it on air.",
  alternates: { canonical: "/donate" },
};

export default function DonatePage() {
  return (
    <main>
      <header className={`on-ink ${styles.header}`}>
        <div className="wrap">
          <p className="mono eyebrow">Support the station</p>
          <h1 className={`display ${styles.title}`}>
            Keep it <em>on air</em>
          </h1>
          <p className={styles.lede}>
            No ads, no paywall, no account to make. {CATALOGUE.songs} songs from{" "}
            {CATALOGUE.artists} artists, running twenty-four hours a day. Here is
            what actually helps.
          </p>
        </div>
      </header>

      <div className={`wrap ${styles.body}`}>
        <ol className={styles.ways}>
          <li>
            <h2 className={`display ${styles.wayTitle}`}>Listen</h2>
            <p>
              It sounds like the least you could do; it is genuinely the most.
              Listener hours are what the station is measured on, and they cost
              you nothing.
            </p>
            <ListenButton />
          </li>

          <li>
            <h2 className={`display ${styles.wayTitle}`}>Pass it on</h2>
            <p>
              Send someone the link, or the record that is playing right now.
              Everything here was made by people and machines working together,
              and almost nobody knows it exists yet.
            </p>
            <Link href="/" className={`mono ${styles.link}`}>
              See what&rsquo;s playing &rarr;
            </Link>
          </li>

          <li>
            <h2 className={`display ${styles.wayTitle}`}>Follow the artists</h2>
            <p>
              The roster is the station. Following, saving and sharing their
              records does more for them than anything that happens here.
            </p>
            <div className={styles.socials}>
              {SOCIALS.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={`mono ${styles.link}`}
                >
                  {social.label}
                </a>
              ))}
            </div>
          </li>

          {SUPPORT_URL && (
            <li>
              <h2 className={`display ${styles.wayTitle}`}>Chip in</h2>
              <p>
                Streaming, hosting and licensing are the bills. Anything you put
                in goes straight at them.
              </p>
              <a
                href={SUPPORT_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="btn"
              >
                Make a contribution
              </a>
            </li>
          )}
        </ol>

        {!SUPPORT_URL && (
          <p className={`mono ${styles.note}`}>
            A way to contribute directly is coming. Until then the three above
            are worth more than they sound.
          </p>
        )}
      </div>
    </main>
  );
}
