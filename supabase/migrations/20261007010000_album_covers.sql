-- Album covers. One cover per album folder in IMPRINT/, found by
-- scripts/catalog/covers.mjs: an image named "cover" (cover.jpg / .png / .webp)
-- or named exactly like its folder (TRAPSOUL III/Trapsoul III.jpg). Every other
-- image in the folders (artist photos, YouTube art, designs) is ignored.
--
-- DEVIATION from the SquareDrum schema: covers belong to album folders, not
-- to songs, so they live here rather than as song_files rows of type
-- cover_art (song_files.storage_key is unique, so ten songs could not share
-- one cover file). There is still no albums table; the folder is the album.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

create table if not exists album_covers (
  -- The album folder, relative to IMPRINT/, exactly as it appears in the
  -- directory part of songs.source_path.
  folder_path  text primary key,
  -- S3 key under audio/ (the only prefix CloudFront serves), content-addressed:
  -- audio/covers/<sha256 prefix>.jpg — a new cover gets a new key, so CDN
  -- caches never serve a stale image.
  storage_key  text not null,
  source_file  text not null,                     -- the image's file name in the folder
  checksum     text not null,                     -- sha256 of the original image
  width        integer,
  height       integer,
  updated_at   timestamptz not null default now()
);

alter table album_covers enable row level security;

drop policy if exists "public reads album covers" on album_covers;
create policy "public reads album covers" on album_covers
  for select to anon, authenticated using (true);

-- song_covers: each released song with its album's cover. security_invoker
-- makes it obey the songs RLS, so only released songs appear, and it never
-- exposes source_path itself.
create or replace view song_covers with (security_invoker = true) as
select
  s.song_id,
  s.song_code,
  c.storage_key as cover_key
from songs s
join album_covers c
  on c.folder_path = regexp_replace(s.source_path, '/[^/]*$', '');

grant select on album_covers, song_covers to anon, authenticated;
grant all on album_covers to service_role;

notify pgrst, 'reload schema';
