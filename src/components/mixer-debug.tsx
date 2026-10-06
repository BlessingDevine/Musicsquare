"use client";

import { useEffect, useState } from "react";
import { audioCorsStatus, currentMixer } from "@/lib/channel-mixer";

/**
 * Add ?debug to any page address to see how the channel player is mixing on
 * this device — the quickest way to diagnose a phone remotely. Invisible
 * otherwise.
 */
export function MixerDebug() {
  const [lines, setLines] = useState<string[] | null>(null);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("debug")) return;
    const tick = () => {
      const m = currentMixer();
      const cors = audioCorsStatus();
      const last = m?.lastMix;
      setLines([
        `CDN CORS: ${cors === null ? "checking" : cors ? "yes" : "NO"}`,
        `Mixer: ${m ? m.mode : "not started (tune in to a channel)"}`,
        `Audio engine: ${m ? m.contextState : "-"}`,
        `Next song ready to overlap: ${m ? (m.headReady ? "yes" : "no") : "-"}`,
        `Last change: ${last ? `${last.mode}, ${Math.round((Date.now() - last.at) / 1000)}s ago${last.reason ? ` (${last.reason})` : ""}` : "none yet"}`,
      ]);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  if (!lines) return null;
  return (
    <div
      className="mono"
      style={{
        position: "fixed", left: 8, top: 96, zIndex: 100, maxWidth: "calc(100vw - 16px)",
        padding: "10px 12px", background: "rgba(10,10,11,0.92)", color: "#ead4ae",
        fontSize: 11, letterSpacing: "0.04em", lineHeight: 1.6, textTransform: "none",
        border: "1px solid #886221", pointerEvents: "none",
      }}
    >
      {lines.map((l) => (
        <div key={l.split(":")[0]}>{l}</div>
      ))}
    </div>
  );
}
