"use client";

import Image from "next/image";
import { WALL } from "@/lib/station";
import styles from "./wall.module.css";

/** Six columns, each a different slice of the catalogue at a different speed. */
const COLUMNS = 6;
const PER_COLUMN = 5;

/**
 * The catalogue, as a wall of sleeves.
 *
 * Each column holds its own slice of the artwork, listed twice, and drifts by
 * exactly half its height — so the loop is seamless with no JavaScript. Columns
 * alternate direction and run at different speeds, which keeps the eye from
 * locking onto the repeat.
 */
export function Wall() {
  const columns = Array.from({ length: COLUMNS }, (_, col) =>
    Array.from({ length: PER_COLUMN }, (_, row) => WALL[(col * PER_COLUMN + row) % WALL.length]),
  );

  return (
    <div className={styles.wall} aria-hidden="true">
      {columns.map((covers, col) => (
        <div
          key={col}
          className={`${styles.column} ${col % 2 ? styles.down : styles.up}`}
          style={{ animationDuration: `${52 + col * 11}s` }}
        >
          {[...covers, ...covers].map((src, i) => (
            <div key={`${src}-${i}`} className={styles.tile}>
              <Image
                src={src}
                alt=""
                fill
                sizes="(max-width: 760px) 34vw, 18vw"
                className={styles.art}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
