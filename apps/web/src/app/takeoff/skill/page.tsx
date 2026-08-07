import { redirect } from "next/navigation";

/** Legacy skill board — Blake + Studio replace this entry point. */
export default function TakeoffSkillRedirect() {
  redirect("/takeoff");
}
