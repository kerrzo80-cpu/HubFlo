import { redirect } from "next/navigation";
import { fieldPath } from "@/lib/field/routes";

/** Connect tab removed — keep URL harmless for old bookmarks / SW precache. */
export default function SettingsPage() {
  redirect(fieldPath("/"));
}
