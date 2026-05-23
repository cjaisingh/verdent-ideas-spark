
drop trigger if exists log_tenant_node_event_trg on public.tenant_nodes;
drop trigger if exists log_tenant_node_membership_event_trg on public.tenant_node_memberships;
drop function if exists public.log_tenant_node_event();
drop function if exists public.log_tenant_node_membership_event();
