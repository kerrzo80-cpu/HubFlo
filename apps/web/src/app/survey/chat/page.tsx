import { redirect } from "next/navigation";

export default function SurveyChatRedirectPage() {
  redirect("/survey/guided?from=survey-chat");
}
