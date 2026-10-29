// Round 49: the set-password link in the e2e. A link is <site>/set-password#k=<token> (passwordLinks.ts): the tests open
// its path on their own server (port 5174, while the link names the site's address), or set the password through
// office-api's public route as the page does, when a test only needs a signed-in person.
const API = (process.env.API_URL || "http://127.0.0.1:54321").replace(/\/$/, "");

/** The link's path and hash on the test's own server. */
export const linkPath = (link: string) => `/set-password${link.slice(link.indexOf("#"))}`;

/** The page's Save, without the page: the only call that uses a link. */
export async function setPasswordByLink(link: string, password: string): Promise<void> {
  const token = new URLSearchParams(link.slice(link.indexOf("#") + 1)).get("k");
  const res = await fetch(`${API}/functions/v1/office-api/public/password-link/set`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
  if (!res.ok) throw new Error(`set password through the link: ${res.status} ${await res.text()}`);
}
