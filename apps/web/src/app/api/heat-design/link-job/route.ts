import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import {
  jobMaterialsCostTotal,
  kitLinesToJobMaterials,
  previousJobMaterialsCost,
  type KitLine,
} from "@/lib/heat-design";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { parseJsonRequestBody } from "@/lib/http";
import { appendAuditEvent } from "@/lib/people-data";
import { surveyRequestContext } from "@/lib/survey-api";
import { createJob, getJob, getJobs, updateJob } from "@/lib/workflow-data";

type LinkBody = {
  /** Existing job id, or omit / empty to create a new job */
  jobId?: string;
  createNew?: boolean;
  customerName?: string;
  siteAddress?: string;
  projectName?: string;
  chosenSystemLabel?: string;
  flowTemperature?: number;
  emitterMode?: string;
  markupPercent?: number;
  kit: KitLine[];
};

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateJob && !access.canEditJobs) {
    return NextResponse.json(
      { error: "Sign in with job access to link heat design to a Core job." },
      { status: 403 },
    );
  }

  const body = await parseJsonRequestBody<LinkBody>(request);
  if (!body?.kit?.length) {
    return NextResponse.json({ error: "No kit materials to push onto the job." }, { status: 400 });
  }

  const { actor } = surveyRequestContext(request);
  const markupPercent = body.markupPercent ?? 35;
  const materials = kitLinesToJobMaterials(body.kit, markupPercent);
  const materialsCost = jobMaterialsCostTotal(materials);
  const systemLabel = body.chosenSystemLabel || "Heating design";
  const description = [
    `Heat design — ${systemLabel}`,
    body.flowTemperature ? `Design flow ${body.flowTemperature}°C` : null,
    body.emitterMode ? `Emitters: ${body.emitterMode}` : null,
    body.projectName || null,
  ]
    .filter(Boolean)
    .join(" · ");

  const createNew = Boolean(body.createNew) || !body.jobId;
  let job = body.jobId && !createNew ? getJob(body.jobId) : undefined;

  if (!job && !createNew && body.jobId) {
    return NextResponse.json({ error: "Selected job was not found." }, { status: 404 });
  }

  if (!job) {
    if (!access.canCreateJob) {
      return NextResponse.json({ error: "You can link existing jobs, but not create new ones." }, { status: 403 });
    }
    const due = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    job = createJob({
      customer: body.customerName || "Heat design customer",
      site: body.siteAddress || body.customerName || "Site TBC",
      description,
      manager: actor,
      status: "Quoted",
      value: materialsCost,
      next: "Review Heating design cost centre materials",
      due,
    });
  } else {
    const hubPreview = getHubDetailState();
    const existingCentres =
      ((hubPreview.jobCostCentres ?? {}) as Record<string, Array<{ id: string; materials?: unknown[] }>>)[job.id] ??
      [];
    const previousCost = previousJobMaterialsCost(
      existingCentres.find((centre) => centre.id === `heat-design-job-centre-${job!.id}`)?.materials as
        | Array<{ quantity?: number; unitCost?: number }>
        | undefined,
    );
    const nextValue = Math.max(0, Math.round((job.value - previousCost + materialsCost) * 100) / 100);
    updateJob(job.id, {
      description: job.description?.includes("Heat design")
        ? job.description
        : `${job.description}\n${description}`.trim(),
      value: nextValue,
      next: "Review Heating design cost centre materials",
    });
    job = getJob(job.id) ?? job;
  }

  const sectionId = `heat-design-job-section-${job.id}`;
  const centreId = `heat-design-job-centre-${job.id}`;
  const hubState = getHubDetailState();
  const currentSections = (hubState.jobSections ?? {}) as Record<
    string,
    Array<{ id: string; name: string; description: string }>
  >;
  const currentCentres = (hubState.jobCostCentres ?? {}) as Record<
    string,
    Array<{
      id: string;
      name: string;
      sectionId?: string;
      templateName?: string;
      clientDescription: string;
      engineerDescription: string;
      materials: unknown[];
      labour: unknown[];
    }>
  >;

  const prevCentres = currentCentres[job.id] ?? [];
  const withoutOld = prevCentres.filter((centre) => centre.id !== centreId);
  const nextCentre = {
    id: centreId,
    name: "Heating design",
    sectionId,
    templateName: "Heating design",
    clientDescription: description,
    engineerDescription: `${systemLabel} kit from Heat Design (/heat-design).`,
    materials,
    labour: [],
  };

  saveHubDetailState({
    ...hubState,
    jobSections: {
      ...currentSections,
      [job.id]: [
        ...(currentSections[job.id] ?? []).filter((section) => section.id !== sectionId),
        { id: sectionId, name: body.projectName || "Heat design", description: systemLabel },
      ],
    },
    jobCostCentres: {
      ...currentCentres,
      [job.id]: [...withoutOld, nextCentre],
    },
  });

  appendAuditEvent({
    actor,
    action: createNew ? "created" : "updated",
    recordType: "job",
    recordId: job.id,
    summary: `Heat design linked to ${job.ref} with ${materials.length} material line(s) (${systemLabel}).`,
    source: "Heat Design",
    importance: "normal",
  });

  return NextResponse.json({
    job: {
      id: job.id,
      ref: job.ref,
      customer: job.customer,
      site: job.site,
      status: job.status,
      value: job.value,
    },
    created: createNew,
    costCentre: nextCentre,
    lineCount: materials.length,
    materialsCost,
    jobsAvailable: getJobs().length,
    note: "Open Core → Jobs → this job → Heating design cost centre to review materials.",
  });
}
