-- Step 3 RLS policies for owner-only settings plus private/public landscapes.

alter table public.user_settings enable row level security;
alter table public.landscapes enable row level security;

drop policy if exists user_settings_select_own on public.user_settings;
create policy user_settings_select_own
on public.user_settings
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists user_settings_insert_own on public.user_settings;
create policy user_settings_insert_own
on public.user_settings
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists user_settings_update_own on public.user_settings;
create policy user_settings_update_own
on public.user_settings
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists user_settings_delete_own on public.user_settings;
create policy user_settings_delete_own
on public.user_settings
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists landscapes_select_own_or_public on public.landscapes;
create policy landscapes_select_own_or_public
on public.landscapes
for select
to anon, authenticated
using (is_public = true or auth.uid() = user_id);

drop policy if exists landscapes_insert_own on public.landscapes;
create policy landscapes_insert_own
on public.landscapes
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists landscapes_update_own on public.landscapes;
create policy landscapes_update_own
on public.landscapes
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists landscapes_delete_own on public.landscapes;
create policy landscapes_delete_own
on public.landscapes
for delete
to authenticated
using (auth.uid() = user_id);
