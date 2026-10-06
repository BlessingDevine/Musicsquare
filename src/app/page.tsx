import { Hero } from "@/components/hero";
import { OnNow } from "@/components/on-now";
import { Channels } from "@/components/channels";
import { Drop } from "@/components/drop";
import { Roster } from "@/components/roster";
import { Schedule } from "@/components/schedule";
import { getChannelSummaries } from "@/lib/catalog";
import { getTodaysDrop } from "@/lib/drop";

// The channel cards refresh themselves in the browser; the page is rebuilt
// once a minute so the first paint is never far behind, and today's drop
// changes within a minute of midnight Pacific.
export const revalidate = 60;

export default async function Home() {
  const [channels, drop] = await Promise.all([getChannelSummaries(), getTodaysDrop()]);
  return (
    <main>
      <Hero />
      <OnNow />
      <Channels initial={channels} />
      <Drop drop={drop} />
      <Roster />
      <Schedule />
    </main>
  );
}
