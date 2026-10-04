import { getChannel } from "@/lib/catalog";
import type { Rotation } from "@/lib/live-channel";

export type ChannelRotation = Rotation & { name: string };

/**
 * One channel's full rotation, fetched by the player when a listener tunes
 * in. It holds no time-based data — the player computes the position from
 * the clock — so it can be cached at the edge.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/channels/[slug]">) {
  const { slug } = await ctx.params;
  const channel = await getChannel(slug);
  if (!channel) return Response.json({ error: "No such channel" }, { status: 404 });
  const body: ChannelRotation = { ...channel.rotation, name: channel.name };
  return Response.json(body, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" },
  });
}
