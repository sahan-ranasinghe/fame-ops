import { createContext, useContext } from "react";
import type { LatestRow } from "../data/live";
import type { PointRow } from "../data/realtime";
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
  /** Web build only: live rows from the database (Supabase Realtime). */
  realtime?: {
    driverLatest: (cb: (row: LatestRow) => void, onStatus?: (s: "connecting" | "live" | "error") => void) => () => void;
    /** Every new location point of one driver (the driver page's line grows point by point). */
    driverPoints?: (employeeId: string, cb: (row: PointRow) => void, onStatus?: (s: "connecting" | "live" | "error") => void) => () => void;
  };
}

const Ctx = createContext<Fleet | null>(null);
export const FleetProvider = Ctx.Provider;

export function useFleet(): Fleet {
  const f = useContext(Ctx);
  if (!f) throw new Error("FleetProvider is missing");
  return f;
}
