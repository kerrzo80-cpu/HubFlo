import { redirect } from "next/navigation";

/** Guided Survey has been retired - open the same survey in simple Survey. */
export default async function GuidedSurveyWorkspaceRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/survey/${encodeURIComponent(id)}`);
}
