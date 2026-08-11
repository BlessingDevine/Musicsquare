import styles from "./logo.module.css";

/**
 * The mark: one square, split down the middle. The left half is solid — a
 * continuous signal. The right half is the same square sampled into four
 * bars — the same sound, quantised. It is the hero signal in miniature.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 28 28"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="0.75"
        y="0.75"
        width="26.5"
        height="26.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect x="4.5" y="4.5" width="8" height="19" fill="currentColor" />
      <g fill="currentColor">
        <rect x="15.5" y="4.5" width="8" height="3" />
        <rect x="15.5" y="9.5" width="5" height="3" />
        <rect x="15.5" y="14.5" width="8" height="3" />
        <rect x="15.5" y="19.5" width="3.5" height="4" />
      </g>
    </svg>
  );
}

export function Logo({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <span
      className={`${styles.lockup} ${compact ? styles.compact : ""} ${className ?? ""}`}
    >
      <LogoMark className={styles.mark} />
      <span className={styles.words}>
        <span className={styles.name}>Musicsquare</span>
        <span className={styles.sub}>Radio</span>
      </span>
    </span>
  );
}
