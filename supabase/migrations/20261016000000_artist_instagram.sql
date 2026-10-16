-- Instagram handle per artist (without the @), shown as an Instagram button on
-- squaredrum.com artist pages and in GoSquare. Filled from
-- scripts/catalog/socials.json by scripts/catalog/socials.mjs.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

alter table artists add column if not exists instagram text;
alter table artists drop constraint if exists artists_instagram_check;
alter table artists add constraint artists_instagram_check
  check (instagram is null or instagram ~ '^[a-z0-9._]{1,30}$');

notify pgrst, 'reload schema';
