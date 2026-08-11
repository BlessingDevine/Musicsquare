import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/station";

/**
 * Open to everything except the now-playing endpoint, which is a polling API
 * with no standalone page behind it — there is nothing there for a crawler to
 * index, and it changes every few seconds.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/api/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
