import {
  area,
  atLeastOne,
  blocksWhen,
  choice,
  dateAfter,
  dateField,
  gate,
  labelledOpts,
  launchUnsafeWhen,
  mustEqual,
  num,
  photo,
  requiredIf,
  requiredRule,
  resetPdfOrder,
  text,
  timeField,
  yn3,
  yesNo,
} from "@/lib/domestic-stop-go/fields";
import {
  CONTRACTOR_DISCLAIMER,
  attendanceFields,
  attendanceRules,
  combustionReadingFields,
  evidenceFields,
  reviewFields,
  reviewRules,
  safeStartFields,
  safeStartRules,
} from "@/lib/domestic-stop-go/shared-gates";
import type { WorkflowField, WorkflowRule, WorkflowTemplate } from "@/lib/domestic-stop-go/types";
import { TEMPLATE_VERSION } from "@/lib/domestic-stop-go/types";

const PUBLISHED_AT = "2026-08-17T00:00:00.000Z";

function published(partial: Omit<WorkflowTemplate, "status" | "version" | "tenantId" | "effectiveFrom" | "createdBy" | "publishedAt" | "disclaimer">): WorkflowTemplate {
  resetPdfOrder(0);
  return {
    tenantId: null,
    version: TEMPLATE_VERSION,
    status: "published",
    effectiveFrom: PUBLISHED_AT,
    createdBy: "system",
    publishedAt: PUBLISHED_AT,
    disclaimer: CONTRACTOR_DISCLAIMER,
    ...partial,
  };
}

function keys(fields: WorkflowField[]) {
  return fields.map((item) => item.fieldKey);
}

function gasServiceTemplate(): WorkflowTemplate {
  const attendance = attendanceFields("gas");
  const condition = [
    ...safeStartFields("gas"),
    area("service.customer_faults", "Customer-reported faults", "Existing condition"),
    text("service.history", "Service history / date of last service if known", "Existing condition", { requiredRule: "optional" }),
    text("service.make", "Manufacturer", "Appliance"),
    text("service.model", "Model", "Appliance"),
    text("service.serial", "Serial / GC number", "Appliance"),
    choice(
      "service.boiler_type",
      "Boiler type",
      "Appliance",
      labelledOpts([
        ["combi", "Combi"],
        ["system", "System"],
        ["heat_only", "Heat-only"],
      ]),
    ),
    text("service.location", "Appliance location", "Appliance"),
    text("service.approx_age", "Approximate age", "Appliance", { requiredRule: "optional" }),
  ];
  const preService = [
    yn3("pre.visual_appliance", "Visual appliance condition satisfactory", "Pre-service", { allowNa: true, allowNotTested: true }),
    yn3("pre.visual_flue", "Visual flue / terminal condition satisfactory", "Pre-service", { allowNa: true, allowNotTested: true }),
    yn3("pre.ventilation", "Ventilation satisfactory", "Pre-service", { allowNa: true }),
    yn3("pre.condensate", "Condensate condition satisfactory", "Pre-service", { allowNa: true }),
    yesNo("pre.initial_operating_check", "Initial operating check completed", "Pre-service"),
    ...combustionReadingFields("pre.reading", "Pre-service", { requiredRule: "optional" }),
    num("pre.standing_pressure", "Gas standing pressure", "Pre-service", { unit: "mbar", allowNotTested: true, requiredRule: "optional" }),
    num("pre.working_pressure", "Gas working pressure", "Pre-service", { unit: "mbar", allowNotTested: true, requiredRule: "optional" }),
    num("pre.inlet_pressure", "Appliance inlet pressure", "Pre-service", { unit: "mbar", allowNotTested: true, requiredRule: "optional" }),
    text("pre.gas_rate", "Gas rate, unit and method", "Pre-service", { allowNotTested: true, requiredRule: "optional" }),
  ];
  const strip = [
    yesNo("strip.manufacturer_instructions", "Strip / clean / inspect according to manufacturer instructions", "Service"),
    yn3("strip.burner_hx", "Burner / heat exchanger inspected and cleaned", "Service"),
    yn3("strip.ignition", "Ignition / flame sensing inspected", "Service"),
    yn3("strip.condensate_trap", "Condensate trap and drain inspected", "Service"),
    yn3("strip.seals", "Seals / gaskets inspected", "Service"),
    yn3("strip.fan", "Fan inspected", "Service"),
    yn3("strip.filters", "Filters / strainers inspected", "Service"),
    yn3("strip.expansion", "Expansion vessel / system pressure checked", "Service"),
    yn3("strip.prv", "PRV discharge checked", "Service"),
    yn3("strip.mag_filter", "Magnetic / system filter checked", "Service"),
    area("strip.parts_replaced", "Parts replaced (part number, description, quantity, authorisation)", "Service", { requiredRule: "optional" }),
  ];
  const reassembly = [
    yesNo("reasm.case_seals", "Reassembly and case / combustion seal integrity confirmed", "Reassembly", { safetySeverity: "critical" }),
    ...combustionReadingFields("post.reading", "Post-service combustion"),
    yesNo("post.within_limits", "Readings confirmed within current manufacturer instructions", "Post-service combustion", { safetySeverity: "critical" }),
    yn3("post.leaks", "Leaks checked — none found", "Reassembly"),
    yn3("heating.controls", "Controls tested", "Heating / hot water"),
    yn3("heating.heating", "Heating tested", "Heating / hot water"),
    yn3("heating.hot_water", "Hot water tested", "Heating / hot water"),
  ];
  const findings = [
    choice(
      "findings.final_status",
      "Appliance final status",
      "Findings",
      labelledOpts([
        ["safe_operational", "Safe and operational"],
        ["operational_recommendations", "Operational with recommendations"],
        ["not_operational", "Not operational"],
        ["unsafe", "Unsafe"],
      ]),
      { safetySeverity: "critical", invalidatesDownstream: true },
    ),
    yesNo("findings.manufacturer_complete", "Service completed to manufacturer instructions?", "Findings"),
    area("findings.manufacturer_reason", "If no, reason", "Findings", {
      requiredRule: "required_if",
      requiredIf: { field: "findings.manufacturer_complete", equals: "no" },
      visibleIf: { field: "findings.manufacturer_complete", equals: "no" },
    }),
    ...reviewFields({ nextDue: true }),
  ];
  const evidence = evidenceFields([
    { key: "evidence.data_plate", label: "Appliance identification / data plate" },
    { key: "evidence.appliance", label: "Appliance and surrounding installation" },
    { key: "evidence.flue", label: "Flue terminal / route", required: false },
    { key: "evidence.controls", label: "Controls", required: false },
    { key: "evidence.analyser", label: "Combustion analyser / result", required: false },
  ]);
  const fields = [...attendance, ...condition, ...preService, ...strip, ...reassembly, ...evidence, ...findings];
  const rules: WorkflowRule[] = [
    ...attendanceRules("gas"),
    ...safeStartRules("gas"),
    ...reviewRules(),
    mustEqual("reasm.case_seals", "yes", "Case / combustion seal must be confirmed after reassembly.", { hardStop: true }),
    mustEqual("post.within_limits", "yes", "Combustion results must be confirmed within manufacturer instructions, or take unsafe action.", { hardStop: true }),
    requiredRule("post.reading.co_ppm", "Enter the post-service CO reading."),
    requiredRule("post.reading.co2", "Enter the post-service CO₂ reading."),
    requiredRule("findings.final_status", "Select the appliance final status."),
    blocksWhen("findings.final_status", { field: "findings.final_status", equals: "unsafe" }, "Unsafe final status requires a linked warning record / safety action."),
    launchUnsafeWhen(
      "findings.final_status",
      { field: "findings.final_status", equals: "unsafe" },
      "DOM_GAS_UNSAFE",
      "Unsafe result. Complete the Gas Warning / Unsafe Situation Record.",
    ),
  ];
  return published({
    id: "tmpl-dom-gas-boiler-service-v1",
    costCentreCode: "DOM_GAS_BOILER_SERVICE",
    recordTitle: "Gas Boiler Service Record",
    pdfTemplateKey: "dom-gas-boiler-service",
    fuel: "gas",
    competencyScheme: "Gas Safe",
    linkedUnsafeCode: "DOM_GAS_UNSAFE",
    fields,
    rules,
    gates: [
      gate("attendance", "Attendance and eligibility", keys(attendance), { shared: "A" }),
      gate("condition", "Customer report and existing condition", keys(condition), { shared: "B" }),
      gate("pre_service", "Pre-service operational and safety checks", keys(preService)),
      gate("strip_clean", "Strip / clean / inspect", keys(strip)),
      gate("reassembly", "Reassembly, gas and combustion tests", keys([...reassembly, ...evidence]), { shared: "C" }),
      gate("heating", "Heating / hot-water operation", ["heating.controls", "heating.heating", "heating.hot_water"]),
      gate("signoff", "Findings, recommendations and sign-off", keys(findings), { shared: "D" }),
    ],
  });
}

