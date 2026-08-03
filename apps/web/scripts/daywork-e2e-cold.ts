import { getHubDetailState } from "@/lib/hub-detail-store";
import { findDayworkSheetForJob, readDayworkSheetsStore } from "@/lib/daywork-sheets-store";
import { getServerStoreBackend, readServerStoreSnapshot } from "@/lib/server-store";
console.log("backend", getServerStoreBackend());
console.log("disk dedicated", readServerStoreSnapshot("daywork-sheets-store"));
const after = getHubDetailState();
const found = findDayworkSheetForJob((after.dayworkSheets || {}) as any, "job-gas-cert-trial", "job-gas-cert-trial-daywork-account");
console.log("memory store", readDayworkSheetsStore());
console.log("cold", {
  keys: Object.keys(after.dayworkSheets || {}),
  mats: found?.materialsJson,
  client: found?.clientSignerName,
  sigs: !!(found?.plumberSignature && found?.clientSignature),
});
if (!found?.materialsJson?.includes("copper")) {
  console.error("FAIL cold");
  process.exit(1);
}
console.log("PASS cold");
