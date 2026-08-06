import { redirect } from "next/navigation";

/** Legacy pipe-route takeoff — folded into Studio for the Togal-style workflow. */
export default function TakeoffRoutesRedirect() {
  redirect("/takeoff");
}