function gasInstallTemplate(): WorkflowTemplate {
  const attendance = attendanceFields("gas");
  const survey = [
    ...safeStartFields("gas"),
    choice("install.new_or_replacement", "New installation or replacement", "Existing installation", labelledOpts([["new", "New installation"], ["replacement", "Replacement"]])),
    text("install.previous_appliance", "Previous appliance make / model / type / fuel", "Existing installation", {
      requiredRule: "required_if",
      requiredIf: { field: "install.new_or_replacement", equals: "replacement" },
    }),
    yn3("install.removed", "Existing appliance removed / disposed of", "Existing installation"),
    yesNo("install.asbestos", "Asbestos or other installation constraint identified", "Existing installation"),
    area("install.pre_condition", "Pre-install water / system condition and defects", "Existing installation"),
  ];
  const appliance = [
    text("new.manufacturer", "Manufacturer", "New appliance"),
    text("new.model", "Model", "New appliance"),
    text("new.serial", "Serial number", "New appliance"),
    text("new.gc_number", "GC number", "New appliance", { requiredRule: "optional" }),
    choice("new.boiler_type", "Boiler type", "New appliance", labelledOpts([["combi", "Combi"], ["system", "System"], ["heat_only", "Heat-only"]])),
    choice("new.appliance_type", "Appliance type", "New appliance", labelledOpts([["room_sealed", "Room-sealed"], ["open_flued", "Open-flued"]])),
    num("new.output_kw", "Output", "New appliance", { unit: "kW" }),
    choice("new.fuel", "Fuel", "New appliance", labelledOpts([["natural_gas", "Natural gas"], ["lpg", "LPG"]])),
    text("new.location", "Installation location", "New appliance"),
    text("new.warranty_length", "Warranty length", "New appliance", { requiredRule: "optional" }),
    text("new.warranty_ref", "Warranty registration status / reference", "New appliance", { requiredRule: "optional" }),
    yesNo("new.instructions_followed", "Manufacturer instructions available and followed", "New appliance"),
  ];
  const gas = [
    text("gas.meter_type", "Meter type / location; emergency control accessible", "Gas installation"),
    choice("gas.tightness", "Tightness test result", "Gas installation", labelledOpts([["pass", "Pass"], ["fail", "Fail"], ["na", "N/A"]]), { safetySeverity: "critical" }),
    text("gas.tightness_ref", "Tightness test record reference", "Gas installation", { requiredRule: "optional" }),
    text("gas.pipe_size", "Installation pipe size / material", "Gas installation"),
    num("gas.standing", "Standing pressure", "Gas installation", { unit: "mbar" }),
    num("gas.working", "Working pressure", "Gas installation", { unit: "mbar" }),
    num("gas.inlet", "Appliance inlet pressure", "Gas installation", { unit: "mbar" }),
    text("gas.rate", "Gas rate with unit and method", "Gas installation"),
    yn3("gas.other_appliances", "Other appliances operating during working-pressure test?", "Gas installation"),
    yn3("gas.pipework_visual", "Pipework / support / sleeves / bonding visual checks satisfactory", "Gas installation"),
  ];
  const flue = [
    text("flue.type_route", "Flue type, route and terminal location", "Flue / condensate"),
    yesNo("flue.assembled", "Flue assembled / supported / sealed to manufacturer instructions", "Flue / condensate"),
    yn3("flue.joints", "Flue joints inspected; concealed-flue inspection provision if applicable", "Flue / condensate"),
    yesNo("flue.terminal_clearances", "Terminal clearances satisfactory", "Flue / condensate", { safetySeverity: "critical" }),
    yn3("flue.ventilation", "Combustion air / ventilation satisfactory", "Flue / condensate", { allowNa: true }),
    area("flue.ventilation_na_reason", "Ventilation N/A reason", "Flue / condensate", { requiredRule: "required_if", requiredIf: { field: "flue.ventilation", equals: "na" } }),
    text("flue.condensate", "Condensate route / material / termination", "Flue / condensate"),
    yesNo("flue.condensate_confirmed", "Condensate fall, trap and freeze protection confirmed", "Flue / condensate"),
    yesNo("flue.plume", "Plume management fitted?", "Flue / condensate"),
    text("flue.plume_details", "Plume management details", "Flue / condensate", { requiredRule: "optional" }),
  ];
  const system = [
    text("sys.flush", "System flushed / cleaned; method and product", "System"),
    text("sys.inhibitor", "Inhibitor added; product and concentration / quantity", "System"),
    text("sys.filter", "System filter fitted / cleaned; make / model", "System", { requiredRule: "optional" }),
    num("sys.cold_fill", "Cold fill pressure", "System", { unit: "bar" }),
    num("sys.hot_op", "Hot operating pressure", "System", { unit: "bar" }),
    yn3("sys.expansion", "Expansion vessel checked", "System"),
    yesNo("sys.prv_route", "Pressure relief discharge route satisfactory", "System"),
    text("sys.temps", "Heating flow / return temperatures", "System"),
    yn3("sys.controls", "Heating zones, thermostats, programmer and TRVs tested", "System"),
    yn3("sys.bypass", "Bypass arrangement confirmed", "System"),
    text("sys.combi_hw", "Hot-water temperature and flow rate (combi)", "System", { requiredRule: "optional" }),
    yesNo("sys.balanced", "System balanced", "System"),
  ];
  const commissioning = [
    ...combustionReadingFields("comm.high", "Commissioning high-fire"),
    ...combustionReadingFields("comm.low", "Commissioning low-fire", { requiredRule: "optional" }),
    yesNo("comm.within_limits", "Readings within manufacturer limits", "Commissioning", { safetySeverity: "critical" }),
    yesNo("comm.flame_picture", "Flame picture / safety shutdown / FFD confirmed", "Commissioning", { safetySeverity: "critical" }),
    yesNo("comm.case_seals", "Case seals and combustion circuit checked after reassembly", "Commissioning", { safetySeverity: "critical" }),
    yn3("comm.spillage", "Final spillage / flue integrity checks", "Commissioning"),
    yesNo("comm.safe_to_use", "Appliance safe to use", "Commissioning", { safetySeverity: "critical" }),
  ];
  const handover = [
    yesNo("hand.demonstrated", "Heating / hot water demonstrated to customer", "Handover"),
    yesNo("hand.controls_explained", "Controls explained", "Handover"),
    yesNo("hand.instructions_left", "User instructions left", "Handover"),
    yn3("hand.benchmark", "Manufacturer / Benchmark commissioning record completed", "Handover"),
    text("hand.benchmark_ref", "Benchmark reference / photo note", "Handover", { requiredRule: "optional" }),
    text("hand.warranty", "Warranty registered / pending / reference", "Handover", { requiredRule: "optional" }),
    yn3("hand.notification_required", "External compliance notification required?", "Handover"),
    choice("hand.notification_status", "Notification status", "Handover", labelledOpts([["not_required", "Not required"], ["pending", "Pending"], ["submitted", "Submitted"], ["accepted", "Accepted"], ["failed", "Failed"]])),
    text("hand.notification_ref", "Notification reference and date", "Handover", { requiredRule: "optional" }),
    yesNo("hand.co_alarm", "CO alarm installed / tested", "Handover"),
    text("hand.co_details", "CO alarm standard / location / expiry", "Handover", { requiredRule: "optional" }),
    ...reviewFields({ handover: true, nextDue: true }),
  ];
  const evidence = evidenceFields([
    { key: "evidence.data_plate", label: "New appliance data plate" },
    { key: "evidence.appliance", label: "Installed appliance" },
    { key: "evidence.flue", label: "Flue terminal" },
    { key: "evidence.controls", label: "Controls" },
  ]);
  const fields = [...attendance, ...survey, ...appliance, ...gas, ...flue, ...system, ...commissioning, ...evidence, ...handover];
  return published({
    id: "tmpl-dom-gas-boiler-install-v1",
    costCentreCode: "DOM_GAS_BOILER_INSTALL",
    recordTitle: "Gas Boiler Installation & Commissioning Record",
    pdfTemplateKey: "dom-gas-boiler-install",
    fuel: "gas",
    competencyScheme: "Gas Safe",
    linkedUnsafeCode: "DOM_GAS_UNSAFE",
    fields,
    rules: [
      ...attendanceRules("gas"),
      ...safeStartRules("gas"),
      ...reviewRules(),
      blocksWhen("gas.tightness", { field: "gas.tightness", equals: "fail" }, "Tightness test failed. Resolve before continuing."),
      mustEqual("comm.within_limits", "yes", "Commissioning readings must be confirmed within manufacturer limits."),
      mustEqual("comm.flame_picture", "yes", "Safety device / flame-failure checks must pass."),
      mustEqual("comm.safe_to_use", "yes", "Appliance is not safe to use."),
      requiredRule("comm.high.co_ppm", "High-fire commissioning reading is required."),
    ],
    gates: [
      gate("attendance", "Attendance and engineer eligibility", keys(attendance), { shared: "A" }),
      gate("survey", "Pre-installation survey and existing condition", keys(survey), { shared: "B" }),
      gate("appliance", "New boiler and installation details", keys(appliance)),
      gate("gas", "Gas supply, tightness and gas-rate checks", keys(gas)),
      gate("flue", "Flue, condensate and ventilation", keys(flue)),
      gate("system", "Heating / hot-water system preparation and controls", keys(system)),
      gate("commissioning", "Commissioning and combustion readings", keys([...commissioning, ...evidence]), { shared: "C" }),
      gate("handover", "Safety devices, operation, notification and sign-off", keys(handover), { shared: "D" }),
    ],
  });
}

