"use client";

import { usePlayer } from "./player-provider";

/** The station's one universal action, reusable on any page. */
export function ListenButton({ className = "" }: { className?: string }) {
  const { toggleLive, status, source } = usePlayer();
  const liveOn = source.kind === "live" && status === "playing";

  return (
    <button
      type="button"
      className={`btn ${className}`}
      onClick={toggleLive}
      aria-pressed={liveOn}
    >
      <span aria-hidden="true">{liveOn ? "■" : "▶"}</span>
      <span>
        {liveOn
          ? "Stop the stream"
          : status === "loading" && source.kind === "live"
            ? "Connecting"
            : "Listen live"}
      </span>
    </button>
  );
}
