import { redirect } from "next/navigation";

/** Guided Survey has been retired in favour of simple Survey. */
export default function GuidedSurveyDirectoryRedirect() {
  redirect("/survey");
}