function landlordTemplate(): WorkflowTemplate {
  const parties = [
    ...attendanceFields("gas"),
    text("lgsr.landlord_name", "Landlord / agent name", "Parties"),
    area("lgsr.landlord_address", "Landlord / agent address", "Parties"),
    text("lgsr.landlord_email", "Landlord / agent email", "Parties", { requiredRule: "optional" }),
    text("lgsr.landlord_phone", "Landlord / agent telephone", "Parties"),
    text("lgsr.tenant_name", "Tenant / occupier name", "Parties", { requiredRule: "optional" }),
    text("lgsr.property_address", "Inspection property address", "Parties", { systemPopulated: true }),
    dateField("lgsr.inspection_date", "Inspection date", "Parties"),
    dateField("lgsr.next_due", "Next due date", "Parties"),
    text("lgsr.record_number", "Record number", "Parties", { systemPopulated: true, requiredRule: "optional" }),
    yesNo("lgsr.previous_available", "Previous record available?", "Parties"),
    text("lgsr.previous_ref", "Previous record reference", "Parties", { requiredRule: "optional" }),
    choice("lgsr.delivery_method", "Record delivery method", "Parties", labelledOpts([["handed_to_tenant", "Handed to tenant"], ["email", "Email"], ["post", "Post"], ["agent", "Agent"], ["other", "Other"]])),
    dateField("lgsr.delivery_date", "Record delivery date", "Parties", { requiredRule: "optional" }),
  ];
  const installation = [
    yn3("lgsr.pipework", "Gas installation pipework visual condition satisfactory", "Installation"),
    yn3("lgsr.tightness", "Tightness test performed / satisfactory", "Installation", { allowNa: true, allowNotTested: true }),
    area("lgsr.tightness_reason", "If tightness test not performed, reason", "Installation", { requiredRule: "required_if", requiredIf: { field: "lgsr.tightness", in: ["na", "no"] } }),
    yesNo("lgsr.emergency_control", "Emergency control accessible and labelled", "Installation", { safetySeverity: "critical" }),
    area("lgsr.meter_notes", "Meter installation observations", "Installation", { requiredRule: "optional" }),
    yesNo("lgsr.appliances_present", "Landlord-owned gas appliances are present at this property", "Installation", { safetySeverity: "critical" }),
  ];
  const appliance = [
    choice("appliance.category", "Appliance category", "Appliances", labelledOpts([["boiler", "Boiler"], ["fire", "Fire"], ["cooker", "Cooker"], ["hob", "Hob"], ["water_heater", "Water heater"], ["other", "Other"]]), { groupKey: "appliances" }),
    text("appliance.make", "Make", "Appliances", { groupKey: "appliances" }),
    text("appliance.model", "Model", "Appliances", { groupKey: "appliances" }),
    text("appliance.location", "Location", "Appliances", { groupKey: "appliances" }),
    choice("appliance.ownership", "Ownership", "Appliances", labelledOpts([["landlord", "Landlord"], ["tenant", "Tenant"]]), { groupKey: "appliances" }),
    text("appliance.flue_type", "Flue type", "Appliances", { groupKey: "appliances" }),
    yesNo("appliance.inspected", "Appliance inspected?", "Appliances", { groupKey: "appliances" }),
    area("appliance.unable_reason", "Unable to access / not inspected reason", "Appliances", { groupKey: "appliances", requiredRule: "required_if", requiredIf: { field: "appliance.inspected", equals: "no" }, allowUnable: true }),
    text("appliance.pressure_or_rate", "Operating pressure or heat input / gas rate", "Appliances", { groupKey: "appliances", requiredRule: "required_if", requiredIf: { field: "appliance.inspected", equals: "yes" }, allowNotTested: true }),
    yn3("appliance.safety_device", "Safety device operation satisfactory", "Appliances", { groupKey: "appliances" }),
    yn3("appliance.ventilation", "Ventilation satisfactory", "Appliances", { groupKey: "appliances" }),
    yn3("appliance.flue_flow", "Flue flow satisfactory", "Appliances", { groupKey: "appliances", allowNa: true }),
    yn3("appliance.spillage", "Spillage test satisfactory", "Appliances", { groupKey: "appliances", allowNa: true }),
    yn3("appliance.flue_visual", "Flue / terminal visual condition satisfactory", "Appliances", { groupKey: "appliances" }),
    yn3("appliance.serviced", "Appliance serviced?", "Appliances", { groupKey: "appliances" }),
    yn3("appliance.co_alarm", "CO alarm present / tested", "Appliances", { groupKey: "appliances", requiredRule: "optional" }),
    area("appliance.defect", "Defect code / description and remedial action", "Appliances", { groupKey: "appliances", requiredRule: "optional" }),
    choice("appliance.final_status", "Final status", "Appliances", labelledOpts([["pass", "Pass"], ["fail", "Fail"], ["not_inspected", "Not inspected"], ["tenant_owned_observation", "Tenant-owned observation only"]]), { groupKey: "appliances", safetySeverity: "critical" }),
  ];
  const declaration = [
    yesNo("lgsr.checks_recorded", "Confirmation that checks required by the landlord gas-safety visit have been recorded", "Declaration", { safetySeverity: "critical" }),
    area("lgsr.defects_action", "Defects and action taken", "Declaration"),
    ...reviewFields({ nextDue: true }),
  ];
  return published({
    id: "tmpl-dom-gas-landlord-safety-v1",
    costCentreCode: "DOM_GAS_LANDLORD_SAFETY",
    recordTitle: "Landlord Gas Safety Record",
    pdfTemplateKey: "dom-gas-landlord-safety",
    fuel: "gas",
    competencyScheme: "Gas Safe",
    linkedUnsafeCode: "DOM_GAS_UNSAFE",
    fields: [...parties, ...installation, ...appliance, ...declaration],
    rules: [
      ...attendanceRules("gas"),
      ...reviewRules(),
      atLeastOne("appliances", "Add every landlord-owned gas appliance / flue at the property."),
      requiredRule("lgsr.inspection_date", "Inspection date is required."),
      requiredRule("lgsr.next_due", "Next due date is required."),
      dateAfter("lgsr.next_due", "lgsr.inspection_date", "Next due date must be after the inspection date."),
      blocksWhen("appliance.final_status", { field: "appliance.final_status", equals: "fail" }, "Failed / unsafe appliance requires recorded safety action."),
    ],
    gates: [
      gate("parties", "Landlord / agent, tenancy and engineer details", keys(parties), { shared: "A" }),
      gate("installation", "Gas installation and meter / pipework checks", keys(installation)),
      gate("appliances", "Repeatable appliance safety check", keys(appliance)),
      gate("declaration", "Defects, record delivery and signatures", keys(declaration), { shared: "D" }),
    ],
  });
}

