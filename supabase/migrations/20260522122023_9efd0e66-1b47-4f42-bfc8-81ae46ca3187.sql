update public.discussion_actions
set status = 'done',
    updated_at = now()
where id in (
  'af78e390-5c7c-4b9b-85bb-2c4f870a3f5d',
  '37b8065d-0c6a-42e3-81f8-5d05a7d5b2e4'
);