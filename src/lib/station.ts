/** Station constants and home-page content. */

export const STREAM_URL = "https://play.radioking.io/music-square-radio/812353";

export const STATION = {
  name: "Musicsquare Radio",
  city: "California",
  founded: "2024",
  frequency: "24/7",
  /** The label that runs the station. */
  label: "Squaredrum LLC",
} as const;

/**
 * Everything in rotation across the catalogue — wider than any single week of
 * the schedule, which is why this is its own list rather than derived from
 * `WEEK`.
 */
export const GENRES = [
  "R&B",
  "Pop",
  "Country",
  "EDM",
  "Rock",
  "Afrobeat",
  "Amapiano",
  "Kizomba",
  "Zouk",
  "Hip Hop",
  "Trapsoul",
  "Dancehall & Reggae",
  "Reggaeton",
  "House",
  "Lo-fi",
  "Dance Remixes",
];

export type Channel = {
  slug: string;
  name: string;
  strapline: string;
  /** How the room actually works, for the channels page. */
  about: string;
  tracks: number;
  runtime: string;
  cover: string;
  /** The schedule block this channel airs under. */
  block: string;
};

export const CHANNELS: Channel[] = [
  {
    slug: "pop",
    name: "Pop",
    strapline: "Hooks written by people, arranged by machines.",
    about:
      "The room with the biggest hooks and the least patience. Writers bring a top line and a title; the arrangement, the drums and most of the counter-melodies are grown from it. If a chorus hasn't landed inside ninety seconds it doesn't stay in rotation.",
    tracks: 26,
    runtime: "1h 40m",
    cover: "/channels/pop-01.jpg",
    block: "Pop",
  },
  {
    slug: "rnb",
    name: "R&B",
    strapline: "Slow, warm and synthetic in equal measure.",
    about:
      "Most of what you hear here started as a vocal take in a real room and ended as something no room could produce — strings that were never played, reverb from halls that don't exist. The voice is the only part that is never touched.",
    tracks: 27,
    runtime: "1h 52m",
    cover: "/channels/rnb-01.jpg",
    block: "R&B",
  },
  {
    slug: "afrobeat",
    name: "Afrobeat",
    strapline: "Lagos percussion run through a neural net.",
    about:
      "The rhythm section is the part the machines learned hardest and now handle best. Everything above it — the voices, the horn lines, the ad-libs — is human, and always recorded last, over a bed that already exists.",
    tracks: 30,
    runtime: "2h 04m",
    cover: "/channels/afrobeat-01.jpg",
    block: "Afro Mix",
  },
  {
    slug: "country",
    name: "Country",
    strapline: "Old stories, new hands on the console.",
    about:
      "The oldest form on the station and the one that resists the most. Nothing is made here until a person has written the story; the machines are only ever allowed to play the band behind it.",
    tracks: 25,
    runtime: "1h 36m",
    cover: "/channels/country-01.jpg",
    block: "Country",
  },
];

/**
 * The label's whole catalogue — far larger than what any one channel playlist
 * holds, and still growing. Kept deliberately approximate: these are the
 * headline numbers, not an inventory.
 */
export const CATALOGUE = {
  artists: "~300",
  songs: "2,000+",
} as const;

/**
 * Tracks across the four flagship channel playlists. This is a slice of
 * `CATALOGUE`, not the whole thing — never label it as the station's total.
 */
export const CHANNEL_TRACKS = CHANNELS.reduce((sum, c) => sum + c.tracks, 0);

/** Sleeves from the station's own catalogue, for the hero wall. */
export const WALL = Array.from(
  { length: 30 },
  (_, i) => `/wall/${String(i + 1).padStart(2, "0")}.jpg`,
);

export type Artist = {
  slug: string;
  name: string;
  lane: string;
  portrait: string;
};