function unsafeTemplate(): WorkflowTemplate {
  const hazard = [
    ...attendanceFields("gas"),
    dateField("unsafe.identified_date", "Date hazard identified", "Hazard"),
    timeField("unsafe.identified_time", "Time hazard identified", "Hazard"),
    text("unsafe.affected", "Appliance / installation / pipework affected", "Hazard"),
    text("unsafe.location", "Location", "Hazard"),
    area("unsafe.defects", "Exact defect(s) and test evidence", "Hazard", { safetySeverity: "critical" }),
  ];
  const classification = [
    choice("unsafe.classification", "Current recognised unsafe classification", "Classification", labelledOpts([["id", "Immediately Dangerous"], ["ar", "At Risk"], ["ncs", "Not to Current Standards"]]), { helpText: "Admin can update labels; IDs stay stable.", safetySeverity: "critical" }),
    area("unsafe.classification_reason", "Reason for classification", "Classification", { safetySeverity: "critical" }),
    yesNo("unsafe.immediate_risk", "Immediate risk present?", "Classification", { safetySeverity: "critical" }),
    yesNo("unsafe.gas_escape", "Gas escape suspected / confirmed?", "Classification", { safetySeverity: "critical" }),
    area("unsafe.gas_escape_detail", "Gas escape details", "Classification", { requiredRule: "required_if", requiredIf: { field: "unsafe.gas_escape", equals: "yes" } }),
  ];
  const action = [
    yesNo("unsafe.eco_off", "Emergency control turned off?", "Action"),
    dateField("unsafe.eco_off_date", "ECO off date", "Action", { requiredRule: "optional" }),
    timeField("unsafe.eco_off_time", "ECO off time", "Action", { requiredRule: "optional" }),
    text("unsafe.eco_off_by", "ECO turned off by", "Action", { requiredRule: "optional" }),
    yesNo("unsafe.isolated", "Appliance isolated / disconnected?", "Action"),
    text("unsafe.isolation_method", "Isolation method and time", "Action", { requiredRule: "required_if", requiredIf: { field: "unsafe.isolated", equals: "yes" } }),
    yn3("unsafe.permission", "Permission to disconnect requested and result", "Action"),
    area("unsafe.permission_refused", "If permission refused: action taken, advice given and escalation", "Action", { requiredRule: "required_if", requiredIf: { field: "unsafe.permission", equals: "no" } }),
    yesNo("unsafe.warning_label", "Warning label / reference fitted", "Action"),
    text("unsafe.warning_location", "Warning label location", "Action", { requiredRule: "required_if", requiredIf: { field: "unsafe.warning_label", equals: "yes" } }),
    photo("unsafe.warning_photo", "Warning label photo", "Action", { requiredRule: "optional" }),
    yesNo("unsafe.left_safe", "Installation left safe?", "Action", { safetySeverity: "critical" }),
    area("unsafe.escalation", "Escalation instructions", "Action", { requiredRule: "required_if", requiredIf: { field: "unsafe.left_safe", equals: "no" }, safetySeverity: "critical" }),
  ];
  const warning = [
    yesNo("unsafe.warned_verbal", "Customer / responsible person warned verbally", "Warning"),
    yesNo("unsafe.warned_written", "Customer / responsible person warned in writing", "Warning"),
    yesNo("unsafe.emergency_advice", "Emergency advice given", "Warning"),
    area("unsafe.remedial", "Remedial action required", "Warning"),
    choice("unsafe.notification", "Notification considered", "Warning", labelledOpts([["not_required", "Not required"], ["gas_transporter", "Gas transporter"], ["emergency_service", "Emergency service"], ["gas_safe", "Gas Safe"], ["riddor", "RIDDOR"], ["other", "Other"]])),
    text("unsafe.notification_org", "Organisation / reference / date / outcome", "Warning", { requiredRule: "optional" }),
    text("unsafe.linked_origin", "Linked originating workflow / job / cost centre", "Warning", { systemPopulated: true, requiredRule: "optional" }),
    ...reviewFields({ handover: false, nextDue: false }),
  ];
  return published({
    id: "tmpl-dom-gas-unsafe-v1",
    costCentreCode: "DOM_GAS_UNSAFE",
    recordTitle: "Gas Warning / Unsafe Situation Record",
    pdfTemplateKey: "dom-gas-unsafe",
    fuel: "gas",
    competencyScheme: "Gas Safe",
    fields: [...hazard, ...classification, ...action, ...warning],
    rules: [
      ...attendanceRules("gas"),
      ...reviewRules(),
      requiredRule("unsafe.classification", "Select the unsafe classification."),
      requiredRule("unsafe.classification_reason", "Give the reason for classification."),
      requiredRule("unsafe.left_safe", "Record whether the installation was left safe."),
      blocksWhen("unsafe.left_safe", { field: "unsafe.left_safe", equals: "no" }, "Installation not left safe requires recorded escalation instructions."),
      requiredIf("unsafe.escalation", { field: "unsafe.left_safe", equals: "no" }, "Record escalation instructions when the installation is not left safe."),
    ],
    gates: [
      gate("hazard", "Hazard identification", keys(hazard), { shared: "B" }),
      gate("classification", "Classification and immediate action", keys(classification)),
      gate("isolation", "Isolation / disconnection / label details", keys(action)),
      gate("warning", "Responsible-person warning, notifications and acknowledgement", keys(warning), { shared: "D" }),
    ],
  });
}

