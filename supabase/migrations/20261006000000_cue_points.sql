-- Cue points for crossfading channels. Where each song's sound really starts
-- and stops, measured from the audio by scripts/catalog/cues.mjs (leading
-- silence; trailing silence or fade-out). Null means "use the whole file".
-- Safe to re-run.

alter table songs add column if not exists cue_in_ms integer check (cue_in_ms >= 0);
alter table songs add column if not exists cue_out_ms integer check (cue_out_ms > 0);

comment on column songs.cue_in_ms is 'Where the sound starts (ms into the file). Null = 0.';
comment on column songs.cue_out_ms is 'Where the mix out may finish (ms into the file). Null = duration_ms.';

-- channel_tracks gains the two cue columns (appended, so the view can be
-- replaced in place). Unchanged otherwise.
create or replace view channel_tracks with (security_invoker = true) as
select
  st.slug            as station_slug,
  st.epoch           as station_epoch,
  ps.sort_order,
  s.song_code,
  s.title,
  coalesce(a.artist_name, i.imprint_name) as artist_name,
  s.album_title,
  s.duration_ms,
  f.storage_key,
  s.cue_in_ms,
  s.cue_out_ms
from radio_stations st
join playlist_songs ps on ps.playlist_id = st.playlist_id
join songs s           on s.song_id = ps.song_id
join song_files f      on f.song_id = s.song_id and f.file_type = 'mp3' and f.is_public
left join artists a    on a.artist_id = s.primary_artist_id
left join imprints i   on i.imprint_id = s.primary_imprint_id
where s.duration_ms is not null;

grant select on channel_tracks to anon, authenticated;

notify pgrst, 'reload schema';
