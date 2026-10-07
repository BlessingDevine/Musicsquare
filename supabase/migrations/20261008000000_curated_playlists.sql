-- Curated playlists: Robert keeps one file per playlist in
-- SQUARE BUSINESS/PLAYLISTS/ (song per line, optional same-name cover image);
-- scripts/catalog/playlists.mjs loads them into playlists / playlist_songs
-- with owner_type 'curator'. They need a cover, which playlists didn't have.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

alter table playlists add column if not exists cover_key text;        -- audio/covers/<sha>.jpg (+ -300/-600)
alter table playlists add column if not exists cover_checksum text;
alter table playlists add column if not exists source_file text;      -- the playlist's file name in PLAYLISTS/

notify pgrst, 'reload schema';
