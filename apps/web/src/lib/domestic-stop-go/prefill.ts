import type { Employee } from "@/lib/access";
import { getHubDetailState } from "@/lib/hub-detail-store";
import { getClients, getClientSites } from "@/lib/people-data";
import { getEngineerScheduleItem, type EngineerScheduleItem } from "@/lib/engineer-data";
import { getJobs, type Job } from "@/lib/workflow-data";
import { getDomesticStopGoStore } from "@/lib/domestic-stop-go/store";
import type { AnswerPatch, EmployeeCompetency, WorkflowRun, WorkflowTemplate } from "@/lib/domestic-stop-go/types";

function isBlank(value: unknown) {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

function joinContact(parts: Array<string | undefined | null>) {
  return [...new Set(parts.map((item) => String(item || "").trim()).filter(Boolean))].join(" · ");
}

function isPlaceholderPhone(phone: string) {
  const compact = phone.replace(/\s+/g, "");
  return compact === "" || compact === "+441224000000" || compact === "441224000000";
}

function todayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nowTime() {
  return new Date().toISOString().slice(11, 16);
}

function normaliseName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function findEmployeeCard(engineerId?: string, engineerName?: string): Employee | null {
  const employees = (getHubDetailState().employees ?? []) as Employee[];
  if (engineerId) {
    const byId = employees.find((item) => !item.archived && item.id === engineerId);
    if (byId) return byId;
  }
  if (engineerName) {
    const target = normaliseName(engineerName);
    const byName = employees.find((item) => !item.archived && normaliseName(item.name) === target);
    if (byName) return byName;
  }
  return null;
}

function licenseReference(employee: Employee | null, typePattern: RegExp) {
  const licenses = employee?.profile?.licenses ?? [];
  const match = licenses.find((item) => typePattern.test(item.type || "") && String(item.reference || "").trim());
  return String(match?.reference || "").trim();
}

function gasSafeDigits(raw: string) {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 12 ? digits : raw.trim();
}

function competencyRegistration(employeeIds: string[], scheme: EmployeeCompetency["scheme"]) {
  const store = getDomesticStopGoStore();
  const match = store.competencies.find(
    (item) => item.active && item.scheme === scheme && employeeIds.includes(item.employeeId) && item.registrationNumber,
  );
  return match?.registrationNumber || "";
}

function workRequestedFromVisit(job: Job | undefined, schedule: EngineerScheduleItem | null | undefined, costCentreName?: string) {
  const fromCentre = (schedule?.costCentre || costCentreName || "").trim();
  if (fromCentre) return fromCentre;
  const fromDescription = (schedule?.description || job?.description || "").trim();
  return fromDescription;
}

export function scheduledSlotLabel(schedule: EngineerScheduleItem | null | undefined, job: Job | undefined) {
  const date = schedule?.date || job?.scheduledDate || "";
  const time = schedule?.start || job?.scheduledTime || "";
  if (date && time) return `${date} at ${time}`;
  return date || time;
}

export function annotateAttendanceHelp(template: WorkflowTemplate, slot: string): WorkflowTemplate {
  if (!slot) return template;
  return {
    ...template,
    fields: template.fields.map((field) => {
      if (field.fieldKey === "attendance.attendance_date") {
        return { ...field, helpText: `Scheduled diary slot: ${slot}. Change if you attended on a different day.` };
      }
      if (field.fieldKey === "attendance.arrival_time") {
        return { ...field, helpText: `Scheduled start: ${slot}. Change if you arrived later.` };
      }
      return field;
    }),
  };
}

export function buildAttendancePrefill(input: {
  run: WorkflowRun;
  actorId: string;
  actorName?: string;
  job?: Job;
  scheduleId?: string;
  costCentreName?: string;
}): AnswerPatch[] {
  const scheduleId = input.scheduleId || input.run.scheduleId;
  const schedule = scheduleId ? getEngineerScheduleItem(scheduleId) : null;
  const job = input.job || getJobs().find((item) => item.id === input.run.jobId);
  const client = job?.clientId ? getClients().find((item) => item.id === job.clientId) : undefined;
  const site = job?.siteId ? getClientSites().find((item) => item.id === job.siteId) : undefined;
  const engineerName = input.actorName || schedule?.engineerName || "";
  const employee = findEmployeeCard(input.actorId, engineerName) || findEmployeeCard(schedule?.engineerId, schedule?.engineerName);
  const employeeId = employee?.id || input.actorId || schedule?.engineerId || "";
  const competencyIds = [...new Set([input.actorId, employee?.id, schedule?.engineerId].filter(Boolean) as string[])];
  const gasSafe = gasSafeDigits(
    licenseReference(employee, /gas\s*safe/i) || competencyRegistration(competencyIds, "Gas Safe"),
  );
  const oftec = licenseReference(employee, /oftec/i) || competencyRegistration(competencyIds, "OFTEC");
  const address = schedule?.address || site?.address || job?.site || "";
  const postcode = address.split(",").at(-1)?.trim() || "";
  const customerName = (client?.name || job?.customer || schedule?.customer || "").trim();
  const contactName = [schedule?.contactName, site?.primaryContact, client?.primaryContact]
    .map((item) => String(item || "").trim())
    .find((item) => {
      if (!item) return false;
      if (/^(occupier|tenant|customer|homeowner)$/i.test(item)) return false;
      const normalised = normaliseName(item);
      return normalised !== normaliseName(engineerName) && normalised !== normaliseName(customerName);
    });
  const phone = [client?.phone, schedule?.phone].find((item) => item && !isPlaceholderPhone(item)) || "";
  const customerContact = joinContact([contactName, phone, client?.email]);
  const attendanceDate = schedule?.date || job?.scheduledDate || todayIsoDate();
  const arrivalTime = schedule?.start || job?.scheduledTime || nowTime();
  const workRequested = workRequestedFromVisit(job, schedule, input.costCentreName);
  const engineerIds = joinContact([employeeId, gasSafe, oftec]);

  return [
    { fieldKey: "attendance.job_number", value: job?.ref || input.run.jobId },
    { fieldKey: "attendance.appointment_id", value: scheduleId || input.run.scheduleId || "" },
    { fieldKey: "attendance.property_address", value: address },
    { fieldKey: "attendance.postcode", value: postcode },
    { fieldKey: "attendance.attendance_date", value: attendanceDate },
    { fieldKey: "attendance.arrival_time", value: arrivalTime },
    { fieldKey: "attendance.engineer_user_id", value: input.actorId || employeeId },
    { fieldKey: "attendance.engineer_id", value: employeeId },
    { fieldKey: "attendance.customer_name", value: customerName },
    { fieldKey: "attendance.customer_contact", value: customerContact },
    { fieldKey: "attendance.work_requested", value: workRequested },
    { fieldKey: "attendance.gas_safe_number", value: gasSafe },
    { fieldKey: "attendance.oftec_registration", value: oftec },
    { fieldKey: "attendance.technician_details", value: engineerName || employee?.name || "" },
    { fieldKey: "lgsr.property_address", value: address },
    { fieldKey: "review.engineer_name", value: engineerName || employee?.name || input.actorId },
    { fieldKey: "review.engineer_ids", value: engineerIds },
    { fieldKey: "review.customer_name", value: customerName },
    { fieldKey: "unsafe.linked_origin", value: input.run.originatingRunId || "" },
  ].filter((patch) => !isBlank(patch.value));
}
