alter table public.cms_entries
  add column if not exists details jsonb not null default '{}'::jsonb,
  add column if not exists source_key text;

alter table public.cms_entries drop constraint if exists cms_entries_collection_check;
alter table public.cms_entries add constraint cms_entries_collection_check
  check (collection in ('blog', 'notice', 'member', 'facility', 'publication'));
alter table public.cms_entries drop constraint if exists cms_source_path;
alter table public.cms_entries add constraint cms_source_path check (
  source_path is null or
  (collection in ('blog', 'notice') and source_path ~ '^_(blog|notice)/[^/]+[.]md$') or
  (collection = 'member' and source_path ~ '^_members/([^/]+/)*[^/]+[.]md$') or
  (collection = 'facility' and source_path = '_data/facility.yaml') or
  (collection = 'publication' and source_path = '_data/citations.yaml')
);
alter table public.cms_entries add constraint cms_details_object check (jsonb_typeof(details) = 'object');
alter table public.cms_entries add constraint cms_source_key check (
  source_key is null or (collection in ('facility', 'publication') and
    (source_key ~ '^(0|[1-9][0-9]*)$' or source_key = 'cms:' || id::text))
);
drop index if exists public.cms_entries_active_source;
create unique index cms_entries_active_source
  on public.cms_entries(source_path, coalesce(source_key, ''))
  where source_path is not null and status <> 'published';
