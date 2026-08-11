import { Hero } from "@/components/hero";
import { OnNow } from "@/components/on-now";
import { Channels } from "@/components/channels";
import { Drop } from "@/components/drop";
import { Roster } from "@/components/roster";
import { Schedule } from "@/components/schedule";

export default function Home() {
  return (
    <main>
      <Hero />
      <OnNow />
      <Channels />
      <Drop />
      <Roster />
      <Schedule />
    </main>
  );
}
