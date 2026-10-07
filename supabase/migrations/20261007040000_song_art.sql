-- Song covers: a single's own artwork (Bantan's "Pressure Feat. Lea Babi"),
-- uploaded by scripts/catalog/covers.mjs from the artist's IMAGES folder.
-- song_covers now prefers a song's own cover over its album's cover; every
-- other song is unchanged.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

create table if not exists song_art (
  song_id      uuid primary key references songs(song_id) on delete cascade,
  storage_key  text not null,          -- audio/covers/<sha>.jpg (+ -300/-600 sizes)
  source_file  text,                   -- relative to IMPRINT/
  checksum     text,
  updated_at   timestamptz not null default now()
);

alter table song_art enable row level security;

drop policy if exists "public reads song art of released songs" on song_art;
create policy "public reads song art of released songs" on song_art
  for select to anon, authenticated
  using (exists (select 1 from songs s where s.song_id = song_art.song_id));

-- Same columns as before (song_id, song_code, cover_key), so the view can be
-- replaced in place.
create or replace view song_covers with (security_invoker = true) as
select
  s.song_id,
  s.song_code,
  coalesce(a.storage_key, c.storage_key) as cover_key
from songs s
left join song_art a     on a.song_id = s.song_id
left join album_covers c on c.folder_path = regexp_replace(s.source_path, '/[^/]*$', '')
where coalesce(a.storage_key, c.storage_key) is not null;

grant select on song_art, song_covers to anon, authenticated;
grant all on song_art to service_role;

notify pgrst, 'reload schema';
