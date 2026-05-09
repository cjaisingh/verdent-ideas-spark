UPDATE public.plan_tasks SET status='done', updated_at=now()
WHERE id IN (
  '538532f2-194e-4430-b13f-0ab6bd223f06',
  'ff629895-0cdb-4cae-a8d2-634960ba1bc7',
  '32322a05-8449-45b0-b420-346f6a41dc90',
  'd690e0ee-f9a7-4816-81a9-dc2185b3a95c'
);
UPDATE public.plan_workstreams SET status='done', updated_at=now()
WHERE id='5be947f5-4db4-43bb-a575-3342531cc82f';