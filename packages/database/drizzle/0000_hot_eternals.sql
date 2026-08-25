CREATE TYPE "public"."alert_status" AS ENUM('open', 'acknowledged', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."estimate_status" AS ENUM('draft', 'in_review', 'approved', 'pushed');--> statement-breakpoint
CREATE TYPE "public"."job_health" AS ENUM('green', 'amber', 'red');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'accepted', 'declined', 'converted', 'lost');--> statement-breakpoint
CREATE TYPE "public"."survey_status" AS ENUM('draft', 'ready_for_review', 'complete', 'sent_to_estimator');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'in_progress', 'waiting', 'complete', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."variation_status" AS ENUM('detected', 'needs_review', 'priced', 'sent_to_client', 'approved', 'rejected', 'added_to_job_value', 'ready_to_invoice');--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"linked_record_type" text NOT NULL,
	"linked_record_id" uuid NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"owner_user_id" uuid,
	"due_at" timestamp with time zone,
	"status" "alert_status" DEFAULT 'open' NOT NULL,
	"created_source" text DEFAULT 'system' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid,
	"site_id" uuid,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"make" text,
	"model" text,
	"serial_number" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_service_date" date,
	"next_service_date" date,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"record_type" text NOT NULL,
	"record_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blockers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"severity" "job_health" DEFAULT 'amber' NOT NULL,
	"owner_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"timezone" text DEFAULT 'Europe/London' NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"operational_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"account_reference" text,
	"email" text,
	"phone" text,
	"billing_address" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimate_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"estimate_id" uuid NOT NULL,
	"line_type" text NOT NULL,
	"line_id" text NOT NULL,
	"reason" text NOT NULL,
	"actor_user_id" uuid,
	"actor_name" text NOT NULL,
	"reusable" boolean DEFAULT false NOT NULL,
	"correction" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimate_generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"estimate_id" uuid NOT NULL,
	"source_survey_version" integer NOT NULL,
	"rule_version" text NOT NULL,
	"summary" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimate_labour_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"estimate_id" uuid NOT NULL,
	"cost_centre" text NOT NULL,
	"trade" text NOT NULL,
	"labour_type" text NOT NULL,
	"description" text NOT NULL,
	"hours" numeric(10, 2) NOT NULL,
	"cost_rate" numeric(14, 2) NOT NULL,
	"sell_rate" numeric(14, 2) NOT NULL,
	"status" text NOT NULL,
	"calculation_basis" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimate_material_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"estimate_id" uuid NOT NULL,
	"cost_centre" text NOT NULL,
	"trade" text NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit" text NOT NULL,
	"unit_cost" numeric(14, 2),
	"markup_percent" numeric(7, 3) NOT NULL,
	"status" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"calculation_explanation" text NOT NULL,
	"supplier" text,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"bucket" text,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"checksum_sha256" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"legacy_storage_key" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"semantic_category" text NOT NULL,
	"health_effect" "job_health",
	"sort_order" integer DEFAULT 0 NOT NULL,
	"terminal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"assigned_user_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"engineer_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_workflow_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"visit_id" uuid,
	"process_template_id" uuid NOT NULL,
	"current_stage_key" text,
	"status" text DEFAULT 'not_started' NOT NULL,
	"submission" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"source_quote_id" uuid,
	"status_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"health" "job_health" DEFAULT 'green' NOT NULL,
	"original_quote_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"revised_job_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"scheduled_start" timestamp with time zone,
	"scheduled_end" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legacy_id" text,
	"reference" text,
	"customer_name" text NOT NULL,
	"site_name" text,
	"status" text NOT NULL,
	"source" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_assemblies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"job_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_assembly_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assembly_id" uuid NOT NULL,
	"key" text NOT NULL,
	"description" text NOT NULL,
	"trade" text NOT NULL,
	"unit" text NOT NULL,
	"quantity_basis" text NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_calculation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"rule_type" text NOT NULL,
	"configuration" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"status" "membership_status" DEFAULT 'invited' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "process_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"job_type" text NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"site_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"owner_user_id" uuid,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"converted_job_id" uuid,
	"accepted_at" timestamp with time zone,
	"converted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_system_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"asset_id" uuid,
	"type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"start_date" date NOT NULL,
	"renewal_date" date,
	"next_service_due_date" date,
	"price" numeric(14, 2),
	"billing_frequency" text,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" jsonb NOT NULL,
	"access_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"key" text NOT NULL,
	"section" text NOT NULL,
	"question" text NOT NULL,
	"value" jsonb,
	"status" text NOT NULL,
	"tbc_reason" text,
	"notes" text DEFAULT '' NOT NULL,
	"photo_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_completion_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"survey_version" integer NOT NULL,
	"can_complete" boolean NOT NULL,
	"result" jsonb NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_equipment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"category" text NOT NULL,
	"room_or_area" text,
	"description" text NOT NULL,
	"make" text,
	"model" text,
	"supplier_code" text,
	"quantity" numeric(12, 3) DEFAULT '1' NOT NULL,
	"dimensions" text,
	"output_or_capacity" text,
	"connection_requirements" text,
	"confirmed_supplier_price" numeric(14, 2),
	"rfq_required" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"tbc_reason" text,
	"notes" text DEFAULT '' NOT NULL,
	"photo_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"survey_id" uuid NOT NULL,
	"source_survey_version" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "estimate_status" DEFAULT 'draft' NOT NULL,
	"pricing_profile" jsonb NOT NULL,
	"scope_of_works" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exclusions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"simpro_mappings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"core_quote_id" text,
	"core_quote_ref" text,
	"pushed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_job_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"record_type" text NOT NULL,
	"record_id" text NOT NULL,
	"reference" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"category" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"caption" text,
	"captured_at" timestamp with time zone NOT NULL,
	"survey_section" text NOT NULL,
	"scope_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_pipe_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"service" text NOT NULL,
	"from_location" text NOT NULL,
	"to_location" text NOT NULL,
	"measured_length_m" numeric(10, 3),
	"pipe_size" text,
	"material" text,
	"route" text,
	"insulation_required" boolean DEFAULT false NOT NULL,
	"direction_changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"access_difficulty" text,
	"fire_stopping" boolean DEFAULT false NOT NULL,
	"core_drilling" boolean DEFAULT false NOT NULL,
	"making_good" boolean DEFAULT false NOT NULL,
	"measurement_status" text NOT NULL,
	"tbc_reason" text,
	"notes" text DEFAULT '' NOT NULL,
	"photo_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"name" text NOT NULL,
	"length_m" numeric(10, 3),
	"width_m" numeric(10, 3),
	"height_m" numeric(10, 3),
	"wall_construction" text,
	"floor_construction" text,
	"ceiling_construction" text,
	"access_notes" text,
	"photo_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_scope_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"task_type" text NOT NULL,
	"trade" text NOT NULL,
	"room_or_area" text,
	"existing_position" text,
	"proposed_position" text,
	"quantity" numeric(12, 3) DEFAULT '1' NOT NULL,
	"dimensions" text,
	"status" text NOT NULL,
	"responsibility" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"photo_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_tbc_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"reason" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_work_by_others" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "surveys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "survey_status" DEFAULT 'draft' NOT NULL,
	"customer_id" uuid,
	"customer_name" text NOT NULL,
	"site_id" uuid,
	"site_address" text NOT NULL,
	"primary_contact" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"additional_contacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"surveyor_user_id" uuid,
	"surveyor_name" text NOT NULL,
	"survey_date" date NOT NULL,
	"required_by_date" date,
	"customer_requirements" text DEFAULT '' NOT NULL,
	"occupancy" text NOT NULL,
	"market" text NOT NULL,
	"job_type" text NOT NULL,
	"assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"sent_to_estimator_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "takeoff_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legacy_id" text,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"owner_user_id" uuid,
	"due_at" timestamp with time zone,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"linked_record_type" text NOT NULL,
	"linked_record_id" uuid NOT NULL,
	"created_source" text DEFAULT 'manual' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"legal_name" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"actor_user_id" uuid,
	"source" text DEFAULT 'system' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timesheet_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"visit_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "variation_status" DEFAULT 'detected' NOT NULL,
	"cost_value" numeric(14, 2),
	"sell_value" numeric(14, 2),
	"detected_source" text DEFAULT 'manual' NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "alerts_tenant_status_idx" ON "alerts" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "alerts_tenant_linked_record_idx" ON "alerts" USING btree ("tenant_id","linked_record_type","linked_record_id");--> statement-breakpoint
