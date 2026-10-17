// Photos the office adds (Phase 7, §5, §6): a driver's profile photo on the
// driver's manage page (Replace photo) and a vehicle's photo on its page
// (Upload photo / Replace photo). The browser makes the sizes (imageCanvas),
// a tool hands out a one-time signed upload, the file goes straight to
// Storage (the web app's `files`), then set_driver_photo / set_vehicle_photo
// saves it. The artifact has no `files`: the buttons are not there.
import { useRef, useState } from "react";
import { useFleet } from "../app/FleetContext";
import type { UploadTicket } from "../data/types";
import { asFleetError, errText } from "../transport/errors";
import { Avatar, Notice, VehicleThumb } from "../ui/basics";
import { profilePhoto, vehiclePhoto } from "./imageCanvas";
import { canSetDriverPhoto, canSetVehiclePhoto } from "./mediaLogic";

type Msg = { tone: "ok" | "bad"; text: string } | null;

/** A button that opens the file picker; the input's own label is the button's words (for screen readers and tests). */
export function FilePick({ label, busy, busyLabel = "Uploading…", accept, onFile, className = "btn" }: {
  label: string;
  busy?: boolean;
  busyLabel?: string;
  accept: string;
  onFile: (file: File) => void;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept={accept} hidden aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ""; // the same file can be picked again after an error
          if (f) onFile(f);
        }} />
      <button type="button" className={className} disabled={busy} onClick={() => ref.current?.click()}>{busy ? busyLabel : label}</button>
    </>
  );
}

/** Drivers → driver: the photo with Replace photo (the vehicles permission; the web app). Nothing in the artifact. */
export function DriverPhotoCard({ username, name, photoUrl, onSaved }: { username: string; name: string; photoUrl?: string; onSaved?: () => void }) {
  const { me, transport, store, files } = useFleet();
  const [saved, setSaved] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  if (!files || !canSetDriverPhoto(me.tools, true)) return null;
  const src = saved ?? photoUrl;

  async function pick(file: File) {
    if (!files) return;
    setBusy(true);
    setMsg(null);
    try {
      const jpeg = await profilePhoto(file);
      const { upload } = await transport.call<{ upload: UploadTicket }>("photo_upload_url", { kind: "driver_profile", target: username });
      await files.upload(upload, jpeg, "image/jpeg");
      const r = await transport.call<{ photo_url?: string }>("set_driver_photo", { driver: username, path: upload.path });
      setSaved(r.photo_url);
      setMsg({ tone: "ok", text: "Photo replaced. The old one is kept." });
      void store.invalidate();
      onSaved?.();
    } catch (e) {
      setMsg({ tone: "bad", text: errText(asFleetError(e))[0] });
    }
    setBusy(false);
  }

  return (
    <div className="card card-b form" data-testid="driver-photo">
      <h2>Photo</h2>
      <div className="row" style={{ padding: 0 }}>
        <Avatar name={name} src={src} large />
        <p className="grow muted small" style={{ margin: 0 }}>A clear photo of the face. It is cut to a square in the middle and made 512 × 512.</p>
        <FilePick label={src ? "Replace photo" : "Add photo"} busy={busy} accept="image/*" onFile={(f) => void pick(f)} />
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}

/** The vehicle's page: the photo large, with Upload photo / Replace photo (the vehicles permission; the web app). */
export function VehiclePhotoCard({ reg, photoUrl }: { reg: string; photoUrl?: string }) {
  const { me, transport, store, files } = useFleet();
  const [saved, setSaved] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const can = !!files && canSetVehiclePhoto(me.tools, true);
  const src = saved ?? photoUrl;
  if (!src && !can) return null;

  async function pick(file: File) {
    if (!files) return;
    setBusy(true);
    setMsg(null);
    try {
      const { photo, thumb } = await vehiclePhoto(file);
      const t = await transport.call<{ upload: UploadTicket; thumb?: UploadTicket }>("photo_upload_url", { kind: "vehicle", target: reg });
      if (!t.thumb) throw { code: "tool_error", message: "The server gave no place for the thumbnail. Try again." };
      await files.upload(t.upload, photo, "image/jpeg");
      await files.upload(t.thumb, thumb, "image/jpeg");
      const r = await transport.call<{ photo_url?: string }>("set_vehicle_photo", { vehicle: reg, path: t.upload.path, thumb_path: t.thumb.path });
      setSaved(r.photo_url);
      setMsg({ tone: "ok", text: src ? "Photo replaced." : "Photo added." });
      void store.invalidate();
    } catch (e) {
      setMsg({ tone: "bad", text: errText(asFleetError(e))[0] });
    }
    setBusy(false);
  }

  return (
    <div className="card card-b vphoto" data-testid="vehicle-photo">
      {src ? <VehicleThumb src={src} plate={reg} size="lg" /> : <p className="muted small" style={{ margin: 0 }}>No photo of this vehicle yet.</p>}
      {can && (
        <div className="acts">
          <FilePick label={src ? "Replace photo" : "Upload photo"} busy={busy} accept="image/*" onFile={(f) => void pick(f)} />
        </div>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}
