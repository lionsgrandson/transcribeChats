-- Additive namespace: existing profiles/library/jobs/billing schemas are untouched.
create table public.transcribe_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 10485760),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
alter table public.transcribe_workspaces enable row level security;
revoke all on public.transcribe_workspaces from anon, authenticated;
grant select, insert, update on public.transcribe_workspaces to authenticated;
create policy transcribe_workspace_read on public.transcribe_workspaces for select to authenticated
  using ((select auth.uid()) = user_id);
create policy transcribe_workspace_insert on public.transcribe_workspaces for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy transcribe_workspace_update on public.transcribe_workspaces for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- A separate, private bucket. No changes to the existing media bucket or R2 data.
insert into storage.buckets(id, name, public, file_size_limit)
values ('transcribe-media', 'transcribe-media', false, 52428800)
on conflict (id) do nothing;
create policy transcribe_media_read on storage.objects for select to authenticated
  using (bucket_id = 'transcribe-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy transcribe_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'transcribe-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy transcribe_media_update on storage.objects for update to authenticated
  using (bucket_id = 'transcribe-media' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'transcribe-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Rollback: export transcribe_workspaces and transcribe-media first. The previous
-- app can be redeployed without removing either resource; never drop populated data.