CREATE INDEX "assets_tenant_site_idx" ON "assets" USING btree ("tenant_id","site_id");--> statement-breakpoint
CREATE INDEX "assets_tenant_next_service_idx" ON "assets" USING btree ("tenant_id","next_service_date");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_record_idx" ON "audit_logs" USING btree ("tenant_id","record_type","record_id");--> statement-breakpoint
CREATE INDEX "blockers_tenant_job_idx" ON "blockers" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_settings_tenant_unique" ON "company_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "customers_tenant_idx" ON "customers" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_tenant_reference_unique" ON "customers" USING btree ("tenant_id","account_reference");--> statement-breakpoint
CREATE INDEX "estimate_corrections_estimate_idx" ON "estimate_corrections" USING btree ("tenant_id","estimate_id");--> statement-breakpoint
CREATE INDEX "estimate_corrections_reusable_idx" ON "estimate_corrections" USING btree ("tenant_id","reusable");--> statement-breakpoint
CREATE INDEX "estimate_generation_runs_estimate_idx" ON "estimate_generation_runs" USING btree ("tenant_id","estimate_id");--> statement-breakpoint
CREATE INDEX "estimate_labour_lines_estimate_idx" ON "estimate_labour_lines" USING btree ("tenant_id","estimate_id");--> statement-breakpoint
CREATE INDEX "estimate_material_lines_estimate_idx" ON "estimate_material_lines" USING btree ("tenant_id","estimate_id");--> statement-breakpoint
CREATE INDEX "estimate_material_lines_status_idx" ON "estimate_material_lines" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "files_tenant_storage_key_unique" ON "files" USING btree ("tenant_id","storage_key");--> statement-breakpoint
CREATE INDEX "files_tenant_entity_idx" ON "files" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_tenant_provider_unique" ON "integration_connections" USING btree ("tenant_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "job_statuses_tenant_key_unique" ON "job_statuses" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "job_visits_tenant_job_idx" ON "job_visits" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX "job_visits_tenant_user_idx" ON "job_visits" USING btree ("tenant_id","assigned_user_id");--> statement-breakpoint
CREATE INDEX "workflow_instances_tenant_job_idx" ON "job_workflow_instances" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_tenant_reference_unique" ON "jobs" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE INDEX "jobs_tenant_customer_idx" ON "jobs" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "jobs_tenant_site_idx" ON "jobs" USING btree ("tenant_id","site_id");--> statement-breakpoint
CREATE INDEX "jobs_tenant_source_quote_idx" ON "jobs" USING btree ("tenant_id","source_quote_id");--> statement-breakpoint
CREATE INDEX "jobs_tenant_health_idx" ON "jobs" USING btree ("tenant_id","health");--> statement-breakpoint
CREATE INDEX "leads_tenant_idx" ON "leads" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_tenant_legacy_unique" ON "leads" USING btree ("tenant_id","legacy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_assemblies_tenant_key_version_unique" ON "material_assemblies" USING btree ("tenant_id","key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "material_assembly_items_key_unique" ON "material_assembly_items" USING btree ("tenant_id","assembly_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "material_calculation_rules_key_unique" ON "material_calculation_rules" USING btree ("tenant_id","key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_user_unique" ON "memberships" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_tenant_idx" ON "memberships" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "process_templates_tenant_key_version_unique" ON "process_templates" USING btree ("tenant_id","key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_tenant_reference_unique" ON "quotes" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE INDEX "quotes_tenant_customer_idx" ON "quotes" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "quotes_tenant_site_idx" ON "quotes" USING btree ("tenant_id","site_id");--> statement-breakpoint
CREATE INDEX "quotes_tenant_status_idx" ON "quotes" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_tenant_key_unique" ON "roles" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "roles_tenant_idx" ON "roles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "service_plans_tenant_due_idx" ON "service_plans" USING btree ("tenant_id","next_service_due_date");--> statement-breakpoint
CREATE INDEX "sites_tenant_idx" ON "sites" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "sites_tenant_customer_idx" ON "sites" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_answers_survey_key_unique" ON "survey_answers" USING btree ("tenant_id","survey_id","key");--> statement-breakpoint
CREATE INDEX "survey_answers_survey_idx" ON "survey_answers" USING btree ("tenant_id","survey_id");--> statement-breakpoint
CREATE INDEX "survey_completion_checks_survey_idx" ON "survey_completion_checks" USING btree ("tenant_id","survey_id","survey_version");--> statement-breakpoint
CREATE INDEX "survey_equipment_items_survey_idx" ON "survey_equipment_items" USING btree ("tenant_id","survey_id");--> statement-breakpoint
CREATE INDEX "survey_equipment_items_rfq_idx" ON "survey_equipment_items" USING btree ("tenant_id","rfq_required");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_estimates_tenant_reference_unique" ON "survey_estimates" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE INDEX "survey_estimates_survey_idx" ON "survey_estimates" USING btree ("tenant_id","survey_id");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_job_links_survey_unique" ON "survey_job_links" USING btree ("tenant_id","survey_id");--> statement-breakpoint
CREATE INDEX "survey_job_links_record_idx" ON "survey_job_links" USING btree ("tenant_id","record_type","record_id");--> statement-breakpoint
CREATE INDEX "survey_photos_survey_idx" ON "survey_photos" USING btree ("tenant_id","survey_id");--> statement-breakpoint
CREATE INDEX "survey_pipe_runs_survey_idx" ON "survey_pipe_runs" USING btree ("tenant_id","survey_id");--> statement-breakpoint
CREATE INDEX "survey_rooms_survey_idx" ON "survey_rooms" USING btree ("tenant_id","survey_id");--> statement-breakpoint
CREATE INDEX "survey_scope_items_survey_idx" ON "survey_scope_items" USING btree ("tenant_id","survey_id");--> statement-breakpoint
CREATE INDEX "survey_tbc_items_survey_idx" ON "survey_tbc_items" USING btree ("tenant_id","survey_id");--> statement-breakpoint
CREATE INDEX "survey_work_by_others_survey_idx" ON "survey_work_by_others" USING btree ("tenant_id","survey_id");--> statement-breakpoint
CREATE UNIQUE INDEX "surveys_tenant_reference_unique" ON "surveys" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE INDEX "surveys_tenant_status_idx" ON "surveys" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "takeoff_projects_tenant_idx" ON "takeoff_projects" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "takeoff_projects_tenant_legacy_unique" ON "takeoff_projects" USING btree ("tenant_id","legacy_id");--> statement-breakpoint
CREATE INDEX "tasks_tenant_owner_idx" ON "tasks" USING btree ("tenant_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "tasks_tenant_linked_record_idx" ON "tasks" USING btree ("tenant_id","linked_record_type","linked_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_unique" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "timeline_events_tenant_job_idx" ON "timeline_events" USING btree ("tenant_id","job_id","occurred_at");--> statement-breakpoint
CREATE INDEX "timesheets_tenant_job_idx" ON "timesheet_entries" USING btree ("tenant_id","job_id");--> statement-breakpoint
CREATE INDEX "timesheets_tenant_user_idx" ON "timesheet_entries" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "variations_tenant_reference_unique" ON "variations" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE INDEX "variations_tenant_job_idx" ON "variations" USING btree ("tenant_id","job_id");