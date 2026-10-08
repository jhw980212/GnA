-- Preserve all legacy records. Restrict browser reads for editors to their Blog.
-- Owners can inspect legacy records directly in the DB, but the CMS API allows Blog only.
drop policy if exists cms_entries_read on public.cms_entries;
create policy cms_entries_read on public.cms_entries for select to authenticated
  using (
    (collection = 'blog' and author_id = auth.uid() and
      exists(select 1 from public.cms_profiles where id = auth.uid() and active))
    or public.cms_is_admin()
  );
