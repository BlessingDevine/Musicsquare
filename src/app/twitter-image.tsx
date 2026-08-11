import { OG_ALT, OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "./_og/card";

/**
 * The same artwork again under `twitter:image`. X and a few in-app browsers
 * only look for the Twitter tags and ignore the Open Graph ones, so this being
 * absent is the usual reason a link previews everywhere except X.
 */
export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function TwitterImage() {
  return renderOgCard();
}
