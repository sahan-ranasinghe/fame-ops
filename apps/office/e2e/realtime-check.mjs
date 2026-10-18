// Does a Realtime postgres_changes subscription on driver_latest deliver rows to an office user? (local stack only)
import { createClient } from "@supabase/supabase-js";
const API = process.env.API_URL, ANON = process.env.ANON_KEY, SERVICE = process.env.SERVICE_ROLE_KEY, KEY = process.env.OFFICE_MCP_KEY;
const stamp = Date.now().toString(36);
async function tool(name, args) {
  const r = await fetch(`${API}/functions/v1/office-mcp/${KEY}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const raw = await r.text(); const line = raw.replace(/\r/g, "").split("\n").filter((l) => l.startsWith("data: ") || l.startsWith("{")).pop();
  const msg = JSON.parse(line.replace(/^data: /, "")); if (msg.error || msg.result?.isError) throw new Error(msg.error?.message || msg.result.content[0].text);
  return JSON.parse(msg.result.content[0].text);
}
const admin = createClient(API, SERVICE, { auth: { persistSession: false } });
const email = `rt.${stamp}@fame.test`;
const created = await tool("create_office_user", { name: "RT Check", email, role: "admin" });
const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
const u = list.users.find((x) => x.email === email);
await admin.auth.admin.updateUserById(u.id, { password: `Sentence for ${stamp}!` });
console.log("1. office user created:", created.created.email);
const driver = { name: "RT Driver", code: `RT-${stamp}`, username: `rt.${stamp}`, pin: "135790", phone: "0771234503" };
await tool("create_driver", driver);
const drv = createClient(API, ANON, { auth: { persistSession: false } });
const ds = await drv.auth.signInWithPassword({ email: `${driver.username}@drivers.fame.invalid`, password: driver.pin });
if (ds.error) throw ds.error;
const { data: me } = await drv.from("employees").select("id").single();
const session = crypto.randomUUID();
let r = await drv.from("duty_sessions").insert({ id: session, employee_id: me.id, device_info: { model: "rt" } });
if (r.error) throw r.error;
console.log("2. driver signed in, sharing started");

const office = createClient(API, ANON, { auth: { persistSession: false } });
const os = await office.auth.signInWithPassword({ email, password: `Sentence for ${stamp}!` });
if (os.error) throw os.error;
const seen = [];
const status = await new Promise((resolve) => {
  office.channel("driver_latest").on("postgres_changes", { event: "*", schema: "public", table: "driver_latest" }, (p) => seen.push(p)).subscribe((s, err) => { console.log("3. channel status:", s, err ? String(err) : ""); if (s !== "SUBSCRIBED" && s !== "CHANNEL_ERROR" && s !== "TIMED_OUT") return; resolve(s); });
});
const point = (secondsAgo, speed) => ({ employee_id: me.id, session_id: session, recorded_at: new Date(Date.now() - secondsAgo * 1000).toISOString(), lat: 6.86 + Math.random() / 100, lng: 79.9, accuracy_m: 8, speed_mps: speed, battery_pct: 70 });
r = await drv.from("location_points").insert([point(30, 10)]); if (r.error) throw r.error;
await new Promise((x) => setTimeout(x, 2000));
r = await drv.from("location_points").insert([point(1, 20)]); if (r.error) throw r.error;
await new Promise((x) => setTimeout(x, 2000));
// A heartbeat saying Location is off: the same row changes again (hb_* columns).
r = await drv.rpc("send_heartbeat", { p_at: new Date().toISOString(), p_sharing: true, p_location_on: false, p_permission: "always", p_battery_pct: 70, p_app_version: "rt-check", p_queued_points: 1 });
if (r.error) throw r.error;
await new Promise((x) => setTimeout(x, 6000));
console.log("4. events received:", seen.length, seen.map((p) => `${p.eventType} speed=${p.new?.speed_mps} hb_on=${p.new?.hb_location_on} hb_at=${p.new?.hb_at ? "set" : "null"}`).join(" | "));
const { data: rows, error } = await office.from("driver_latest").select("employee_id, speed_mps, sharing").eq("employee_id", me.id);
console.log("5. REST read as the office user:", error ? String(error.message) : JSON.stringify(rows));
await office.removeAllChannels();
process.exit(status === "SUBSCRIBED" && seen.length >= 3 ? 0 : 1);
