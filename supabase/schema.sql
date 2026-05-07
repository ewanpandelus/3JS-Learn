-- Step 3 schema: user landscapes and optional user settings.

create extension if not exists "pgcrypto";

create table if not exists public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  theme text not null default 'default',
  units text not null default 'metric',
  default_camera jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.landscapes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  config_json jsonb not null,
  preview_image_url text,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists landscapes_user_id_updated_at_idx
  on public.landscapes (user_id, updated_at desc);

create index if not exists landscapes_public_idx
  on public.landscapes (is_public)
  where is_public = true;

-- Keeps updated_at current on write operations for mutable tables.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
before update on public.user_settings
for each row
execute function public.set_updated_at();

drop trigger if exists landscapes_set_updated_at on public.landscapes;
create trigger landscapes_set_updated_at
before update on public.landscapes
for each row
execute function public.set_updated_at();
