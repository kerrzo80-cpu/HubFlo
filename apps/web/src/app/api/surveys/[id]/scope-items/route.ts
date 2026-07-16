import { handleSurveyItemPost } from "@/lib/survey-item-api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleSurveyItemPost(request, id, "scopeItems");
}
