-- Quote to job workflow persistence.
-- Mirrors the Drizzle schema additions for accepted quote conversion.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quote_status') THEN
    CREATE TYPE quote_status AS ENUM (
      'draft',
      'sent',
      'accepted',
      'declined',
      'converted',
      'lost'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  reference text NOT NULL,
  customer_id uuid NOT NULL,
  site_id uuid,
  title text NOT NULL,
  description text,
  owner_user_id uuid,
  status quote_status NOT NULL DEFAULT 'draft',
  value numeric(14, 2) NOT NULL DEFAULT 0,
  converted_job_id uuid,
  accepted_at timestamptz,
  converted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS quotes_tenant_reference_unique
  ON quotes (tenant_id, reference);

CREATE INDEX IF NOT EXISTS quotes_tenant_customer_idx
  ON quotes (tenant_id, customer_id);

CREATE INDEX IF NOT EXISTS quotes_tenant_site_idx
  ON quotes (tenant_id, site_id);

CREATE INDEX IF NOT EXISTS quotes_tenant_status_idx
  ON quotes (tenant_id, status);

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS source_quote_id uuid;

CREATE INDEX IF NOT EXISTS jobs_tenant_source_quote_idx
  ON jobs (tenant_id, source_quote_id);

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON quotes;
CREATE POLICY tenant_isolation ON quotes
  USING (tenant_id = hubflo_current_tenant_id())
  WITH CHECK (tenant_id = hubflo_current_tenant_id());
