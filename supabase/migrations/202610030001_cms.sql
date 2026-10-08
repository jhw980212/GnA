create extension if not exists pgcrypto;

create table public.cms_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  role text not null default 'editor' check (role in ('editor', 'admin')),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.cms_entries (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.cms_profiles(id),
  collection text not null check (collection in ('blog', 'notice')),
  title text not null,
  date date not null,
  body text not null default '',
  description text not null default '',
  image_alt text not null default '',
  image_caption text not null default '',
  assets jsonb not null default '[]'::jsonb check (jsonb_typeof(assets) = 'array' and jsonb_array_length(assets) <= 10),
  source_path text,
  base_sha text,
  frontmatter jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'changes_requested', 'publishing', 'published')),
  version integer not null default 1 check (version > 0),
  feedback text not null default '',
  commit_sha text,
  commit_url text,
  published_at timestamptz,
  publishing_started_at timestamptz,
  publishing_token uuid,
  pending_commit_sha text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cms_source_path check (source_path is null or source_path ~ '^_(blog|notice)/[^/]+[.]md$')
);
create index cms_entries_author_created on public.cms_entries(author_id, created_at desc);
create index cms_entries_status on public.cms_entries(status);
-- Only one active CMS edit can target a particular existing repository file.
create unique index cms_entries_active_source on public.cms_entries(source_path)
  where source_path is not null and status <> 'published';

create function public.cms_is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select exists(select 1 from public.cms_profiles where id = auth.uid() and role = 'admin' and active) $$;
revoke all on function public.cms_is_admin() from public, anon;
grant execute on function public.cms_is_admin() to authenticated;

alter table public.cms_profiles enable row level security;
alter table public.cms_entries enable row level security;
create policy cms_profiles_read on public.cms_profiles for select to authenticated
  using ((id = auth.uid() and active) or public.cms_is_admin());
create policy cms_entries_read on public.cms_entries for select to authenticated
  using ((author_id = auth.uid() and exists(select 1 from public.cms_profiles where id = auth.uid() and active)) or public.cms_is_admin());
-- No INSERT/UPDATE/DELETE policies: browser requests cannot change roles or bypass review.
revoke all on public.cms_profiles, public.cms_entries from anon, authenticated;
grant select on public.cms_profiles, public.cms_entries to authenticated;
grant all on public.cms_profiles, public.cms_entries to service_role;

create function public.cms_create_profile() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  insert into public.cms_profiles(id, email, display_name, role)
  values(new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'display_name', ''), 'editor')
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.cms_create_profile() from public, anon, authenticated;
create trigger cms_auth_user_created after insert on auth.users
  for each row execute procedure public.cms_create_profile();
insert into public.cms_profiles(id, email, display_name)
  select id, coalesce(email, ''), coalesce(raw_user_meta_data->>'display_name', '') from auth.users
  on conflict (id) do nothing;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values('cms-assets', 'cms-assets', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
-- No browser Storage policies are created. Only the Edge Function uploads or signs assets.
