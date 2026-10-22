import { PERMISSION_TEXT } from "@fleet/permissions";
import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import { moreFor, NAV_SECTIONS, SUB_PAGES } from "../app/nav";
import { badgeText, useNavBadges } from "../app/navBadges";
import { ROLE_LABEL } from "../transport/types";
import { Avatar } from "../ui/basics";
import { Icon } from "../ui/icons";
import { phoneLike, saveChoice, touchPointer } from "../app/viewChoice";
import { useSwitchesOff } from "./dispatchParts";

/**
 * Round 2b (Instagram / WhatsApp settings): the profile card at the top (My profile, Settings, Sign out: each once, here
 * only), then everything the person may open that is not on the phone's tab bar, grouped as the desktop menu is (Today,
 * Fleet, Reports, Admin), with Issues and Requests carrying their counts.
 */
export function More() {
  const { me, signOut, transport } = useFleet();
  // Round 4–7: a page a switch turns off is not listed (Asks with holder_contact off).
  const more = moreFor(me, useSwitchesOff()).filter((n) => n.key !== "settings");
  // A sub-page (Task history, Asks) sits in the section of the page it follows (nav.ts SUB_PAGES `after`): before, only Task
  // history was placed and Asks was in no section, so More never showed it.
  const sectionKey = (key: string) => SUB_PAGES.find((x) => x.key === key)?.after ?? key;
  const groups = NAV_SECTIONS
    .map((g) => ({ ...g, items: more.filter((n) => g.keys.includes(sectionKey(n.key))) }))
    .filter((g) => g.items.length > 0);
  const badges = useNavBadges();
  return (
    <section className="view">
      <div className="ph"><div><div className="eyebrow">Your account, then everything else</div><h1>More</h1></div></div>
      <div className="stack" style={{ maxWidth: 560 }}>
        <div className="card card-b">
          {/* Round 3: my photo (the initials until there is one; Change photo is on My profile). */}
          <div className="person" style={{ marginBottom: 14 }} data-testid="more-person"><Avatar name={me.name} src={me.photo_url} large /><b>{me.name || "—"}</b></div>
          <dl className="kv">
            <div><dt>Name</dt><dd>{me.name || "—"}</dd></div>
            <div><dt>Role</dt><dd>{ROLE_LABEL[me.role] ?? me.role}</dd></div>
            {me.email && <div><dt>E-mail</dt><dd>{me.email}</dd></div>}
            {/* Hotfix 2 (F): the person's own number (Call the fleet admin), changed on My profile. */}
            <div><dt>Phone</dt><dd>{me.phone_display ?? me.phone ?? <Link to="/settings/profile">Add my number</Link>}</dd></div>
            <div><dt>Fame Fleet</dt><dd>{__VERSION__} · {transport.kind === "api" ? "web" : "Claude"}</dd></div>
            <div style={{ gridColumn: "1/-1" }}>
              <dt>Permissions</dt>
              <dd>{me.permissions.length ? me.permissions.map((p) => <span key={p} className="perm">{PERMISSION_TEXT[p].label}</span>) : "None"}</dd>
            </div>
          </dl>
          <div className="acts" style={{ marginTop: 16 }}>
            <Link className="btn" to="/settings/profile">My profile</Link>
            <Link className="btn" to="/settings">Settings</Link>
            {signOut && <button type="button" className="btn" onClick={signOut}>Sign out</button>}
          </div>
          {/* O4: a phone that chose the desktop view can go back to the mobile website (remembered in this browser). */}
          {transport.kind === "api" && phoneLike(window.innerWidth, navigator.userAgent, touchPointer()) && (
            <div className="acts" style={{ marginTop: 16 }}>
              <button type="button" className="btn" data-testid="switch-mobile" onClick={() => { saveChoice("mobile"); location.assign("/m/"); }}>Switch to mobile view</button>
            </div>
          )}
        </div>
        {groups.map((g) => (
          <div key={g.key} className="stack" style={{ gap: 6 }}>
            <div className="eyebrow">{g.label}</div>
            <div className="more-list" data-testid={`more-list-${g.key}`}>
              {g.items.map((n) => (
                <Link key={n.key} to={n.path}><Icon name={n.key} />{n.label}{badges[n.key] ? <span className="badge" data-testid={`more-badge-${n.key}`}>{badgeText(badges[n.key])}</span> : null}</Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
