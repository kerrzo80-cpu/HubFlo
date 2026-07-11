import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getClientSites } from "@/lib/people-data";
import { getTakeoffProjects } from "@/lib/takeoff-data";
import { getJobs, getQuotes } from "@/lib/workflow-data";

type FieldRecordType = "quote" | "job";

type FieldRecord = {
  id: string;
  type: FieldRecordType;
  ref: string;
  title: string;
  customer: string;
  site: string;
  description: string;
  status: string;
  value: number;
  projectId?: string;
  uploadTargetId: string;
};

function normalise(value: string) {
  return value.trim().toLowerCase();
}

function matchesQuery(record: FieldRecord, query: string) {
  if (!query) return true;
  return normalise([
    record.ref,
    record.title,
    record.customer,
    record.site,
    record.description,
    record.status,
    record.type,
  ].join(" ")).includes(query);
}

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showQuotes && !access.showJobs) {
    return NextResponse.json([]);
  }

  const url = new URL(request.url);
  const query = normalise(url.searchParams.get("q") ?? "");
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 20;
  const sites = getClientSites();
  const projects = getTakeoffProjects();

  const quoteRecords: FieldRecord[] = access.showQuotes
    ? getQuotes().map((quote) => {
        const site = quote.siteId ? sites.find((item) => item.id === quote.siteId) : undefined;
        const project = projects.find((item) => item.linkedQuoteId === quote.id || item.linkedQuoteRef === quote.ref);
        return {
          id: quote.id,
          type: "quote",
          ref: quote.ref,
          title: quote.description,
          customer: quote.customer,
          site: site?.address ?? "",
          description: quote.description,
          status: quote.status,
          value: quote.value,
          projectId: project?.id,
          uploadTargetId: project?.id ?? quote.id,
        };
      })
    : [];

  const jobRecords: FieldRecord[] = access.showJobs
    ? getJobs().map((job) => {
        const site = job.siteId ? sites.find((item) => item.id === job.siteId) : undefined;
        const project = projects.find((item) => item.linkedJobId === job.id || item.linkedJobRef === job.ref);
        return {
          id: job.id,
          type: "job",
          ref: job.ref,
          title: job.description,
          customer: job.customer,
          site: site?.address ?? job.site,
          description: job.description,
          status: job.status,
          value: job.value,
          projectId: project?.id,
          uploadTargetId: project?.id ?? job.id,
        };
      })
    : [];

  const records = [...quoteRecords, ...jobRecords]
    .filter((record) => matchesQuery(record, query))
    .sort((first, second) => first.ref.localeCompare(second.ref))
    .slice(0, safeLimit);

  return NextResponse.json(records);
}
