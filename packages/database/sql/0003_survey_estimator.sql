DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'survey_status') THEN
    CREATE TYPE survey_status AS ENUM ('draft', 'ready_for_review', 'complete', 'sent_to_estimator');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estimate_status') THEN
    CREATE TYPE estimate_status AS ENUM ('draft', 'in_review', 'approved', 'pushed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, reference text NOT NULL, version integer NOT NULL DEFAULT 1,
  status survey_status NOT NULL DEFAULT 'draft', customer_id uuid, customer_name text NOT NULL, site_id uuid, site_address text NOT NULL,
  primary_contact jsonb NOT NULL DEFAULT '{}', additional_contacts jsonb NOT NULL DEFAULT '[]', surveyor_user_id uuid, surveyor_name text NOT NULL,
  survey_date date NOT NULL, required_by_date date, customer_requirements text NOT NULL DEFAULT '', occupancy text NOT NULL, market text NOT NULL,
  job_type text NOT NULL, assumptions jsonb NOT NULL DEFAULT '[]', completed_at timestamptz, sent_to_estimator_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS surveys_tenant_reference_unique ON surveys (tenant_id, reference);
CREATE INDEX IF NOT EXISTS surveys_tenant_status_idx ON surveys (tenant_id, status);

CREATE TABLE IF NOT EXISTS survey_job_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, survey_id uuid NOT NULL, record_type text NOT NULL,
  record_id text NOT NULL, reference text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS survey_job_links_survey_unique ON survey_job_links (tenant_id, survey_id);
CREATE INDEX IF NOT EXISTS survey_job_links_record_idx ON survey_job_links (tenant_id, record_type, record_id);

CREATE TABLE IF NOT EXISTS survey_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, survey_id uuid NOT NULL, key text NOT NULL, section text NOT NULL,
  question text NOT NULL, value jsonb, status text NOT NULL, tbc_reason text, notes text NOT NULL DEFAULT '', photo_ids jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS survey_answers_survey_key_unique ON survey_answers (tenant_id, survey_id, key);
CREATE INDEX IF NOT EXISTS survey_answers_survey_idx ON survey_answers (tenant_id, survey_id);

CREATE TABLE IF NOT EXISTS survey_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, survey_id uuid NOT NULL, name text NOT NULL,
  length_m numeric(10,3), width_m numeric(10,3), height_m numeric(10,3), wall_construction text, floor_construction text,
  ceiling_construction text, access_notes text, photo_ids jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS survey_rooms_survey_idx ON survey_rooms (tenant_id, survey_id);

CREATE TABLE IF NOT EXISTS survey_scope_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, survey_id uuid NOT NULL, task_type text NOT NULL, trade text NOT NULL,
  room_or_area text, existing_position text, proposed_position text, quantity numeric(12,3) NOT NULL DEFAULT 1, dimensions text,
  status text NOT NULL, responsibility text NOT NULL, notes text NOT NULL DEFAULT '', photo_ids jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS survey_scope_items_survey_idx ON survey_scope_items (tenant_id, survey_id);

CREATE TABLE IF NOT EXISTS survey_pipe_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, survey_id uuid NOT NULL, service text NOT NULL,
  from_location text NOT NULL, to_location text NOT NULL, measured_length_m numeric(10,3), pipe_size text, material text, route text,
  insulation_required boolean NOT NULL DEFAULT false, direction_changes jsonb NOT NULL DEFAULT '[]', access_difficulty text,
  fire_stopping boolean NOT NULL DEFAULT false, core_drilling boolean NOT NULL DEFAULT false, making_good boolean NOT NULL DEFAULT false,
  measurement_status text NOT NULL, tbc_reason text, notes text NOT NULL DEFAULT '', photo_ids jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS survey_pipe_runs_survey_idx ON survey_pipe_runs (tenant_id, survey_id);

CREATE TABLE IF NOT EXISTS survey_equipment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, survey_id uuid NOT NULL, category text NOT NULL,
  room_or_area text, description text NOT NULL, make text, model text, supplier_code text, quantity numeric(12,3) NOT NULL DEFAULT 1,
  dimensions text, output_or_capacity text, connection_requirements text, confirmed_supplier_price numeric(14,2),
  rfq_required boolean NOT NULL DEFAULT false, status text NOT NULL, tbc_reason text, notes text NOT NULL DEFAULT '', photo_ids jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS survey_equipment_items_survey_idx ON survey_equipment_items (tenant_id, survey_id);
CREATE INDEX IF NOT EXISTS survey_equipment_items_rfq_idx ON survey_equipment_items (tenant_id, rfq_required);

CREATE TABLE IF NOT EXISTS survey_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, survey_id uuid NOT NULL, category text NOT NULL,
  file_name text NOT NULL, mime_type text NOT NULL, size integer NOT NULL, storage_key text NOT NULL, caption text,
  captured_at timestamptz NOT NULL, survey_section text NOT NULL, scope_item_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS survey_photos_survey_idx ON survey_photos (tenant_id, survey_id);

CREATE TABLE IF NOT EXISTS survey_tbc_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, survey_id uuid NOT NULL, source_type text NOT NULL,
  source_id text NOT NULL, reason text NOT NULL, resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS survey_tbc_items_survey_idx ON survey_tbc_items (tenant_id, survey_id);

CREATE TABLE IF NOT EXISTS survey_work_by_others (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, survey_id uuid NOT NULL, description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS survey_work_by_others_survey_idx ON survey_work_by_others (tenant_id, survey_id);

CREATE TABLE IF NOT EXISTS survey_completion_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, survey_id uuid NOT NULL, survey_version integer NOT NULL,
  can_complete boolean NOT NULL, result jsonb NOT NULL, checked_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS survey_completion_checks_survey_idx ON survey_completion_checks (tenant_id, survey_id, survey_version);

CREATE TABLE IF NOT EXISTS material_assemblies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, key text NOT NULL, name text NOT NULL, version integer NOT NULL DEFAULT 1,
  job_types jsonb NOT NULL DEFAULT '[]', active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS material_assemblies_tenant_key_version_unique ON material_assemblies (tenant_id, key, version);

CREATE TABLE IF NOT EXISTS material_assembly_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, assembly_id uuid NOT NULL, key text NOT NULL,
  description text NOT NULL, trade text NOT NULL, unit text NOT NULL, quantity_basis text NOT NULL, configuration jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS material_assembly_items_key_unique ON material_assembly_items (tenant_id, assembly_id, key);

CREATE TABLE IF NOT EXISTS material_calculation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, key text NOT NULL, version integer NOT NULL DEFAULT 1,
  rule_type text NOT NULL, configuration jsonb NOT NULL, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS material_calculation_rules_key_unique ON material_calculation_rules (tenant_id, key, version);

CREATE TABLE IF NOT EXISTS survey_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, reference text NOT NULL, survey_id uuid NOT NULL,
  source_survey_version integer NOT NULL, version integer NOT NULL DEFAULT 1, status estimate_status NOT NULL DEFAULT 'draft',
  pricing_profile jsonb NOT NULL, scope_of_works jsonb NOT NULL DEFAULT '[]', questions jsonb NOT NULL DEFAULT '[]',
  assumptions jsonb NOT NULL DEFAULT '[]', exclusions jsonb NOT NULL DEFAULT '[]', risk_notes jsonb NOT NULL DEFAULT '[]',
  simpro_mappings jsonb NOT NULL DEFAULT '{}', core_quote_id text, core_quote_ref text, pushed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS survey_estimates_tenant_reference_unique ON survey_estimates (tenant_id, reference);
CREATE INDEX IF NOT EXISTS survey_estimates_survey_idx ON survey_estimates (tenant_id, survey_id);

CREATE TABLE IF NOT EXISTS estimate_material_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, estimate_id uuid NOT NULL, cost_centre text NOT NULL,
  trade text NOT NULL, description text NOT NULL, quantity numeric(14,3) NOT NULL, unit text NOT NULL, unit_cost numeric(14,2),
  markup_percent numeric(7,3) NOT NULL, status text NOT NULL, source_type text NOT NULL, source_id text NOT NULL,
  calculation_explanation text NOT NULL, supplier text, notes text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estimate_material_lines_estimate_idx ON estimate_material_lines (tenant_id, estimate_id);
CREATE INDEX IF NOT EXISTS estimate_material_lines_status_idx ON estimate_material_lines (tenant_id, status);

CREATE TABLE IF NOT EXISTS estimate_labour_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, estimate_id uuid NOT NULL, cost_centre text NOT NULL,
  trade text NOT NULL, labour_type text NOT NULL, description text NOT NULL, hours numeric(10,2) NOT NULL,
  cost_rate numeric(14,2) NOT NULL, sell_rate numeric(14,2) NOT NULL, status text NOT NULL, calculation_basis text NOT NULL,
  source_type text NOT NULL, source_id text NOT NULL, notes text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estimate_labour_lines_estimate_idx ON estimate_labour_lines (tenant_id, estimate_id);

CREATE TABLE IF NOT EXISTS estimate_generation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, estimate_id uuid NOT NULL, source_survey_version integer NOT NULL,
  rule_version text NOT NULL, summary text NOT NULL, started_at timestamptz NOT NULL, completed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estimate_generation_runs_estimate_idx ON estimate_generation_runs (tenant_id, estimate_id);

CREATE TABLE IF NOT EXISTS estimate_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, estimate_id uuid NOT NULL, line_type text NOT NULL,
  line_id text NOT NULL, reason text NOT NULL, actor_user_id uuid, actor_name text NOT NULL, reusable boolean NOT NULL DEFAULT false,
  correction jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estimate_corrections_estimate_idx ON estimate_corrections (tenant_id, estimate_id);
CREATE INDEX IF NOT EXISTS estimate_corrections_reusable_idx ON estimate_corrections (tenant_id, reusable);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'surveys', 'survey_job_links', 'survey_answers', 'survey_rooms', 'survey_scope_items', 'survey_pipe_runs',
    'survey_equipment_items', 'survey_photos', 'survey_tbc_items', 'survey_work_by_others', 'survey_completion_checks',
    'material_assemblies', 'material_assembly_items', 'material_calculation_rules', 'survey_estimates',
    'estimate_material_lines', 'estimate_labour_lines', 'estimate_generation_runs', 'estimate_corrections'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = hubflo_current_tenant_id()) WITH CHECK (tenant_id = hubflo_current_tenant_id())', table_name);
  END LOOP;
END $$;
