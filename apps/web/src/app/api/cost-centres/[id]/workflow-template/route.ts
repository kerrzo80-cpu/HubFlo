import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { findDomesticCostCentre } from "@/lib/domestic-stop-go/cost-centres";
import { getPublishedTemplate } from "@/lib/domestic-stop-go/templates";
import { seedDomesticCostCentresIdempotent } from "@/lib/domestic-stop-go/store";
import { getDomesticStopGoStore } from "@/lib/domestic-stop-go/store";
import { getHubDetailState } from "@/lib/hub-detail-store";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const access = getAccessProfileFromHeaders(_request.headers);
  if (!access.showJobs && !access.canCustomize) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  seedDomesticCostCentresIdempotent();
  const { id } = await params;
  const hub = getHubDetailState();
  const centres = Object.values((hub.jobCostCentres ?? {}) as Record<string, Array<{ id?: string; name?: string; templateName?: string }>>)
    .flat()
    .find((item) => item.id === id);
  const storeCentre = getDomesticStopGoStore().costCentres.find((item) => item.id === id || item.stableCode === id.toUpperCase());
  const catalogue = findDomesticCostCentre(id)
    || findDomesticCostCentre(centres?.templateName || centres?.name)
    || storeCentre
    || findDomesticCostCentre(id.replace(/-/g, "_").toUpperCase());
  if (!catalogue) {
    return NextResponse.json({ error: "No domestic stop/go template for this cost centre." }, { status: 404 });
  }
  const template = getPublishedTemplate(catalogue.stableCode);
  return NextResponse.json({
    costCentre: catalogue,
    template,
  });
}
