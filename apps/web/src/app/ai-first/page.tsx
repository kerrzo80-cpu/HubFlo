import { redirect } from "next/navigation";

/** AI-first clickable prototype retired — production intake is /ai-intake. */
export default function AiFirstRedirectPage() {
  redirect("/ai-intake");
}