export const ROSTER: Artist[] = [
  { slug: "luv-tonez", name: "Luv Tonez", lane: "R&B / Soul", portrait: "/roster/luv-tonez.jpg" },
  { slug: "saka", name: "Saka", lane: "Pop / K-Pop", portrait: "/roster/saka.jpg" },
  { slug: "sadie-rose", name: "Sadie Rose", lane: "Country", portrait: "/roster/sadie-rose-01.jpg" },
  { slug: "riven-cole", name: "Riven Cole", lane: "Alt Pop", portrait: "/roster/riven-cole.jpg" },
  { slug: "danni-blaze", name: "Danni Blaze", lane: "Afrobeat", portrait: "/roster/danni-blaze.jpg" },
  { slug: "neka", name: "Neka", lane: "Afro Soul", portrait: "/roster/neka-01.jpg" },
  { slug: "virgo-dunst", name: "Virgo Dunst", lane: "R&B / Pop", portrait: "/roster/virgo-dunst.jpg" },
  { slug: "j-cruz", name: "J Cruz", lane: "Pop", portrait: "/roster/j-cruz.jpg" },
  { slug: "lunah", name: "Lunah", lane: "R&B / Pop", portrait: "/roster/lunah.jpg" },
  { slug: "neilly-storm", name: "Neilly Storm", lane: "Pop / Alt Pop", portrait: "/roster/neilly-storm.jpg" },
  { slug: "lucas-meno", name: "Lucas Meno", lane: "Latin Pop", portrait: "/roster/lucas-meno.jpg" },
  // Added Oct 2026 from the catalogue's IMAGES folders (scripts/roster-portraits.mjs).
  // Lanes are their imprints' genres.
  { slug: "nova-liyah", name: "Nova Liyah", lane: "Pop", portrait: "/roster/nova-liyah.jpg" },
  { slug: "echo-rae", name: "Echo Rae", lane: "Pop", portrait: "/roster/echo-rae.jpg" },
  { slug: "lumi-astra", name: "Lumi Astra", lane: "Pop", portrait: "/roster/lumi-astra.jpg" },
  { slug: "bantan", name: "Bantan", lane: "R&B / Soul", portrait: "/roster/bantan.jpg" },
  { slug: "sanza-benito", name: "Sanza Benito", lane: "Afrobeat", portrait: "/roster/sanza-benito.jpg" },
  { slug: "fizz", name: "Fizz", lane: "Afrobeat", portrait: "/roster/fizz.jpg" },
  { slug: "pala", name: "Pala", lane: "Afrobeat", portrait: "/roster/pala.jpg" },
  { slug: "lea-babi", name: "Lea Babi", lane: "R&B / Soul", portrait: "/roster/lea-babi.jpg" },
];

/** Today's featured record. */
export const DROP = {
  title: "What Is The Point",
  artist: "Luv Tonez",
  lane: "R&B / Soul",
  duration: "3:45",
  /**
   * The day this record entered the seven-day rotation. The label counts
   * forward from here rather than being written down, so it can't freeze on
   * "day 3" the way a hardcoded string does.
   */
  rotationStart: "2026-08-09",
  rotationLength: 7,
  note: "A late-night question set to a slow drum. Luv Tonez wrote the top line in one sitting; the strings underneath were grown from a four-bar seed and never touched again.",
  artwork: "/roster/luv-tonez-square.jpg",
  audio:
    "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/01.%20What%20Is%20The%20Point-yVTu2BJJUXQFz1hU7RESaxGTamdKc9.mp3",
};

/* ------------------------------------------------------------- the week */

/**
 * The station's actual weekly programming, transcribed from the scheduler.
 *
 * `start` and `end` are 24-hour clock positions; a block running to the end of
 * the day is stored as 24 rather than 23.99, so durations add up to a clean
 * 168 hours a week.
 */
export type Block = { start: number; end: number; label: string };

