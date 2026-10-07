-- Lyrics and videos per song, loaded by scripts/catalog/media.mjs from each
-- artist's DOCUMENTS/ (lyrics) and VIDEOS/ (videos) folders. GoSquare shows a
-- Lyrics button and a Video button in the player for songs that have them.
--
-- Visible only for released songs: the policies check songs, whose own RLS
-- hides anything unreleased.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

create table if not exists song_lyrics (
  song_id      uuid primary key references songs(song_id) on delete cascade,
  lyrics       text not null,          -- as written, section tags kept ([Verse 1], [Chorus])
  source_file  text,                   -- relative to IMPRINT/
  checksum     text,
  updated_at   timestamptz not null default now()
);

create table if not exists song_videos (
  song_id      uuid not null references songs(song_id) on delete cascade,
  kind         text not null check (kind in ('music_video', 'lyric_video', 'canvas')),
  storage_key  text not null,          -- audio/videos/<sha>.mp4 (1080p H.264, CDN-served)
  poster_key   text,                   -- audio/videos/<sha>.jpg
  duration_ms  integer,
  width        integer,
  height       integer,
  source_file  text,
  checksum     text,
  updated_at   timestamptz not null default now(),
  primary key (song_id, kind)
);

alter table song_lyrics enable row level security;
alter table song_videos enable row level security;

drop policy if exists "public reads lyrics of released songs" on song_lyrics;
create policy "public reads lyrics of released songs" on song_lyrics
  for select to anon, authenticated
  using (exists (select 1 from songs s where s.song_id = song_lyrics.song_id));

drop policy if exists "public reads videos of released songs" on song_videos;
create policy "public reads videos of released songs" on song_videos
  for select to anon, authenticated
  using (exists (select 1 from songs s where s.song_id = song_videos.song_id));

grant select on song_lyrics, song_videos to anon, authenticated;
grant all on song_lyrics, song_videos to service_role;

notify pgrst, 'reload schema';
