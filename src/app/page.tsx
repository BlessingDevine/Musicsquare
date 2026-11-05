import { Hero } from "@/components/hero";
import { OnNow } from "@/components/on-now";
import { Channels } from "@/components/channels";
import { Drop } from "@/components/drop";
import { Roster } from "@/components/roster";
import { Schedule } from "@/components/schedule";
import { getCanvasPool, onAirStandIns, todaysWall } from "@/lib/canvas-wall";
import { getChannelSummaries } from "@/lib/catalog";
import { getTodaysDrop } from "@/lib/drop";

// The channel cards refresh themselves in the browser; the page is rebuilt
// once a minute so the first paint is never far behind, and today's drop,
// the roster order and the hero's artist wall change within a minute of
// midnight Pacific.
export const revalidate = 60;

export default async function Home() {
  const [channels, drop, canvases] = await Promise.all([getChannelSummaries(), getTodaysDrop(), getCanvasPool()]);
  return (
    <main>
      <Hero channels={channels} wall={todaysWall(canvases, drop?.slug)} standIns={onAirStandIns(canvases)} />
      <OnNow />
      <Channels initial={channels} />
      <Drop drop={drop} />
      <Roster featured={drop?.slug} />
      <Schedule />
    </main>
  );
}