export const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Indexed to match `Date.getDay()` — 0 is Sunday. */
export const WEEK: Block[][] = [
  // Sunday — the one day with its own shape.
  [
    { start: 0, end: 3, label: "Afro Mix" },
    { start: 3, end: 5, label: "French Mix" },
    { start: 5, end: 9, label: "Sunday Lofi" },
    { start: 9, end: 12, label: "Sunday Church" },
    { start: 12, end: 15, label: "Sunday House" },
    { start: 15, end: 18, label: "Amapiano" },
    { start: 18, end: 24, label: "Pop & R&B" },
  ],
  // Monday
  [
    { start: 0, end: 3, label: "Afro Mix" },
    { start: 3, end: 5, label: "French Mix" },
    { start: 5, end: 7, label: "Afrobeat" },
    { start: 7, end: 9, label: "R&B" },
    { start: 9, end: 11, label: "Country" },
    { start: 11, end: 13, label: "Pop" },
    { start: 13, end: 15, label: "Reggaeton" },
    { start: 15, end: 17, label: "Dancehall & Reggae" },
    { start: 17, end: 19, label: "Hip Hop" },
    { start: 19, end: 21, label: "Kizomba Mix" },
    { start: 21, end: 23, label: "Trapsoul" },
    { start: 23, end: 24, label: "Sunday Lofi" },
  ],
  // Tuesday
  [
    { start: 0, end: 3, label: "French Mix" },
    { start: 3, end: 5, label: "Afro Mix" },
    { start: 5, end: 7, label: "R&B" },
    { start: 7, end: 9, label: "Country" },
    { start: 9, end: 11, label: "Kizomba Mix" },
    { start: 11, end: 13, label: "Dancehall & Reggae" },
    { start: 13, end: 15, label: "Hip Hop" },
    { start: 15, end: 17, label: "Afrobeat" },
    { start: 17, end: 19, label: "Trapsoul" },
    { start: 19, end: 21, label: "Pop" },
    { start: 21, end: 23, label: "R&B" },
    { start: 23, end: 24, label: "Sunday Lofi" },
  ],
  // Wednesday
  [
    { start: 0, end: 3, label: "Afro Mix" },
    { start: 3, end: 5, label: "French Mix" },
    { start: 5, end: 7, label: "Country" },
    { start: 7, end: 9, label: "Pop" },
    { start: 9, end: 11, label: "Afro Mix" },
    { start: 11, end: 13, label: "R&B" },
    { start: 13, end: 15, label: "Trapsoul" },
    { start: 15, end: 17, label: "Reggaeton" },
    { start: 17, end: 19, label: "Dancehall & Reggae" },
    { start: 19, end: 21, label: "Hip Hop" },
    { start: 21, end: 23, label: "Pop & R&B" },
    { start: 23, end: 24, label: "Sunday Lofi" },
  ],
  // Thursday
  [
    { start: 0, end: 3, label: "French Mix" },
    { start: 3, end: 5, label: "Afro Mix" },
    { start: 5, end: 7, label: "Pop" },
    { start: 7, end: 9, label: "Hip Hop" },
    { start: 9, end: 11, label: "Amapiano" },
    { start: 11, end: 13, label: "R&B" },
    { start: 13, end: 15, label: "Kizomba Mix" },
    { start: 15, end: 17, label: "Trapsoul" },
    { start: 17, end: 19, label: "Country" },
    { start: 19, end: 21, label: "Reggaeton" },
    { start: 21, end: 23, label: "Dancehall & Reggae" },
    { start: 23, end: 24, label: "Sunday Lofi" },
  ],
  // Friday
  [
    { start: 0, end: 3, label: "Afro Mix" },
    { start: 3, end: 5, label: "French Mix" },
    { start: 5, end: 7, label: "Trapsoul" },
    { start: 7, end: 9, label: "Dancehall & Reggae" },
    { start: 9, end: 11, label: "R&B" },
    { start: 11, end: 13, label: "Pop" },
    { start: 13, end: 15, label: "Hip Hop" },
    { start: 15, end: 17, label: "Kizomba Mix" },
    { start: 17, end: 19, label: "Reggaeton" },
    { start: 19, end: 21, label: "Dancehall & Reggae" },
    { start: 21, end: 24, label: "Afro Mix" },
  ],
  // Saturday
  [
    { start: 0, end: 3, label: "French Mix" },
    { start: 3, end: 5, label: "Afro Mix" },
    { start: 5, end: 7, label: "Dancehall & Reggae" },
    { start: 7, end: 9, label: "Trapsoul" },
    { start: 9, end: 11, label: "Reggaeton" },
    { start: 11, end: 13, label: "Afro Mix" },
    { start: 13, end: 15, label: "Amapiano" },
    { start: 15, end: 17, label: "Sunday House" },
    { start: 17, end: 19, label: "Kizomba Mix" },
    { start: 19, end: 21, label: "Hip Hop" },
    { start: 21, end: 24, label: "Dance Remixes" },
  ],
];

