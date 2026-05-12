
select cron.schedule(
  'scheduled-connections-probe',
  '*/30 * * * *',
  $$
    select net.http_post(
      url := 'https://agzkyzyzopcgeobofjaz.supabase.co/functions/v1/connections-inventory?probe=all',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-awip-service-token', (select decrypted_secret from vault.decrypted_secrets where name = 'AWIP_SERVICE_TOKEN')
      ),
      body := '{}'::jsonb
    );
  $$
);
