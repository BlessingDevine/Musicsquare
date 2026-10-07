-- Clips: short vertical videos (teasers, behind-the-scenes, Reels/Shorts
-- cut-downs) for GoSquare's Clips row and swipeable full-screen feed. They
-- come from files named "... Vertical" in an artist's VIDEOS/ folder
-- (scripts/catalog/media.mjs), stored like the other song videos.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

alter table song_videos drop constraint if exists song_videos_kind_check;
alter table song_videos add constraint song_videos_kind_check
  check (kind in ('music_video', 'lyric_video', 'canvas', 'clip'));

notify pgrst, 'reload schema';
