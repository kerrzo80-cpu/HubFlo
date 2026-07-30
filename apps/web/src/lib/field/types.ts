export type FieldJobStatus =
  | "Scheduled"
  | "In progress"
  | "Needs parts"
  | "Ready to complete"
  | "Complete";

export type FieldAttachment = {
  id: string;
  name: string;
  type: "PDF" | "Photo" | "Drawing" | "Note";
  uploadedBy: string;
  uploadedAt: string;
};

export type FieldEvidenceType = "Photo" | "Text" | "Number" | "Signature" | "Checkbox";

export type FieldRequirementValue = {
  text?: string;
  numberValue?: string;
  photoName?: string;
  capturedAt?: string;
};

export type FieldRequirement = {
  id: string;
  label: string;
  status: "done" | "missing" | "optional";
  evidence?: FieldEvidenceType;
  stage?: string;
  required?: boolean;
  stepId?: string;
  costCentreId?: string;
  formField?: string;
  value?: FieldRequirementValue;
};

export type FieldScheduleItem = {
  scheduleId: string;
  jobId: string;
  jobRef: string;
  costCentre: string;
  engineerId: string;
  engineerName: string;
  trade: "Plumber" | "Joiner" | "Heating" | "Multi-trade";
  date: string;
  start: string;
  end: string;
  durationHours: number;
  customer: string;
  contactName: string;
  phone: string;
  address: string;
  description: string;
  accessNotes: string;
  officeNotes: string[];
  status: FieldJobStatus;
  attachments: FieldAttachment[];
  photos: FieldAttachment[];
  requirements: FieldRequirement[];
};

export type TimeCheckLineStatus = "pending" | "confirmed" | "amended";

export type TimeCheckLine = {
  scheduleId: string;
  jobRef: string;
  customer: string;
  costCentre: string;
  scheduledStart: string;
  scheduledEnd: string;
  scheduledHours: number;
  actualStart: string;
  actualEnd: string;
  breakMinutes: number;
  actualHours: number;
  note: string;
  status: TimeCheckLineStatus;
};

export type DailyTimeCheck = {
  id: string;
  date: string;
  engineerId: string;
  engineerName: string;
  status: "not_started" | "in_progress" | "submitted";
  lines: TimeCheckLine[];
  submittedAt?: string;
  updatedAt: string;
};

export type TimeCheckSummary = {
  scheduledHours: number;
  actualHours: number;
  varianceHours: number;
  pendingCount: number;
  amendedCount: number;
  confirmedCount: number;
};

export type FieldEngineerProfile = {
  id: string;
  name: string;
  trade: string;
  phone: string;
};

export type NexaConnectionConfig = {
  mode: "mock" | "nexa";
  baseUrl: string;
  engineerId: string;
  label: string;
};

export type UpdateTimeLineInput = {
  scheduleId: string;
  confirmAsScheduled?: boolean;
  actualStart?: string;
  actualEnd?: string;
  breakMinutes?: number;
  note?: string;
};

export type NexaFieldClient = {
  getConnection(): NexaConnectionConfig;
  getEngineer(): Promise<FieldEngineerProfile>;
  getTodaySchedule(): Promise<FieldScheduleItem[]>;
  getScheduleForDate(date: string): Promise<FieldScheduleItem[]>;
  /** ISO dates (YYYY-MM-DD) that have at least one booked job. */
  getScheduleDates(): Promise<string[]>;
  getJob(scheduleId: string): Promise<FieldScheduleItem | null>;
  getTimeCheck(): Promise<{ check: DailyTimeCheck; summary: TimeCheckSummary }>;
  updateTimeLine(input: UpdateTimeLineInput): Promise<{ check: DailyTimeCheck; summary: TimeCheckSummary }>;
  submitTimeCheck(confirmRemainingAsScheduled?: boolean): Promise<{ check: DailyTimeCheck; summary: TimeCheckSummary }>;
};
