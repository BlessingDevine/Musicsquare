import { getChannels } from "@/lib/catalog";
import { summarise } from "@/lib/channel-summary";

export const dynamic = "force-dynamic";

/**
 * What every channel is playing right now. Small on purpose: the channels
 * page polls this, and only a listener who tunes in downloads a rotation.
 */
export async function GET() {
  const body = summarise(await getChannels(), Date.now());
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
