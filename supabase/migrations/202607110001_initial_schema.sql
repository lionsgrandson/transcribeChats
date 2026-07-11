create extension if not exists pgcrypto;

create type public.transcription_source as enum ('upload', 'recording', 'manual');
create type public.transcription_status as enum ('draft', 'uploading', 'queued', 'processing', 'ready', 'failed', 'cancelled');
create type public.language_mode as enum ('auto', 'en', 'he', 'mixed');
create type public.item_kind as enum ('task', 'event', 'note', 'takeaway', 'summary');
create type public.item_status as enum ('needs_review', 'open', 'completed', 'dismissed');
create type public.item_priority as enum ('none', 'low', 'medium', 'high', 'urgent');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  preferred_locale text not null default 'en' check (preferred_locale in ('en', 'he')),
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.transcriptions (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 500),
  source_type public.transcription_source not null,
  status public.transcription_status not null default 'draft',
  language_mode public.language_mode not null default 'auto',
  detected_languages text[] not null default '{}',
  recorded_at timestamptz not null default now(),
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  full_text_cache text not null default '',
  summary_cache text,
  engine_name text,
  engine_version text,
  model_name text,
  revision bigint not null default 1,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.media_assets (
  id uuid primary key,
  transcription_id uuid not null references public.transcriptions(id) on delete cascade,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  sha256 text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.transcript_segments (
  id uuid primary key,
  transcription_id uuid not null references public.transcriptions(id) on delete cascade,
  sequence_no integer not null,
  speaker_label text not null default 'Speaker 1',
  start_ms bigint not null check (start_ms >= 0),
  end_ms bigint not null check (end_ms >= start_ms),
  text text not null,
  original_text text not null,
  language text not null default 'auto',
  confidence real check (confidence is null or confidence between 0 and 1),
  is_user_edited boolean not null default false,
  revision bigint not null default 1,
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (transcription_id, sequence_no)
);

create table public.extracted_items (
  id uuid primary key,
  transcription_id uuid not null references public.transcriptions(id) on delete cascade,
  kind public.item_kind not null,
  title text not null check (char_length(title) between 1 and 500),
  body text,
  status public.item_status not null default 'needs_review',
  priority public.item_priority not null default 'none',
  assignee_text text,
  starts_at timestamptz,
  ends_at timestamptz,
  due_at timestamptz,
  reminder_at timestamptz,
  tags_cache text[] not null default '{}',
  source_segment_ids uuid[] not null default '{}',
  confidence real not null default 0.7 check (confidence between 0 and 1),
  uncertainty_reason text,
  is_user_confirmed boolean not null default false,
  revision bigint not null default 1,
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.transcription_notes (
  id uuid primary key,
  transcription_id uuid not null references public.transcriptions(id) on delete cascade,
  body text not null,
  source_start_ms bigint,
  revision bigint not null default 1,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  transcription_id uuid not null references public.transcriptions(id) on delete cascade,
  kind text not null check (kind in ('transcribe', 'analyze', 'export')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed_retryable', 'failed_terminal', 'cancelled')),
  stage text not null default 'queued',
  progress_percent numeric(5,2) not null default 0 check (progress_percent between 0 and 100),
  attempt integer not null default 0,
  max_attempts integer not null default 3,
  idempotency_key text not null unique,
  worker_id uuid,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  error_code text,
  user_error_message text,
  diagnostic text,
  requested_options jsonb not null default '{}'::jsonb,
  result_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index transcriptions_workspace_updated_idx on public.transcriptions(workspace_id, updated_at desc) where deleted_at is null;
create index transcript_segments_parent_idx on public.transcript_segments(transcription_id, sequence_no) where deleted_at is null;
create index extracted_items_parent_idx on public.extracted_items(transcription_id, status) where deleted_at is null;
create index extracted_items_due_idx on public.extracted_items(due_at) where status in ('needs_review', 'open') and deleted_at is null;
create index processing_jobs_claim_idx on public.processing_jobs(status, created_at) where status in ('queued', 'failed_retryable');

create or replace function public.set_row_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  if tg_op = 'UPDATE' and to_jsonb(new) ? 'revision' then new.revision = old.revision + 1; end if;
  return new;
end;
$$;

create trigger profiles_updated before update on public.profiles for each row execute function public.set_row_updated_at();
create trigger workspaces_updated before update on public.workspaces for each row execute function public.set_row_updated_at();
create trigger transcriptions_updated before update on public.transcriptions for each row execute function public.set_row_updated_at();
create trigger segments_updated before update on public.transcript_segments for each row execute function public.set_row_updated_at();
create trigger items_updated before update on public.extracted_items for each row execute function public.set_row_updated_at();
create trigger notes_updated before update on public.transcription_notes for each row execute function public.set_row_updated_at();
create trigger jobs_updated before update on public.processing_jobs for each row execute function public.set_row_updated_at();

create or replace function public.ensure_personal_workspace()
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  workspace_uuid uuid;
  user_email text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select workspace_id into workspace_uuid from public.workspace_members where user_id = auth.uid() and role = 'owner' order by created_at limit 1;
  if workspace_uuid is not null then return workspace_uuid; end if;
  select email into user_email from auth.users where id = auth.uid();
  insert into public.profiles(id, display_name) values (auth.uid(), split_part(coalesce(user_email, 'My'), '@', 1)) on conflict (id) do nothing;
  insert into public.workspaces(name, owner_id) values ('My workspace', auth.uid()) returning id into workspace_uuid;
  insert into public.workspace_members(workspace_id, user_id, role) values (workspace_uuid, auth.uid(), 'owner');
  return workspace_uuid;
end;
$$;

create or replace function public.is_workspace_member(candidate uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists(select 1 from public.workspace_members where workspace_id = candidate and user_id = auth.uid()) $$;

grant execute on function public.ensure_personal_workspace() to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.transcriptions enable row level security;
alter table public.media_assets enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.extracted_items enable row level security;
alter table public.transcription_notes enable row level security;
alter table public.processing_jobs enable row level security;

create policy profiles_self_select on public.profiles for select using (id = auth.uid());
create policy profiles_self_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy workspace_member_select on public.workspaces for select using (public.is_workspace_member(id));
create policy workspace_owner_update on public.workspaces for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy members_member_select on public.workspace_members for select using (public.is_workspace_member(workspace_id));

create policy transcriptions_member_all on public.transcriptions for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id) and created_by = auth.uid() and updated_by = auth.uid());

create policy media_member_all on public.media_assets for all
using (exists(select 1 from public.transcriptions t where t.id = transcription_id and public.is_workspace_member(t.workspace_id)))
with check (exists(select 1 from public.transcriptions t where t.id = transcription_id and public.is_workspace_member(t.workspace_id)));

create policy segments_member_all on public.transcript_segments for all
using (exists(select 1 from public.transcriptions t where t.id = transcription_id and public.is_workspace_member(t.workspace_id)))
with check (exists(select 1 from public.transcriptions t where t.id = transcription_id and public.is_workspace_member(t.workspace_id)) and updated_by = auth.uid());

create policy items_member_all on public.extracted_items for all
using (exists(select 1 from public.transcriptions t where t.id = transcription_id and public.is_workspace_member(t.workspace_id)))
with check (exists(select 1 from public.transcriptions t where t.id = transcription_id and public.is_workspace_member(t.workspace_id)) and updated_by = auth.uid());

create policy notes_member_all on public.transcription_notes for all
using (exists(select 1 from public.transcriptions t where t.id = transcription_id and public.is_workspace_member(t.workspace_id)))
with check (exists(select 1 from public.transcriptions t where t.id = transcription_id and public.is_workspace_member(t.workspace_id)) and created_by = auth.uid() and updated_by = auth.uid());

create policy jobs_member_select on public.processing_jobs for select
using (exists(select 1 from public.transcriptions t where t.id = transcription_id and public.is_workspace_member(t.workspace_id)));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 2147483648, array['audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/webm','video/mp4','video/quicktime','video/webm'])
on conflict (id) do update set public = false;

create policy media_storage_select on storage.objects for select to authenticated
using (bucket_id = 'media' and public.is_workspace_member((storage.foldername(name))[1]::uuid));
create policy media_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'media' and public.is_workspace_member((storage.foldername(name))[1]::uuid) and (storage.foldername(name))[2] = auth.uid()::text);
create policy media_storage_update on storage.objects for update to authenticated
using (bucket_id = 'media' and public.is_workspace_member((storage.foldername(name))[1]::uuid))
with check (bucket_id = 'media' and public.is_workspace_member((storage.foldername(name))[1]::uuid));
create policy media_storage_delete on storage.objects for delete to authenticated
using (bucket_id = 'media' and public.is_workspace_member((storage.foldername(name))[1]::uuid));

grant select, insert, update, delete on public.profiles, public.workspaces, public.workspace_members, public.transcriptions, public.media_assets, public.transcript_segments, public.extracted_items, public.transcription_notes to authenticated;
grant select on public.processing_jobs to authenticated;
