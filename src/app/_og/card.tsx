import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The share card, shared by `opengraph-image` and `twitter-image`.
 *
 * This is the station's front door everywhere links get pasted — WhatsApp,
 * Slack, X, Instagram DMs — so it is built from the real lockup and real
 * sleeves rather than a generic screenshot. Everything here resolves at build
 * time: both routes are static, so the fonts and sleeves are read once during
 * the build and the output is a plain PNG on the CDN. Nothing is fetched at
 * request time, which is what keeps the card from ever rendering blank when a
 * crawler hits it faster than the stream API can answer.
 */

const INK = "#0a0a0b";
const PAPER = "#ffffff";
const GOLD = "#c8a44d";
const GOLD_HI = "#f3e0a8";
const GOLD_DEEP = "#8a6a22";
const ASH = "#8c8c92";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";
export const OG_ALT =
  "Musicsquare Radio — AI magic with human expertise. On air 24/7 from California.";

/**
 * Six sleeves from the hero wall, spaced across the 30 so the block of
 * artwork doesn't read as one artist. Fixed rather than random: a card that
 * changes between builds busts every social platform's image cache.
 */
const SLEEVES = ["01", "06", "12", "18", "23", "28"];

/** The mark, in the viewBox units of `LogoMark` so the geometry can't drift. */
const MARK = 76;
const U = MARK / 28;

async function loadAssets() {
  const root = process.cwd();
  const [bodoni, mono, ...sleeves] = await Promise.all([
    readFile(join(root, "src/app/_og/bodoni-800.woff")),
    readFile(join(root, "src/app/_og/space-mono-400.woff")),
    ...SLEEVES.map((n) => readFile(join(root, `public/wall/${n}.jpg`))),
  ]);

  return {
    bodoni,
    mono,
    sleeves: sleeves.map(
      (buf) => `data:image/jpeg;base64,${buf.toString("base64")}`,
    ),
  };
}

/** The split square, rebuilt in boxes because satori won't rasterise our SVG. */
function LogoMarkBoxes() {
  const bar = (
    left: number,
    top: number,
    width: number,
    height: number,
    key: string,
  ) => (
    <div
      key={key}
      style={{
        position: "absolute",
        left: left * U,
        top: top * U,
        width: width * U,
        height: height * U,
        background: GOLD,
      }}
    />
  );

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: MARK,
        height: MARK,
        border: `${(1.5 * U).toFixed(1)}px solid ${GOLD}`,
        boxSizing: "border-box",
        flex: "none",
      }}
    >
      {/* The continuous half. */}
      {bar(4.5, 4.5, 8, 19, "solid")}
      {/* The same square, sampled. */}
      {bar(15.5, 4.5, 8, 3, "s1")}
      {bar(15.5, 9.5, 5, 3, "s2")}
      {bar(15.5, 14.5, 8, 3, "s3")}
      {bar(15.5, 19.5, 3.5, 4, "s4")}
    </div>
  );
}

export async function renderOgCard() {
  const { bodoni, mono, sleeves } = await loadAssets();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: INK,
          fontFamily: "SpaceMono",
          position: "relative",
        }}
      >
        {/* Station ident: the engraved rule the whole site is ruled with. */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 5,
            display: "flex",
            backgroundImage: `linear-gradient(90deg, ${GOLD_DEEP}, ${GOLD} 45%, ${GOLD_HI})`,
          }}
        />

        {/* ---------------------------------------------- the human half */}
        <div
          style={{
            width: 800,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "0 64px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <LogoMarkBoxes />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div
                style={{
                  display: "flex",
                  fontFamily: "Bodoni",
                  fontSize: 68,
                  lineHeight: 1,
                  letterSpacing: -1.4,
                  color: PAPER,
                }}
              >
                MUSICSQUARE
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 19,
                  letterSpacing: 11,
                  color: "rgba(255,255,255,0.68)",
                }}
              >
                RADIO
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              height: 1,
              background: "rgba(200,164,77,0.45)",
              margin: "42px 0 34px",
            }}
          />

          <div
            style={{
              display: "flex",
              fontSize: 21,
              letterSpacing: 3.6,
              lineHeight: 1.5,
              color: "rgba(255,255,255,0.84)",
            }}
          >
            AI MAGIC WITH HUMAN EXPERTISE
          </div>
        </div>

        {/*
          Telemetry, pinned to the baseline. Two lines rather than one: on a
          single row the genre list ran under the sleeve column and clipped
          mid-word, and this block has to stay clear of the artwork at 400px.
        */}
        <div
          style={{
            position: "absolute",
            left: 64,
            bottom: 52,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: 17,
              letterSpacing: 2.2,
            }}
          >
            <div
              style={{
                display: "flex",
                width: 9,
                height: 9,
                borderRadius: 5,
                background: GOLD,
              }}
            />
            <div style={{ display: "flex", color: GOLD }}>ON AIR 24/7</div>
            <div style={{ display: "flex", color: "rgba(255,255,255,0.22)" }}>
              /
            </div>
            <div style={{ display: "flex", color: ASH }}>CALIFORNIA</div>
          </div>

          <div
            style={{
              display: "flex",
              fontSize: 16,
              letterSpacing: 2.4,
              color: "rgba(255,255,255,0.4)",
            }}
          >
            POP · R&B · AFROBEAT · COUNTRY
          </div>
        </div>

        {/* ------------------------------------------- the machine half */}
        <div
          style={{
            width: 400,
            height: "100%",
            display: "flex",
            flexWrap: "wrap",
            position: "relative",
          }}
        >
          {sleeves.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={SLEEVES[i]}
              src={src}
              alt=""
              width={200}
              height={210}
              style={{ width: 200, height: 210, objectFit: "cover" }}
            />
          ))}

          {/* Hold the sleeves back so the card stays ink-dominant. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              background: "rgba(10,10,11,0.34)",
            }}
          />
          {/* Feather the seam instead of butting type against artwork. */}
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              width: 150,
              display: "flex",
              backgroundImage: `linear-gradient(90deg, ${INK}, rgba(10,10,11,0))`,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              width: 1,
              display: "flex",
              background: "rgba(200,164,77,0.4)",
            }}
          />
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Bodoni", data: bodoni, weight: 800, style: "normal" },
        { name: "SpaceMono", data: mono, weight: 400, style: "normal" },
      ],
    },
  );
}
