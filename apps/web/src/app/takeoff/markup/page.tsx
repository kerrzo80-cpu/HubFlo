import { redirect } from "next/navigation";

/** Old Classic markup URL — plumbing route design now lives at /takeoff/routes */
export default function TakeoffMarkupRedirectPage() {
  redirect("/takeoff/routes");
}
