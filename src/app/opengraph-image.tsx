import { OG_ALT, OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "./_og/card";

/**
 * Sits at the root of the app, so every page that doesn't define its own card
 * inherits this one — the home page, channels, schedule, about, donate and
 * privacy all share it.
 */
export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OpengraphImage() {
  return renderOgCard();
}
