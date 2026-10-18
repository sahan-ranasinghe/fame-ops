// The privacy policy (Phase 7 Part 6, store readiness): /privacy on the office site, open without signing in (WebApp
// shows it before the sign-in gate), linked from the driver app's sign-in and Me screens and from the site's sign-in.
// Plain English, and only what the system really does: the retention periods are the database's jobs (README "Data
// retention"). Fame Global Solutions reviews the text before the app goes to a store.
import type { CSSProperties, ReactNode } from "react";

export const PRIVACY_UPDATED = "19 October 2026";

const page: CSSProperties = { minHeight: "100vh", background: "var(--bg)", color: "var(--ink)", font: "16px/1.6 var(--font-body)" };
const column: CSSProperties = { maxWidth: 720, margin: "0 auto", padding: "32px 16px 64px" };
const h2: CSSProperties = { font: "800 20px/1.3 var(--font-display)", margin: "32px 0 8px" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 style={h2}>{title}</h2>
      {children}
    </section>
  );
}

export function Privacy() {
  return (
    <div style={page}>
      <main style={column}>
        <div className="brand" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div className="logo">FF</div>
          <div style={{ display: "grid" }}>
            <b>Fame Fleet</b>
            <span style={{ color: "var(--muted)" }}>Fame Global Solutions</span>
          </div>
        </div>
        <h1 style={{ font: "800 32px/1.2 var(--font-display)", margin: "24px 0 4px" }}>Privacy policy</h1>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>Last updated {PRIVACY_UPDATED}</p>

        <p>
          Fame Fleet is the app and the office site that Fame Global Solutions uses to run its vehicles: drivers get their
          tasks and record their trips, and the office plans the trips and sees where the vehicles are. It is for Fame
          Global Solutions' drivers and office staff only. Accounts are made by the company; nobody can sign up.
        </p>

        <Section title="What we collect">
          <ul>
            <li>
              <b>Your location, only while you are on duty.</b> From the moment you tap Start work (or start a task) until
              you tap Finish work, or the day ends at the cut-off time, the app records where the vehicle is, about every 5
              seconds while it moves and once a minute while it stands. This includes when the app is closed or not in use,
              because a trip goes on while the phone is in a pocket. Off duty, nothing is recorded. When the office asks
              "Where are you now?", the app sends one position only if you tap to answer.
            </li>
            <li>
              <b>Photos and videos you take in the app:</b> the odometer, fuel receipts, the video of a fuel fill, vehicle
              problems, your profile photo, your licence (front and back) and vehicle photos and documents.
            </li>
            <li>
              <b>Your details:</b> name, employee code, username, mobile and WhatsApp numbers, an emergency contact,
              licence number and expiry date, and the language you use. Your PIN is stored only in a form that cannot be
              read back.
            </li>
            <li>
              <b>Your work:</b> tasks, the times you started and finished them, odometer readings, fuel, the km driven,
              reports about the vehicle, when you are not available, and your answers to the office's questions.
            </li>
            <li>
              <b>About the phone, so the office can help when recording stops:</b> whether location and notifications are on,
              the battery level, the app version, the phone's make and model, and a token for push notifications.
            </li>
          </ul>
          <p>We do not collect your contacts, messages, calls or files, we show no ads and we never sell data.</p>
        </Section>

        <Section title="Who sees it">
          <ul>
            <li>
              <b>The Fame Global Solutions office.</b> Each person sees only what their work needs: the people who plan
              trips see positions, trips and tasks; your phone numbers, emergency contact and licence are seen only by the
              fleet admin and the people who manage drivers or vehicles.
            </li>
            <li>
              <b>Service providers that run parts of the system for us,</b> each only for that job: Supabase (the database
              and file storage), Google (maps, place search, road routes, push notifications through Firebase, and reading
              the number from an odometer photo), Expo (push notifications) and openrouteservice (road routes and the
              likely road over a gap in a recorded trip).
            </li>
            <li>Nobody else, unless the law requires it.</li>
          </ul>
        </Section>

        <Section title="How long it is kept">
          <ul>
            <li>Location points: 90 days. The last known position of each driver stays until the next one replaces it.</li>
            <li>The phone's status reports: 30 days.</li>
            <li>Fuel videos: 12 months (or 6 months if the company sets it so).</li>
            <li>Answers to the office's questions: 30 days. Read office notifications: 90 days.</li>
            <li>
              Tasks, trips, odometer readings, fuel, vehicle reports, their photos and your details are company records and
              are kept while the company needs them for its vehicles, costs and accounts.
            </li>
          </ul>
        </Section>

        <Section title="Your choices">
          <ul>
            <li>
              Location: the app asks for your permission, and you can turn it off in the phone's settings at any time. The
              app cannot record trips without it, so the office will see that recording has stopped.
            </li>
            <li>Notifications and the camera: also your choice in the phone's settings.</li>
            <li>
              To see, correct or remove your data, ask the fleet admin of Fame Global Solutions. Your account is switched
              off when you leave; the company keeps its records as above.
            </li>
          </ul>
        </Section>

        <Section title="Security">
          <p>
            Data travels encrypted (HTTPS). Every person signs in with their own account, and the server checks what each
            account may see on every request. Photos and videos are private files, opened only through short-lived links.
          </p>
        </Section>

        <Section title="Questions">
          <p>Ask the fleet admin of Fame Global Solutions, or the office through the phone number in the app.</p>
        </Section>
      </main>
    </div>
  );
}
