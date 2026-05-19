alter table public.operator_messages replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'operator_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.operator_messages';
  end if;
end$$;