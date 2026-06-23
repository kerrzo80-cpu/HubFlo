-- HubFlo tenant isolation policy.
-- The API must set app.current_tenant_id for every transaction:
-- SET LOCAL app.current_tenant_id = '<authenticated tenant uuid>';

CREATE OR REPLACE FUNCTION hubflo_current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'roles',
    'memberships',
    'company_settings',
    'customers',
    'sites',
    'quotes',
    'job_statuses',
    'jobs',
    'job_visits',
    'timeline_events',
    'tasks',
    'blockers',
    'variations',
    'alerts',
    'process_templates',
    'job_workflow_instances',
    'assets',
    'service_plans',
    'timesheet_entries',
    'audit_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
       USING (tenant_id = hubflo_current_tenant_id())
       WITH CHECK (tenant_id = hubflo_current_tenant_id())',
      table_name
    );
  END LOOP;
END
$$;
