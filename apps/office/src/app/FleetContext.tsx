import { createContext, useContext } from "react";
import type { FleetStore } from "../data/store";
import type { Me, Transport } from "../transport/types";

export interface Fleet {
  store: FleetStore;
  transport: Transport;
  me: Me;
  /** The artifact is open outside Claude: nothing can load. */
  noConnector: boolean;
  /** Web build only. */
  signOut?: () => void;
  /** Artifact build only: Claude's permissions sheet. */
  managePermissions?: () => Promise<boolean>;
}

const Ctx = createContext<Fleet | null>(null);
export const FleetProvider = Ctx.Provider;

export function useFleet(): Fleet {
  const f = useContext(Ctx);
  if (!f) throw new Error("FleetProvider is missing");
  return f;
}
