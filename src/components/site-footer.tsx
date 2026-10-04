import Link from "next/link";
import { Logo } from "./logo";
import { NAV, SOCIALS, STATION } from "@/lib/station";
import styles from "./site-footer.module.css";

export function SiteFooter() {
  return (
    <footer className={`on-ink ${styles.footer}`}>
      <div className={`wrap ${styles.inner}`}>
        <div className={styles.brand}>
          <Logo className={styles.logo} />
          <p className={styles.pitch}>
            A 24-hour station for music made by people and machines together.
            Broadcasting from {STATION.city} since {STATION.founded}.
          </p>
        </div>

        <nav className={styles.col} aria-label="Sections">
          <p className="mono eyebrow">Explore</p>
          {NAV.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>

        <nav className={styles.col} aria-label="Elsewhere">
          <p className="mono eyebrow">Elsewhere</p>
          {SOCIALS.map((social) => (
            <a
              key={social.label}
              href={social.href}
              target="_blank"
              rel="noreferrer noopener"
            >
              {social.label}
            </a>
          ))}
        </nav>

        <div className={styles.col}>
          <p className="mono eyebrow">Get in touch</p>
          <a href="mailto:hello@musicsquareradio.com">hello@musicsquareradio.com</a>
          <Link href="/privacy">Privacy</Link>
          <Link href="/donate">Support the station</Link>
        </div>
      </div>

      <div className={`wrap ${styles.base}`}>
        <p className="mono">
          © {STATION.founded}–2026 {STATION.name}. {STATION.city}, United States.
        </p>
        <p className="mono">All rights reserved</p>
      </div>
    </footer>
  );
}
