"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  CHANNELS,
  DAYS,
  OTHER_BLOCKS,
  airtime,
  blockAt,
} from "@/lib/station";
import { usePlayer } from "./player-provider";
import { Reveal } from "./reveal";
import styles from "./channel-detail.module.css";

const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;

type Clock = { day: number; hour: number };

function useClock() {
  const [now, setNow] = useState<Clock | null>(null);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow({ day: d.getDay(), hour: d.getHours() });
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const onAir = (label: string) =>
    now ? blockAt(now.day, now.hour)?.label === label : false;

  /** Searches a full week forward — several blocks run only a couple of days. */
  const nextUp = (label: string) => {
    if (!now) return null;
    for (let step = 1; step <= 24 * 7; step++) {
      const total = now.hour + step;
      const day = (now.day + Math.floor(total / 24)) % 7;
      const slot = blockAt(day, total % 24);
      if (slot?.label === label) return { day, start: slot.start };
    }
    return null;
  };

  return { now, onAir, nextUp };
}

export function ChannelDetail() {
  const { toggleLive, status, source } = usePlayer();
  const { now, onAir, nextUp } = useClock();
  const liveOn = source.kind === "live" && status === "playing";

  return (
    <>
      {CHANNELS.map((channel, i) => {
        const { slots, hours, days, perDay } = airtime(channel.block);
        const live = onAir(channel.block);
        const next = nextUp(channel.block);
        const today = now ? perDay[now.day] : [];

        return (
          <Reveal
            as="article"
            key={channel.slug}
            id={channel.slug}
            className={`${styles.channel} ${i % 2 ? styles.flipped : ""}`}
          >
            <div className={styles.art}>
              <Image
                src={channel.cover}
                alt=""
                fill
                sizes="(max-width: 900px) 100vw, 42vw"
                className={styles.img}
              />
              {live && (
                <span className={`mono ${styles.onAir}`}>
                  <span className="pip" aria-hidden="true" />
                  On air now
                </span>
              )}
            </div>

            <div className={styles.body}>
              <p className="mono eyebrow">{channel.strapline}</p>
              <h2 className={`display ${styles.name}`}>{channel.name}</h2>
              <p className={styles.about}>{channel.about}</p>

              {/* Read off the timetable, so the numbers can never disagree
                  with the schedule page. */}
              <dl className={styles.spec}>
                <div>
                  <dt className="mono">Tracks</dt>
                  <dd>{channel.tracks}</dd>
                </div>
                <div>
                  <dt className="mono">Runtime</dt>
                  <dd>{channel.runtime}</dd>
                </div>
                <div>
                  <dt className="mono">Hours a week</dt>
                  <dd>{hours}</dd>
                </div>
                <div>
                  <dt className="mono">Days a week</dt>
                  <dd>
                    {days}
                    <span className={styles.of}>/7</span>
                  </dd>
                </div>
              </dl>

              <div className={styles.slots}>
                <p className="mono">{now ? DAYS[now.day] : "Today"}</p>
                {today.length ? (
                  <ul>
                    {today.map((slot) => (
                      <li
                        key={slot.start}
                        className={`mono ${
                          now && now.hour >= slot.start && now.hour < slot.end
                            ? styles.slotLive
                            : ""
                        }`}
                      >
                        {hh(slot.start)}–{hh(slot.end)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={`mono ${styles.off}`}>
                    Not on today · {slots.length} slots across the week
                  </p>
                )}
              </div>

              <div className={styles.actions}>
                <button type="button" className="btn" onClick={toggleLive}>
                  <span aria-hidden="true">{liveOn ? "■" : "▶"}</span>
                  <span>{liveOn ? "Stop the stream" : "Listen live"}</span>
                </button>
                <p className={`mono ${styles.when}`}>
                  {live
                    ? "Playing right now"
                    : next
                      ? next.day === now?.day
                        ? `Next on air ${hh(next.start)}`
                        : `Next ${DAYS[next.day]} ${hh(next.start)}`
                      : "In rotation"}
                </p>
              </div>
            </div>
          </Reveal>
        );
      })}

      {/* The timetable carries far more than the four channels; saying so is
          more honest than pretending the station is only those four. */}
      <Reveal className={styles.also}>
        <p className="mono eyebrow">Also in rotation</p>
        <p className={styles.alsoLede}>
          {OTHER_BLOCKS.length} more blocks share the same signal through the
          week. They have no standing catalogue of their own — they pull from
          everywhere.
        </p>
        <ul className={styles.alsoList}>
          {OTHER_BLOCKS.map((block) => {
            const { hours, days } = airtime(block);
            const live = onAir(block);
            return (
              <li key={block} className={live ? styles.alsoLive : ""}>
                <span className={`display ${styles.alsoName}`}>{block}</span>
                <span className={`mono ${styles.alsoTimes}`}>
                  {days} {days === 1 ? "day" : "days"} a week
                </span>
                <span className={`mono ${styles.alsoHours}`}>
                  {live ? "On air" : `${hours}h`}
                </span>
              </li>
            );
          })}
        </ul>
        <Link href="/schedule" className={`mono ${styles.toSchedule}`}>
          See the full week &rarr;
        </Link>
      </Reveal>
    </>
  );
}
