// Hotfix O2-H2, Part 1c: Settings → App errors (users): the crash reports the Fame Fleet app sent (list_app_errors), newest
// first: when, office or driver side, who was signed in, the app version and update, the screen and the error, with the
// first stack lines folded under each. Scrubbed of personal data on the phone and on the server; kept 90 days.
import { useQuery } from "../../data/useQuery";
import { errText } from "../../transport/errors";
import { Loading, Notice, Pill } from "../../ui/basics";
import { EmptyLine } from "../../ui/ListKit";
import { PageTop } from "../../ui/Page";

export interface AppErrorRow {
  id: number;
  at: string;
  happened?: string;
  side: "office" | "driver";
  fatal: boolean;
  who?: string;
  app_version?: string;
  update_id?: string;
  runtime?: string;
  screen?: string;
  message: string;
  stack?: string;
}
export interface AppErrors {
  count: number;
  total?: number;
  next?: string;
  errors: AppErrorRow[];
}

export default function AppErrorsPage() {
  const q = useQuery<AppErrors>("app-errors", "list_app_errors", { limit: 50 }, { every: 60_000 });
  return (
    <section className="view" data-testid="app-errors">
      <PageTop title="App errors" sub="What the Fame Fleet app reported when it showed its crash screen" backTo="/settings" />
      {q.loading && <Loading>Loading the reports…</Loading>}
      {q.err && <Notice tone="bad">{errText(q.err)[0]}</Notice>}
      {q.data && q.data.errors.length === 0 && <EmptyLine>No crash reports in the last 90 days.</EmptyLine>}
      {q.data && q.data.errors.length > 0 && (
        <div className="card">
          {q.data.errors.map((e) => (
            <div className="row" key={e.id} data-testid="app-error-row" style={{ alignItems: "flex-start" }}>
              <div className="grow">
                <div className="name">
                  {e.message} {e.fatal ? <Pill tone="bad">Crash screen</Pill> : <Pill>Survived</Pill>}
                </div>
                <div className="sub">
                  {[e.at, e.side === "office" ? "Office mode" : "Driver side", e.who, e.app_version, e.runtime, e.screen].filter(Boolean).join(" · ")}
                </div>
                {e.stack && (
                  <details>
                    <summary className="small">Stack</summary>
                    <pre className="mono small" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{e.stack}</pre>
                  </details>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
