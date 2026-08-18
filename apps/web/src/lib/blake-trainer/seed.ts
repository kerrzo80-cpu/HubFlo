import { generateBlakeTrainerCatalog } from "@/lib/blake-trainer/system-knowledge";
import type { TrainerStoreState } from "@/lib/blake-trainer/types";

export function createBlakeTrainerSeedState(): TrainerStoreState {
  const catalog = generateBlakeTrainerCatalog({
    approvedBy: "Brian Kerr",
    createdBy: "Brian Kerr",
  });
  return {
    materials: catalog.materials,
    modules: catalog.modules,
    flows: catalog.flows,
    progress: [],
  };
}
