-- Domestic gas & oil stop/go workflows (target Postgres schema).
-- Runtime today uses the JSON store; these tables are the cutover shape.

CREATE TABLE IF NOT EXISTS cost_centres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  stable_code text NOT NULL,
  display_name text NOT NULL,
  property_scope text NOT NULL DEFAULT 'domestic',
  workflow_mode text NOT NULL DEFAULT 'mandatory_stop_go',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cost_centres_tenant_code_unique
  ON cost_centres (tenant_id, stable_code);

CREATE TABLE IF NOT EXISTS workflow_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  cost_centre_code text NOT NULL,
  version integer NOT NULL,
  status text NOT NULL,
  effective_from timestamptz NOT NULL,
  schema_json jsonb NOT NULL,
  pdf_template_key text NOT NULL,
  created_by text,
  published_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS workflow_templates_code_version_unique
  ON workflow_templates (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), cost_centre_code, version);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  job_id uuid NOT NULL,
  job_cost_centre_id text NOT NULL,
  template_id uuid NOT NULL,
  template_version integer NOT NULL,
  status text NOT NULL,
  current_gate_key text NOT NULL,
  started_by text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  linked_unsafe_run_id uuid,
  revision integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS workflow_runs_tenant_job_idx ON workflow_runs (tenant_id, job_id);

CREATE TABLE IF NOT EXISTS workflow_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES workflow_runs(id),
  field_key text NOT NULL,
  repeat_group_id text,
  value_json jsonb,
  answer_status text NOT NULL,
  answered_by text,
  answered_at timestamptz NOT NULL DEFAULT now(),
  source text,
  revision integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS workflow_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES workflow_runs(id),
  field_key text NOT NULL,
  file_id text NOT NULL,
  caption text,
  captured_by text,
  captured_at timestamptz NOT NULL,
  device_timestamp timestamptz,
  server_timestamp timestamptz NOT NULL DEFAULT now(),
  sha256 text NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES workflow_runs(id),
  role text NOT NULL,
  signer_name text NOT NULL,
  signer_capacity text,
  signature_file_id text,
  status text NOT NULL,
  refusal_reason text,
  signed_at timestamptz NOT NULL,
  signed_by_user_id text
);

CREATE TABLE IF NOT EXISTS generated_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES workflow_runs(id),
  record_type text NOT NULL,
  record_number text NOT NULL,
  data_snapshot_json jsonb NOT NULL,
  pdf_file_id text,
  schema_version integer NOT NULL,
  generated_at timestamptz NOT NULL,
  locked_at timestamptz NOT NULL,
  supersedes_id uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS generated_records_tenant_number_unique
  ON generated_records (record_number);

CREATE TABLE IF NOT EXISTS workflow_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  actor_id text NOT NULL,
  event_type text NOT NULL,
  field_key text,
  before_json jsonb,
  after_json jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  device_id text,
  sync_id text
);

CREATE TABLE IF NOT EXISTS employee_competencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id text NOT NULL,
  scheme text NOT NULL,
  category text NOT NULL,
  registration_number text NOT NULL,
  valid_from date NOT NULL,
  expires_at date NOT NULL,
  evidence_file_id text,
  active boolean NOT NULL DEFAULT true
);
