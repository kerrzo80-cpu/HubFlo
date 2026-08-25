-- RLS for schema additions used by AWS staging ETL (files, leads, takeoffs, integrations).
-- Apply after tables exist (drizzle migrate or manual create).

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
    'files',
    'leads',
    'takeoff_projects',
    'integration_connections'
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
