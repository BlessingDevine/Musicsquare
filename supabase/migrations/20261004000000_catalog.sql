-- Musicsquare catalogue: the slice of the SquareDrum schema the website needs
-- to run live channels. Table and column names, uuid keys, status vocabularies
-- and timestamps follow "SquareDrum Database Schema and Data Dictionary"
-- (KNOWLEDGE BASE/CATALOG, May 2026) so the COA and the app can grow into the
-- same database later. Deviations from that document are marked DEVIATION.
--
-- Run once in the Supabase SQL editor (or `supabase db push`). Safe to re-run:
-- everything is "if not exists" / "or replace".

create extension if not exists pgcrypto;

-- updated_at maintenance ----------------------------------------------------

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- imprints -------------------------------------------------------------------

create table if not exists imprints (
  imprint_id        uuid primary key default gen_random_uuid(),
  imprint_name      text not null unique,
  slug              text not null unique,           -- DEVIATION: URL key for the website
  parent_company    text not null default 'SQUAREDRUM LLC',
  primary_genre     text not null,
  secondary_genres  text[] not null default '{}',
  target_artist_count integer default 20,
  imprint_positioning text,
  radio_block       text,
  status            text not null default 'active'
                    check (status in ('active', 'testing', 'paused', 'archived')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- artists --------------------------------------------------------------------

create table if not exists artists (
  artist_id          uuid primary key default gen_random_uuid(),
  artist_name        text not null,
  slug               text not null unique,          -- DEVIATION: URL key
  artist_type        text not null default 'AI-powered virtual artist',
  primary_imprint_id uuid references imprints(imprint_id),
  secondary_imprint_id uuid references imprints(imprint_id),
  tier               text not null default 'catalog'
                     check (tier in ('flagship', 'active_roster', 'catalog', 'experimental', 'archived')),
  genre              text,
  subgenre           text,
  languages          text[] not null default '{}',
  persona_summary    text,
  status             text not null default 'active'
                     check (status in ('draft', 'active', 'paused', 'archived')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- songs ----------------------------------------------------------------------

create sequence if not exists song_code_seq;

create table if not exists songs (
  song_id            uuid primary key default gen_random_uuid(),
  -- The intake manual's human-readable ID (SONG-000001), alongside the uuid.
  song_code          text not null unique
                     default ('SONG-' || lpad(nextval('song_code_seq')::text, 6, '0')),
  title              text not null,
  primary_artist_id  uuid references artists(artist_id),
  primary_imprint_id uuid references imprints(imprint_id),
  album_title        text,                          -- DEVIATION: the folders carry albums; no albums table yet
  track_number       integer,
  genre              text,
  subgenre           text,
  language           text,
  bpm                integer,
  song_key           text,
  -- DEVIATION: milliseconds, not seconds. Live channels compute every
  -- listener's position from summed durations; whole seconds would drift by
  -- up to a second per song across a rotation.
  duration_ms        integer check (duration_ms > 0),
  duration_seconds   integer generated always as (round(duration_ms / 1000.0)) stored,
  clean_explicit     text not null default 'clean'
                     check (clean_explicit in ('clean', 'explicit', 'radio_edit', 'instrumental')),
  vocal_type         text,
  -- DEVIATION: separates "(ALT)" takes from originals so rotations don't
  -- play the same song twice.
  version_type       text not null default 'original'
                     check (version_type in ('original', 'alt', 'remix', 'instrumental', 'edit')),
  release_status     text not null default 'draft'
                     check (release_status in ('draft', 'ready', 'testing', 'released_app',
                                               'released_radio', 'released_public', 'archived')),
  rights_status      text not null default 'unknown'
                     check (rights_status in ('clear', 'needs_review', 'unknown', 'restricted')),
  monetization_lane  text,
  tier               text default 'C' check (tier in ('A', 'B', 'C', 'D', 'E')),
  source_path        text,                          -- where the importer found it, relative to IMPRINT/
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists songs_artist_idx  on songs (primary_artist_id);
create index if not exists songs_imprint_idx on songs (primary_imprint_id);

-- song_files -----------------------------------------------------------------

create table if not exists song_files (
  song_file_id uuid primary key default gen_random_uuid(),
  song_id      uuid not null references songs(song_id) on delete cascade,
  file_type    text not null
               check (file_type in ('master_wav', 'mp3', 'instrumental', 'acapella',
                                    'stems', 'lyrics', 'cover_art')),
  -- DEVIATION: the object key in S3 rather than a full URL, so the CDN in
  -- front of it can change without rewriting 20,000 rows.
  storage_key  text not null unique,
  checksum     text,                                -- sha256 of the uploaded bytes
  byte_size    bigint,
  bitrate      integer,
  is_public    boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (song_id, file_type)
);

-- The importer's idempotency key: the same audio is never imported twice,
-- however the file is renamed or moved.
create unique index if not exists song_files_checksum_idx on song_files (checksum)
  where checksum is not null;

-- playlists ------------------------------------------------------------------

create table if not exists playlists (
  playlist_id   uuid primary key default gen_random_uuid(),
  playlist_name text not null,
  slug          text not null unique,               -- DEVIATION: URL key
  playlist_type text not null default 'genre'
                check (playlist_type in ('genre', 'mood', 'imprint', 'artist', 'producer_pick',
                                         'hidden_gem', 'licensing_pack')),
  description   text,
  owner_type    text not null default 'system'
                check (owner_type in ('system', 'user', 'curator', 'COA')),
  is_public     boolean not null default true,
  status        text not null default 'active'
                check (status in ('draft', 'active', 'archived')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists playlist_songs (
  playlist_song_id uuid primary key default gen_random_uuid(),
  playlist_id      uuid not null references playlists(playlist_id) on delete cascade,
  song_id          uuid not null references songs(song_id) on delete cascade,
  sort_order       integer not null default 0,
  added_by         text,
  added_at         timestamptz not null default now(),
  unique (playlist_id, song_id)
);

create index if not exists playlist_songs_playlist_idx on playlist_songs (playlist_id, sort_order);

-- radio_stations (the website's channels) ------------------------------------

create table if not exists radio_stations (
  station_id         uuid primary key default gen_random_uuid(),
  station_name       text not null,
  slug               text not null unique,          -- DEVIATION: URL key
  station_type       text not null default 'genre'
                     check (station_type in ('main', 'imprint', 'genre', 'mood', 'sponsored', 'artist_hosted')),
  related_imprint_id uuid references imprints(imprint_id),
  description        text,
  -- DEVIATION: a live channel plays one rotation continuously, so it points
  -- straight at a playlist instead of going through radio_schedules.
  playlist_id        uuid references playlists(playlist_id),
  -- DEVIATION: the moment the rotation started. Every listener computes the
  -- same position from (now - epoch), which is what makes the channel live
  -- without a streaming server.
  epoch              timestamptz not null default date_trunc('day', now()),
  sort_order         integer not null default 0,
  status             text not null default 'draft'
                     check (status in ('draft', 'active', 'paused', 'archived')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- triggers -------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['imprints', 'artists', 'songs', 'playlists', 'radio_stations'] loop
    execute format('drop trigger if exists %1$s_updated_at on %1$s', t);
    execute format('create trigger %1$s_updated_at before update on %1$s
                    for each row execute function set_updated_at()', t);
  end loop;
end $$;

-- Row Level Security ---------------------------------------------------------
-- Everything is locked by default. The public (the website's anon key) can
-- read only what is released: per the File and Asset Management System, only
-- approved material is used externally. The importer writes with the service
-- role key, which bypasses RLS and never leaves this machine.

alter table imprints       enable row level security;
alter table artists        enable row level security;
alter table songs          enable row level security;
alter table song_files     enable row level security;
alter table playlists      enable row level security;
alter table playlist_songs enable row level security;
alter table radio_stations enable row level security;

create or replace function song_is_public(s songs) returns boolean
language sql immutable as $$
  select s.release_status in ('released_radio', 'released_app', 'released_public')
$$;

drop policy if exists "public reads active imprints" on imprints;
create policy "public reads active imprints" on imprints
  for select to anon, authenticated using (status = 'active');

drop policy if exists "public reads active artists" on artists;
create policy "public reads active artists" on artists
  for select to anon, authenticated using (status = 'active');

drop policy if exists "public reads released songs" on songs;
create policy "public reads released songs" on songs
  for select to anon, authenticated using (song_is_public(songs));

drop policy if exists "public reads public files of released songs" on song_files;
create policy "public reads public files of released songs" on song_files
  for select to anon, authenticated using (
    is_public and exists (select 1 from songs s where s.song_id = song_files.song_id
                          and song_is_public(s))
  );

drop policy if exists "public reads public playlists" on playlists;
create policy "public reads public playlists" on playlists
  for select to anon, authenticated using (is_public and status = 'active');

drop policy if exists "public reads public playlist entries" on playlist_songs;
create policy "public reads public playlist entries" on playlist_songs
  for select to anon, authenticated using (
    exists (select 1 from playlists p where p.playlist_id = playlist_songs.playlist_id
            and p.is_public and p.status = 'active')
  );

drop policy if exists "public reads active stations" on radio_stations;
create policy "public reads active stations" on radio_stations
  for select to anon, authenticated using (status = 'active');

-- channel_tracks: one row per playable track per live channel, in rotation
-- order. security_invoker makes it obey the RLS above, so a draft song or a
-- private file can never appear here.

create or replace view channel_tracks with (security_invoker = true) as
select
  st.slug            as station_slug,
  st.epoch           as station_epoch,
  ps.sort_order,
  s.song_code,
  s.title,
  -- Imprint-level compilations (IMPRINT/<imprint>/MUSIC/<album>/) have no
  -- artist; the imprint is credited instead.
  coalesce(a.artist_name, i.imprint_name) as artist_name,
  s.album_title,
  s.duration_ms,
  f.storage_key
from radio_stations st
join playlist_songs ps on ps.playlist_id = st.playlist_id
join songs s           on s.song_id = ps.song_id
join song_files f      on f.song_id = s.song_id and f.file_type = 'mp3' and f.is_public
left join artists a    on a.artist_id = s.primary_artist_id
left join imprints i   on i.imprint_id = s.primary_imprint_id
where s.duration_ms is not null;

-- Explicit grants. Projects created with "automatically expose new tables"
-- switched off don't get these by default, and the API then reports the
-- tables as missing. RLS above still decides which rows anon can see.

grant usage on schema public to anon, authenticated, service_role;
grant select on imprints, artists, songs, song_files, playlists, playlist_songs,
  radio_stations, channel_tracks to anon, authenticated;
grant all on imprints, artists, songs, song_files, playlists, playlist_songs,
  radio_stations to service_role;
grant usage, select on sequence song_code_seq to service_role;
grant execute on function song_is_public(songs) to anon, authenticated, service_role;

-- Make the API pick up the new tables immediately.
notify pgrst, 'reload schema';
