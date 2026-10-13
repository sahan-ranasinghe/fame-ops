// A screen the person may not open (a direct URL, or a locked menu item). The
// server refuses the tools anyway; this page only says so in words.
import { PERMISSION_TEXT, type Permission } from "@fleet/permissions";
import { Link } from "react-router";
import { Icon } from "../ui/icons";

export function NoAccess({ need = [] }: { need?: Permission[] }) {
  const labels = need.map((p) => PERMISSION_TEXT[p].label).join(" or ");
  return (
    <section className="view" data-testid="no-access">
      <div className="ph"><div><div className="eyebrow">Fame Fleet</div><h1>No access</h1></div></div>
      <div className="card card-b" style={{ maxWidth: 560, display: "grid", gap: 14 }}>
        <div className="row" style={{ padding: 0 }}>
          <span className="att-ic warn"><Icon name="lock" /></span>
          <p className="grow" style={{ margin: 0 }}>
            Your account does not have this permission{labels ? ` (${labels})` : ""}. Ask an admin for access.
          </p>
        </div>
        <div className="acts"><Link className="btn" to="/">Home</Link></div>
      </div>
    </section>
  );
}