function repairTemplate(): WorkflowTemplate {
  const attendance = attendanceFields("gas");
  const fault = [
    ...safeStartFields("gas"),
    text("repair.appliance", "Appliance details and location", "Fault"),
    area("repair.customer_description", "Customer description of fault and when it started", "Fault"),
    text("repair.error_codes", "Error / fault codes", "Fault", { requiredRule: "optional" }),
    choice("repair.arrival_condition", "Appliance condition on arrival", "Fault", labelledOpts([["working", "Working"], ["intermittent", "Intermittent"], ["not_working", "Not working"], ["unsafe", "Unsafe"]])),
  ];
  const diagnostics = [
    area("repair.diagnostic_steps", "Diagnostic steps (test, expected, actual, result, notes)", "Diagnostics"),
    area("repair.initial_readings", "Initial gas / combustion / safety readings", "Diagnostics", { requiredRule: "optional" }),
    area("repair.diagnosis", "Diagnosis and root cause", "Diagnostics"),
    area("repair.recommendation", "Repair recommendation", "Diagnostics"),
  ];
  const auth = [
    text("repair.quote_ref", "Quotation / price / variation reference", "Authorisation", { requiredRule: "optional" }),
    choice("repair.authorisation", "Customer authorisation", "Authorisation", labelledOpts([["authorised", "Authorised"], ["declined", "Declined"], ["not_contactable", "Not contactable"], ["emergency_make_safe", "Emergency make-safe (no prior authorisation)"]])),
    text("repair.auth_name", "Authorised by (name)", "Authorisation", { requiredRule: "required_if", requiredIf: { field: "repair.authorisation", equals: "authorised" } }),
    text("repair.auth_method", "Authorisation method", "Authorisation", { requiredRule: "optional" }),
    text("repair.auth_timestamp", "Authorisation timestamp", "Authorisation", { requiredRule: "optional" }),
  ];
  const parts = [
    area("repair.parts", "Parts used (stock ID or free-text, manufacturer PN, qty, serial/batch)", "Repair"),
    area("repair.work_completed", "Work completed", "Repair"),
    choice("repair.failed_parts", "Failed parts retained / disposed / left with customer", "Repair", labelledOpts([["retained", "Retained"], ["disposed", "Disposed"], ["left_with_customer", "Left with customer"], ["na", "N/A"]])),
  ];
  const recommission = [
    yn3("repair.tightness", "Gas-tightness test (where gas-carrying parts disturbed)", "Recommissioning", { allowNa: true }),
    ...combustionReadingFields("repair.post", "Post-repair combustion", { requiredRule: "optional" }),
    yn3("repair.case_seals", "Case seals checked", "Recommissioning"),
    yn3("repair.leaks", "Leaks checked", "Recommissioning"),
    yn3("repair.flue", "Flue / ventilation checked", "Recommissioning"),
    yn3("repair.condensate", "Condensate checked", "Recommissioning"),
    yn3("repair.safety_devices", "Safety devices checked", "Recommissioning"),
    yn3("repair.operational", "Heating / hot water / controls operational test", "Recommissioning"),
  ];
  const outcome = [
    choice("repair.final_outcome", "Final outcome", "Outcome", labelledOpts([["repaired", "Repaired"], ["temporary_repair", "Temporary repair"], ["parts_required", "Parts required"], ["quote_required", "Quote required"], ["ber", "Beyond economical repair"], ["declined", "Customer declined"], ["unsafe", "Unsafe"]]), { safetySeverity: "critical" }),
    yesNo("repair.return_visit", "Return visit required", "Outcome"),
    area("repair.return_actions", "Parts / actions needed", "Outcome", { requiredRule: "optional" }),
    text("repair.warranty", "Warranty status", "Outcome", { requiredRule: "optional" }),
    ...reviewFields({ nextDue: false }),
  ];
  return published({
    id: "tmpl-dom-gas-repair-v1",
    costCentreCode: "DOM_GAS_REPAIR",
    recordTitle: "Gas Repair and Breakdown Record",
    pdfTemplateKey: "dom-gas-repair",
    fuel: "gas",
    competencyScheme: "Gas Safe",
    linkedUnsafeCode: "DOM_GAS_UNSAFE",
    fields: [...attendance, ...fault, ...diagnostics, ...auth, ...parts, ...recommission, ...outcome],
    rules: [
      ...attendanceRules("gas"),
      ...safeStartRules("gas"),
      ...reviewRules(),
      blocksWhen("repair.authorisation", { field: "repair.authorisation", equals: "" }, "Repair performed needs an authorisation record, except emergency make-safe."),
      launchUnsafeWhen("repair.final_outcome", { field: "repair.final_outcome", equals: "unsafe" }, "DOM_GAS_UNSAFE", "Unsafe final outcome requires a linked warning record."),
      requiredRule("repair.final_outcome", "Select the final operating / safety status."),
    ],
    gates: [
      gate("attendance", "Attendance and eligibility", keys(attendance), { shared: "A" }),
      gate("fault", "Reported fault and existing condition", keys(fault), { shared: "B" }),
      gate("diagnostics", "Diagnostics and test results", keys(diagnostics)),
      gate("authorisation", "Customer authorisation", keys(auth)),
      gate("repair", "Repair and parts", keys(parts)),
      gate("recommission", "Recommissioning and safety checks", keys(recommission)),
      gate("outcome", "Outcome and sign-off", keys(outcome), { shared: "D" }),
    ],
  });
}

