import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/station";

/**
 * Every page the station actually serves. The channels and schedule pages are
 * single pages rather than one route per channel, so this stays a flat list —
 * if channels ever get their own routes they belong here too.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const pages: Array<{
    path: string;
    priority: number;
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  }> = [
    { path: "", priority: 1, changeFrequency: "daily" },
    { path: "/channels", priority: 0.9, changeFrequency: "weekly" },
    // The timetable is the page most worth recrawling: it moves every week.
    { path: "/schedule", priority: 0.8, changeFrequency: "weekly" },
    { path: "/about", priority: 0.6, changeFrequency: "monthly" },
    { path: "/donate", priority: 0.5, changeFrequency: "monthly" },
    { path: "/privacy", priority: 0.2, changeFrequency: "yearly" },
  ];

  return pages.map(({ path, priority, changeFrequency }) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }));
}
