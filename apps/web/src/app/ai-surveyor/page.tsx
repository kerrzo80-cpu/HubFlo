import { redirect } from "next/navigation";

export default function AiSurveyorRedirectPage() {
  redirect("/survey/guided?from=ai-surveyor");
}
