"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CHANNELS, DAYS, blockAt } from "@/lib/station";
import { usePlayer } from "./player-provider";
import { Reveal } from "./reveal";
import styles from "./channels.module.css";

type Clock = { day: number; hour: number };

/**
 * When this block is next on air, phrased for a listener. Searches forward
 * across the week, because several blocks only run on a couple of days.
 */
function airing(block: string, now: Clock | null) {
  if (!now) return null;
  if (blockAt(now.day, now.hour)?.label === block) {
    return { live: true, text: "On air now" };
  }

  for (let step = 1; step <= 24 * 7; step++) {
    const total = now.hour + step;
    const day = (now.day + Math.floor(total / 24)) % 7;
    const hour = total % 24;
    const slot = blockAt(day, hour);
    if (slot?.label !== block) continue;
    const when = `${String(slot.start).padStart(2, "0")}:00`;
    return {
      live: false,
      text: day === now.day ? `Next on air ${when}` : `Next ${DAYS[day]} ${when}`,
    };
  }
  return { live: false, text: "In rotation" };
}

export function Channels() {
  const { toggleLive, status, source } = usePlayer();
  const [now, setNow] = useState<Clock | null>(null);
  const liveOn = source.kind === "live" && status === "playing";

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow({ day: d.getDay(), hour: d.getHours() });
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <section id="channels" className={styles.section}>
      <div className="wrap">
        <Reveal className={styles.head}>
          <p className="mono eyebrow">Four channels, one stream</p>
          <h2 className={`display ${styles.title}`}>
            What we <em>play</em>
          </h2>
          <p className={styles.lede}>
            The station runs a single live signal. Through the day it moves between
            four rooms — each with its own catalogue, its own writers and its own
            machines.
          </p>
          <Link href="/channels" className={`mono ${styles.more}`}>
            All four channels, in full &rarr;
          </Link>
        </Reveal>
      </div>

      <div className="wrap">
        <ul className={styles.grid}>
          {CHANNELS.map((channel) => {
            const air = airing(channel.block, now);
            return (
              <Reveal as="li" key={channel.slug} className={styles.card}>
                <div className={styles.art}>
                  <Image
                    src={channel.cover}
                    alt=""
                    fill
                    sizes="(max-width: 760px) 100vw, 25vw"
                    className={styles.img}
                  />
                  <span className={`mono ${styles.air} ${air?.live ? styles.airLive : ""}`}>
                    {air?.live ? <span className="pip" aria-hidden="true" /> : null}
                    {air?.text ?? " "}
                  </span>
                </div>

                <h3 className={`display ${styles.name}`}>{channel.name}</h3>
                <p className={styles.strap}>{channel.strapline}</p>

                <p className={`mono ${styles.stats}`}>
                  <span>{channel.tracks} tracks</span>
                  <span>{channel.runtime}</span>
                </p>

                <button
                  type="button"
                  className={`btn btn-ghost ${styles.cardBtn}`}
                  onClick={toggleLive}
                >
                  <span aria-hidden="true">{liveOn ? "■" : "▶"}</span>
                  <span>{liveOn ? "Stop" : "Tune in"}</span>
                </button>
              </Reveal>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
