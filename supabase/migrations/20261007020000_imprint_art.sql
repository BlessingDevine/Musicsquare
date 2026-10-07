-- Label (imprint) artwork: each imprint folder in IMPRINT/ holds a Cover and a
-- Logo image (Cover.png / Logo.png), uploaded by scripts/catalog/covers.mjs.
-- GoSquare shows the cover on the label's page, its Browse tile and its radio
-- channel, and the logo in the Imprints row.
--
-- Keyed by imprint slug rather than added to imprints, so artwork for a label
-- with no music yet (no imprints row) is ready the moment its songs arrive.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

create table if not exists imprint_art (
  slug        text primary key,                  -- imprints.slug (parseImprint in scan.mjs)
  cover_key   text,                              -- audio/imprints/<sha>.jpg
  logo_key    text,
  cover_checksum text,
  logo_checksum  text,
  updated_at  timestamptz not null default now()
);

alter table imprint_art enable row level security;

drop policy if exists "public reads imprint art" on imprint_art;
create policy "public reads imprint art" on imprint_art
  for select to anon, authenticated using (true);

grant select on imprint_art to anon, authenticated;
grant all on imprint_art to service_role;

notify pgrst, 'reload schema';