/**
 * Families, used to give the week grid a readable tonal order without
 * introducing colour. Anything unlisted falls back to the quietest tone.
 */
export const FAMILIES: Record<string, string[]> = {
  "Afro": ["Afro Mix", "Afrobeat", "Amapiano", "Kizomba Mix"],
  "R&B & hip hop": ["R&B", "Trapsoul", "Pop & R&B", "Hip Hop"],
  "Latin & Caribbean": ["Reggaeton", "Dancehall & Reggae"],
  "Pop & country": ["Pop", "Country", "Dance Remixes"],
  "Late night & Sunday": [
    "French Mix",
    "Sunday Lofi",
    "Sunday Church",
    "Sunday House",
  ],
};

export const FAMILY_NAMES = Object.keys(FAMILIES);

export function familyOf(label: string) {
  return FAMILY_NAMES.find((name) => FAMILIES[name].includes(label)) ?? null;
}

/** Every distinct block on the timetable. */
export const ALL_BLOCKS = Array.from(
  new Set(WEEK.flat().map((b) => b.label)),
).sort();

export const HOURS_A_WEEK = WEEK.flat().reduce((sum, b) => sum + (b.end - b.start), 0);

/** What is on air on `day` at `hour`. */
export function blockAt(day: number, hour: number) {
  return WEEK[day]?.find((b) => hour >= b.start && hour < b.end) ?? null;
}

/** The block after the one currently running, wrapping into tomorrow. */
export function nextBlock(day: number, hour: number) {
  const today = WEEK[day] ?? [];
  const later = today.find((b) => b.start > hour);
  if (later) return { block: later, day, tomorrow: false };
  const nextDay = (day + 1) % 7;
  const first = WEEK[nextDay]?.[0];
  return first ? { block: first, day: nextDay, tomorrow: true } : null;
}

/**
 * What a block gets across the week, worked out from the timetable rather than
 * typed in — so no page can disagree with the schedule.
 */
export function airtime(label: string) {
  const perDay = WEEK.map((day) => day.filter((b) => b.label === label));
  const slots = perDay.flat();
  const hours = slots.reduce((sum, b) => sum + (b.end - b.start), 0);
  const days = perDay.filter((d) => d.length > 0).length;
  return { slots, hours, days, perDay };
}

/** Blocks ranked by how much of the week they take. */
export const BLOCKS_BY_AIRTIME = ALL_BLOCKS.map((label) => ({
  label,
  ...airtime(label),
})).sort((a, b) => b.hours - a.hours);

/** Every block on the timetable that isn't one of the four channels. */
export const OTHER_BLOCKS = ALL_BLOCKS.filter(
  (label) => !CHANNELS.some((c) => c.block === label),
);

/**
 * Where "Support the station" sends people. Null until the station has a
 * payment link — the page shows the free ways to help instead of a dead
 * button.
 */
export const SUPPORT_URL: string | null = null;

export const SOCIALS = [
  { label: "Instagram", href: "https://instagram.com/musicsquareradio" },
  { label: "X", href: "https://x.com/musicsquareradio" },
  { label: "YouTube", href: "https://youtube.com/@musicsquareradio" },
  { label: "Facebook", href: "https://facebook.com/musicsquareradio" },
];

/**
 * Absolute hrefs, so the nav works from any page rather than only the home
 * page. `/#id` entries are the ones the scroll-spy watches.
 */
export const NAV = [
  { label: "Channels", href: "/channels" },
  { label: "Schedule", href: "/schedule" },
  { label: "Roster", href: "/#roster" },
  { label: "About", href: "/about" },
];
