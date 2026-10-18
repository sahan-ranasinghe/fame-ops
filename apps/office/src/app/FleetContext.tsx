import { createContext, useContext } from "react";
import type { LatestRow } from "../data/live";
import type { PointRow } from "../data/realtime";
import type { FleetStore } from "../data/store";
import type { UploadTicket } from "../data/types";
import type { Me, Transport } from "../transport/types";

export interface Fleet {
  store: FleetStore;
  transport: Transport;
  me: Me;
  /** The artifact is open outside Claude: nothing can load. */
  noConnector: boolean;
  /** Web build only. */
  signOut?: () => void;
  /** Web build only (Hotfix 2, F): asks GET /me again (after the person saved their phone number); the store and the page stay. */
  refreshMe?: () => Promise<void>;
  /** Artifact build only: Claude's permissions sheet. */
  managePermissions?: () => Promise<boolean>;
  /** Web build only: live rows from the database (Supabase Realtime). */
  realtime?: {
    driverLatest: (cb: (row: LatestRow) => void, onStatus?: (s: "connecting" | "live" | "error") => void) => () => void;
    /** Every new location point of one driver (the driver page's line grows point by point). */
    driverPoints?: (employeeId: string, cb: (row: PointRow) => void, onStatus?: (s: "connecting" | "live" | "error") => void) => () => void;
    /** Every new location point of several drivers on one channel (the live map's trails). */
    driversPoints?: (employeeIds: string[], cb: (row: PointRow) => void, onStatus?: (s: "connecting" | "live" | "error") => void) => () => void;
    /** Any change on the issues table (the bell, the Needs a driver banner and the Issues page reload). */
    issues?: (cb: () => void) => () => void;
    /** Hotfix 2 (A): a new or read item in the signed-in person's notification centre (office_inbox). */
    inbox?: (cb: () => void) => () => void;
  };
  /** Web build only (Phase 7): a photo or document goes up through the signed upload a tool handed out. None = no upload buttons. */
  files?: { upload: (ticket: UploadTicket, file: Blob, contentType: string) => Promise<void> };
}

const Ctx = createContext<Fleet | null>(null);
export const FleetProvider = Ctx.Provider;

export function useFleet(): Fleet {
  const f = useContext(Ctx);
  if (!f) throw new Error("FleetProvider is missing");
  return f;
}