function oilInstallTemplate(): WorkflowTemplate {
  const attendance = attendanceFields("oil");
  const survey = safeStartFields("oil");
  const appliance = [
    text("oil.manufacturer", "Boiler manufacturer", "Appliance"),
    text("oil.model", "Model", "Appliance"),
    text("oil.serial", "Serial", "Appliance"),
    num("oil.output", "Output", "Appliance", { unit: "kW" }),
    text("oil.location", "Location", "Appliance"),
    text("oil.appliance_type", "Appliance type and flue type", "Appliance"),
    text("oil.burner", "Burner make / model / serial", "Appliance"),
    choice("oil.fuel", "Fuel", "Appliance", labelledOpts([["kerosene", "Kerosene"], ["hvo", "HVO"], ["other", "Other permitted"]])),
    text("oil.nozzle", "Nozzle make / type / size / angle / pattern", "Appliance"),
    num("oil.pump_pressure", "Pump pressure", "Appliance", { unit: "bar" }),
    text("oil.air_head", "Burner air setting and head setting", "Appliance", { requiredRule: "optional" }),
    yesNo("oil.instructions", "Manufacturer instructions followed", "Appliance"),
  ];
  const tank = [
    text("tank.identity", "Tank manufacturer / material / type / capacity / age / location", "Tank"),
    yn3("tank.bunded", "Integrally bunded? bund capacity / condition", "Tank"),
    yesNo("tank.base", "Tank base / support satisfactory", "Tank"),
    area("tank.condition", "Tank condition: corrosion / cracking / bulging / leak / damage", "Tank"),
    yn3("tank.fill_vent", "Fill point, vent, gauge and overfill protection satisfactory", "Tank"),
    yn3("tank.separation", "Separation from buildings, openings, boundaries, ignition and combustibles satisfactory", "Tank"),
    yn3("tank.fire_protection", "Fire protection required / provided", "Tank"),
    text("tank.oil_line", "Oil line material / size / route / joints / support / protection", "Tank"),
    choice("tank.supply", "Supply", "Tank", labelledOpts([["gravity", "Gravity"], ["suction", "Suction"]])),
    choice("tank.pipe", "Pipe arrangement", "Tank", labelledOpts([["single", "Single pipe"], ["two_pipe", "Two-pipe"], ["deaerator", "De-aerator"]])),
    yn3("tank.isolation_filter", "Isolation valve, filter and water contamination check", "Tank"),
    text("tank.fire_valve", "Remote fire valve make / model / rating and sensor location", "Tank"),
    choice("tank.fire_valve_test", "Fire valve operation test", "Tank", labelledOpts([["pass", "Pass"], ["fail", "Fail"], ["absent", "Absent"]]), { safetySeverity: "critical" }),
    choice("tank.oil_leak_test", "Oil leak test result", "Tank", labelledOpts([["pass", "Pass"], ["fail", "Fail"]]), { safetySeverity: "critical" }),
    area("tank.env_risk", "Environmental / pollution risk and action", "Tank"),
  ];
  const flue = [
    text("oilflue.details", "Flue type, route, terminal, support, seals, access and clearances", "Flue"),
    num("oilflue.draught", "Draught reading", "Flue", { unit: "mbar", requiredRule: "optional", allowNa: true }),
    text("oilflue.ventilation", "Ventilation provision and calculation / result", "Flue"),
    yn3("oilflue.condensate", "Condensate arrangement (condensing appliance)", "Flue"),
  ];
  const commissioning = [
    text("oilsys.flush", "System flush / cleaner / inhibitor / filter", "Commissioning"),
    text("oilsys.pressure", "Fill / operating pressure and expansion provision", "Commissioning"),
    yn3("oilsys.controls", "Controls / zones / hot water tested", "Commissioning"),
    num("oilcomm.smoke", "Smoke number", "Commissioning"),
    ...combustionReadingFields("oilcomm", "Commissioning"),
    yesNo("oilcomm.before_after", "Commissioning reading captured before and after adjustment", "Commissioning"),
    yesNo("oilcomm.within_limits", "Results within manufacturer limits", "Commissioning", { safetySeverity: "critical" }),
    yesNo("oilcomm.safety", "Flame failure, limit thermostat and safety controls tested", "Commissioning", { safetySeverity: "critical" }),
    yesNo("oilcomm.inspection", "Boiler / casing / flue inspected after commissioning", "Commissioning"),
    yesNo("oilcomm.balanced", "System balanced and operation demonstrated", "Commissioning"),
  ];
  const handover = [
    yesNo("oilhand.explained", "User instructions, oil shut-off and emergency action explained", "Handover"),
    yesNo("oilhand.tank_guidance", "Tank / fuel guidance provided", "Handover"),
    choice("oilhand.notification_status", "External compliance notification", "Handover", labelledOpts([["not_required", "Not required"], ["pending", "Pending"], ["submitted", "Submitted"], ["accepted", "Accepted"], ["failed", "Failed"]])),
    text("oilhand.warranty", "Manufacturer warranty status / reference", "Handover", { requiredRule: "optional" }),
    ...reviewFields({ handover: true, nextDue: true }),
  ];
  return published({
    id: "tmpl-dom-oil-boiler-install-v1",
    costCentreCode: "DOM_OIL_BOILER_INSTALL",
    recordTitle: "Oil Boiler Installation & Commissioning Record",
    pdfTemplateKey: "dom-oil-boiler-install",
    fuel: "oil",
    competencyScheme: "OFTEC",
    fields: [...attendance, ...survey, ...appliance, ...tank, ...flue, ...commissioning, ...handover],
    rules: [
      ...attendanceRules("oil"),
      ...safeStartRules("oil"),
      ...reviewRules(),
      blocksWhen("tank.oil_leak_test", { field: "tank.oil_leak_test", equals: "fail" }, "Unresolved oil leak, fire or pollution risk."),
      blocksWhen("tank.fire_valve_test", { field: "tank.fire_valve_test", in: ["fail", "absent"] }, "Fire valve absent or failed where required."),
      mustEqual("oilcomm.within_limits", "yes", "Smoke / combustion results must be within manufacturer limits."),
      mustEqual("oilcomm.safety", "yes", "Safety control test failed."),
    ],
    gates: [
      gate("attendance", "Attendance and oil competency", keys(attendance), { shared: "A" }),
      gate("survey", "Pre-installation and environmental / fire-risk survey", keys(survey), { shared: "B" }),
      gate("appliance", "Appliance and burner details", keys(appliance)),
      gate("tank", "Oil tank, supply and fire valve", keys(tank)),
      gate("flue", "Flue, ventilation and condensate", keys(flue)),
      gate("commissioning", "Heating system, burner setup and commissioning", keys(commissioning), { shared: "C" }),
      gate("handover", "Safety operation, notification tracking and sign-off", keys(handover), { shared: "D" }),
    ],
  });
}

