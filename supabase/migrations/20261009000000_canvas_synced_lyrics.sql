-- Canvas loops and synced lyrics for GoSquare.
--
-- Canvas: a short silent 9:16 loop (AI video made from the cover) that plays
-- behind the Now Playing screen. It belongs to a cover, so every song showing
-- that cover shows its Canvas. scripts/catalog/canvas.mjs uploads
-- ~/Sites/canvas/<cover checksum>.mp4 to audio/canvas/<sha>.mp4; a new cover
-- has a new checksum, so an old Canvas never sits on a new cover.
--
-- Synced lyrics: start time of each lyric line, worked out on Robert's Mac by
-- scripts/catalog/sync-lyrics.mjs (whisper.cpp + alignment). synced_checksum
-- is the lyrics checksum the timings were made from; when the lyrics change,
-- the timings are stale and the app falls back to plain lyrics.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

alter table album_covers add column if not exists canvas_key text;
alter table album_covers add column if not exists canvas_checksum text;
alter table song_art     add column if not exists canvas_key text;
alter table song_art     add column if not exists canvas_checksum text;

alter table song_lyrics add column if not exists synced jsonb;           -- {"lines": [...], "start": [seconds...]}
alter table song_lyrics add column if not exists synced_checksum text;
alter table song_lyrics add column if not exists synced_at timestamptz;

-- Same columns as before plus canvas_key at the end, so the view can be
-- replaced in place. A song with its own cover uses that cover's Canvas only.
create or replace view song_covers with (security_invoker = true) as
select
  s.song_id,
  s.song_code,
  coalesce(a.storage_key, c.storage_key) as cover_key,
  case when a.song_id is not null then a.canvas_key else c.canvas_key end as canvas_key
from songs s
left join song_art a     on a.song_id = s.song_id
left join album_covers c on c.folder_path = regexp_replace(s.source_path, '/[^/]*$', '')
where coalesce(a.storage_key, c.storage_key) is not null;

grant select on song_covers to anon, authenticated;

notify pgrst, 'reload schema';