function oilServiceTemplate(): WorkflowTemplate {
  const attendance = attendanceFields("oil");
  const pre = [
    ...safeStartFields("oil"),
    text("oilsvc.last_service", "Last service date", "Pre-service", { requiredRule: "optional" }),
    area("oilsvc.customer_report", "Customer-reported problems", "Pre-service"),
    area("oilsvc.initial_condition", "Initial operational condition", "Pre-service"),
    num("oilsvc.pre_smoke", "Pre-service smoke number", "Pre-service", { requiredRule: "optional" }),
  ];
  const boiler = [
    text("oilsvc.identity", "Boiler / burner / tank identification", "Service"),
    yn3("oilsvc.hx", "Heat exchanger / baffles cleaned", "Service"),
    text("oilsvc.nozzle_existing", "Existing nozzle details", "Service", { requiredRule: "optional" }),
    text("oilsvc.nozzle_replacement", "Replacement nozzle details", "Service", { requiredRule: "optional" }),
    yn3("oilsvc.filter", "Oil filter cleaned / replaced; contamination / water / sludge findings", "Service"),
    num("oilsvc.pump_pressure", "Pump pressure", "Service", { unit: "bar" }),
    text("oilsvc.air_head", "Air / head settings", "Service", { requiredRule: "optional" }),
    yn3("oilsvc.ignition", "Ignition / electrodes / photocell / fan / motor / flexible hose condition", "Service"),
    dateField("oilsvc.hose_expiry", "Flexible hose replacement / expiry", "Service", { requiredRule: "optional" }),
    yn3("oilsvc.seals", "Seals and combustion chamber condition", "Service"),
    yn3("oilsvc.condensate", "Condensate trap / drain condition", "Service"),
  ];
  const tank = [
    text("tank.identity", "Type / material / capacity / approximate age", "Tank inspection"),
    yn3("tank.base", "Base / support", "Tank inspection"),
    yn3("tank.bund", "Bund", "Tank inspection"),
    area("tank.defects", "Corrosion / cracks / bulging / damage / leak", "Tank inspection"),
    yn3("tank.fill_vent", "Fill / vent / gauge / overfill protection", "Tank inspection"),
    yn3("tank.separation", "Separation / fire protection", "Tank inspection"),
    yn3("tank.vegetation", "Vegetation / combustible storage", "Tank inspection"),
    area("tank.pollution", "Pollution / environmental risk", "Tank inspection"),
    yn3("tank.supply", "Supply line, isolation, filter, de-aerator condition", "Tank inspection"),
    choice("tank.fire_valve_test", "Fire valve test result", "Tank inspection", labelledOpts([["pass", "Pass"], ["fail", "Fail"], ["not_required", "Not required"]]), { safetySeverity: "critical" }),
    photo("tank.overview_photo", "Tank overview photo", "Tank inspection"),
    photo("tank.defect_photo", "Defect photo", "Tank inspection", { requiredRule: "optional" }),
  ];
  const post = [
    num("oilsvc.post_smoke", "Post-service smoke number", "Post-service"),
    ...combustionReadingFields("oilsvc.post", "Post-service"),
    yn3("oilsvc.flue", "Flue / draught / ventilation checks", "Post-service"),
    yesNo("oilsvc.safety", "Safety controls tested and passed", "Post-service", { safetySeverity: "critical" }),
    yn3("oilsvc.leaks", "Oil leaks checked", "Post-service"),
    yn3("oilsvc.heating", "Heating / hot water / controls tested", "Post-service"),
    choice("oilsvc.final_status", "Final status", "Findings", labelledOpts([["safe_operational", "Safe and operational"], ["operational_recommendations", "Operational with recommendations"], ["not_operational", "Not operational"], ["unsafe_fire_pollution", "Unsafe / fire risk / pollution risk"]]), { safetySeverity: "critical" }),
    dateField("oilsvc.next_due", "Next service due", "Findings"),
    area("oilsvc.tank_reinspect", "Tank reinspection recommendation", "Findings", { requiredRule: "optional" }),
    area("oilsvc.oil_warning", "Oil warning / defect section (oil classifications only)", "Findings", { requiredRule: "optional" }),
    ...reviewFields({ nextDue: true }),
  ];
  return published({
    id: "tmpl-dom-oil-service-tank-v1",
    costCentreCode: "DOM_OIL_SERVICE_TANK",
    recordTitle: "Oil Boiler Service and Tank Inspection Record",
    pdfTemplateKey: "dom-oil-service-tank",
    fuel: "oil",
    competencyScheme: "OFTEC",
    fields: [...attendance, ...pre, ...boiler, ...tank, ...post],
    rules: [
      ...attendanceRules("oil"),
      ...safeStartRules("oil"),
      ...reviewRules(),
      blocksWhen("tank.fire_valve_test", { field: "tank.fire_valve_test", equals: "fail" }, "Fire valve test required but failed."),
      requiredRule("oilsvc.post.co_ppm", "Post-service combustion reading is required."),
      mustEqual("oilsvc.safety", "yes", "Safety control failed."),
      requiredRule("oilsvc.final_status", "Final condition is required."),
      blocksWhen("oilsvc.final_status", { field: "oilsvc.final_status", equals: "unsafe_fire_pollution" }, "Oil leak / fire / pollution hazard needs make-safe and escalation. Do not use gas unsafe classifications."),
    ],
    gates: [
      gate("attendance", "Attendance and oil competency", keys(attendance), { shared: "A" }),
      gate("pre", "Customer report and pre-service checks", keys(pre), { shared: "B" }),
      gate("boiler", "Boiler / burner service", keys(boiler)),
      gate("tank", "Oil tank and supply inspection", keys(tank), { shared: "C" }),
      gate("signoff", "Post-service, defects and sign-off", keys(post), { shared: "D" }),
    ],
  });
}

export const PUBLISHED_WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  gasServiceTemplate(),
  gasInstallTemplate(),
  landlordTemplate(),
  unsafeTemplate(),
  repairTemplate(),
  oilInstallTemplate(),
  oilServiceTemplate(),
];

export function getPublishedTemplate(costCentreCode: string, version?: number) {
  return PUBLISHED_WORKFLOW_TEMPLATES.find(
    (template) => template.costCentreCode === costCentreCode && (version == null || template.version === version),
  ) ?? null;
}

export function getPublishedTemplateById(id: string) {
  return PUBLISHED_WORKFLOW_TEMPLATES.find((template) => template.id === id) ?? null;
}
