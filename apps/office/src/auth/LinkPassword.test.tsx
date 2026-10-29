// Round 49: the set-password link's page (auth/LinkPassword.tsx). Opening only checks (any number of times); Save is the
// one call that uses the link and then signs in; a link that can no longer be used, or none, gets the friendly sentence in
// English or Sinhala; no answer offers Try again; the eye says its words in the chosen language.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LinkPassword, type LinkApi } from "./LinkPassword";
import { isLinkLanding, LINK_WORDS, linkToken, startLang } from "./linkWords";

const TOKEN = "A".repeat(40) + "b_-";
const HASH = `#k=${TOKEN}`;

function fakeApi(check: { status: number; body: unknown }, save: { status: number; body: unknown } = { status: 200, body: { ok: true, email: "s@x.test" } }) {
  const calls: string[] = [];
  const api: LinkApi = {
    check: (token) => {
      calls.push(`check ${token}`);
      return Promise.resolve(check as never);
    },
    save: (token, password) => {
      calls.push(`save ${token} ${password}`);
      return Promise.resolve(save as never);
    },
  };
  return { api, calls };
}

const valid = { status: 200, body: { state: "valid", name: "Shashen Herath", email: "s@x.test" } };

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("the link's address", () => {
  it("reads the 43-character token after #k=; anything else is no token", () => {
    expect(linkToken(HASH)).toBe(TOKEN);
    expect(linkToken(`#x=1&k=${TOKEN}`)).toBe(TOKEN);
    expect(linkToken("#k=short")).toBeNull();
    expect(linkToken("")).toBeNull();
  });
  it("/set-password opens this page; Supabase's old recovery landings keep their flow; an old used one gets the sentence", () => {
    expect(isLinkLanding("/set-password", HASH)).toBe(true);
    expect(isLinkLanding("/set-password/", "")).toBe(true);
    expect(isLinkLanding("/set-password", "#error=access_denied&error_code=otp_expired")).toBe(true);
    expect(isLinkLanding("/set-password", "#access_token=x&type=recovery")).toBe(false);
    expect(isLinkLanding("/", HASH)).toBe(false);
  });
  it("the language: the one chosen before, else the browser's, else English", () => {
    expect(startLang("si", "en-GB")).toBe("si");
    expect(startLang(null, "si-LK")).toBe("si");
    expect(startLang(null, "en-US")).toBe("en");
    expect(startLang("fr", undefined)).toBe("en");
  });
  it("every word has its Sinhala", () => {
    expect(Object.keys(LINK_WORDS.si).sort()).toEqual(Object.keys(LINK_WORDS.en).sort());
  });
});

describe("LinkPassword", () => {
  it("opening checks the link and never uses it; the form names the account", async () => {
    const { api, calls } = fakeApi(valid);
    render(<LinkPassword hash={HASH} api={api} signIn={() => Promise.resolve(true)} openApp={() => {}} />);
    expect(screen.getByRole("status").textContent).toContain("Checking your link…");
    expect((await screen.findByTestId("link-for")).textContent).toContain("For Shashen Herath · s@x.test");
    expect(calls).toEqual([`check ${TOKEN}`]);
  });

  it("Save uses the link once, then signs in with the new password and opens the app", async () => {
    const { api, calls } = fakeApi(valid);
    const signIn = vi.fn(() => Promise.resolve(true));
    const openApp = vi.fn();
    render(<LinkPassword hash={HASH} api={api} signIn={signIn} openApp={openApp} />);
    await screen.findByTestId("link-for");
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "short one" } });
    fireEvent.change(screen.getByLabelText("Again"), { target: { value: "short one" } });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByText("Use at least 12 characters.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "A long sentence here" } });
    fireEvent.change(screen.getByLabelText("Again"), { target: { value: "A long sentence heRe" } });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByText("The two passwords differ.")).toBeTruthy();
    expect(calls).toEqual([`check ${TOKEN}`]);
    fireEvent.change(screen.getByLabelText("Again"), { target: { value: "A long sentence here" } });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    await waitFor(() => expect(openApp).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([`check ${TOKEN}`, `save ${TOKEN} A long sentence here`]);
    expect(signIn).toHaveBeenCalledWith("s@x.test", "A long sentence here");
  });

  it("a used, replaced or expired link: the friendly sentence and Sign in, never a form or a technical error", async () => {
    const { api } = fakeApi({ status: 200, body: { state: "used" } });
    render(<LinkPassword hash={HASH} api={api} />);
    const dead = await screen.findByTestId("link-dead");
    expect(dead.textContent).toContain("This link has expired or was already used. Ask the fleet admin for a new one.");
    expect(screen.getByRole("heading", { name: "This link can't be used" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/");
    expect(screen.queryByLabelText("New password")).toBeNull();
  });

  it("no token (or Supabase's old used link): the sentence at once, nothing asked", () => {
    const { api, calls } = fakeApi(valid);
    render(<LinkPassword hash="#error=access_denied&error_code=otp_expired" api={api} />);
    expect(screen.getByTestId("link-dead").textContent).toContain("This link has expired or was already used.");
    expect(calls).toEqual([]);
  });

  it("in Sinhala: the sentence, the title and the eye's words; the choice is remembered", async () => {
    const { api } = fakeApi({ status: 200, body: { state: "expired" } });
    render(<LinkPassword hash={HASH} api={api} />);
    await screen.findByTestId("link-dead");
    fireEvent.click(screen.getByRole("tab", { name: "සිංහල" }));
    expect(screen.getByTestId("link-dead").textContent).toContain(LINK_WORDS.si.dead);
    expect(screen.getByRole("heading", { name: LINK_WORDS.si.deadTitle })).toBeTruthy();
    expect(localStorage.getItem("fame.linkLang")).toBe("si");
  });

  it("the form in Sinhala: the labels and the eye", async () => {
    localStorage.setItem("fame.linkLang", "si");
    const { api } = fakeApi(valid);
    render(<LinkPassword hash={HASH} api={api} />);
    await screen.findByTestId("link-for");
    expect(screen.getByLabelText(LINK_WORDS.si.newPassword).getAttribute("type")).toBe("password");
    fireEvent.click(screen.getAllByRole("button", { name: LINK_WORDS.si.show })[0]);
    expect(screen.getByLabelText(LINK_WORDS.si.newPassword).getAttribute("type")).toBe("text");
    expect(screen.getAllByRole("button", { name: LINK_WORDS.si.hide })).toHaveLength(1);
  });

  it("the link was used in another tab meanwhile: Save answers 409 and the page says so", async () => {
    const { api } = fakeApi(valid, { status: 409, body: { ok: false, state: "used" } });
    render(<LinkPassword hash={HASH} api={api} signIn={() => Promise.resolve(true)} openApp={() => {}} />);
    await screen.findByTestId("link-for");
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "A long sentence here" } });
    fireEvent.change(screen.getByLabelText("Again"), { target: { value: "A long sentence here" } });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByTestId("link-dead")).toBeTruthy();
  });

  it("no answer: Fame Fleet did not answer, with Try again; a later answer shows the form", async () => {
    let answer = { status: 0, body: null as unknown };
    const api: LinkApi = { check: () => Promise.resolve(answer as never), save: () => Promise.resolve({ status: 0, body: null }) };
    render(<LinkPassword hash={HASH} api={api} />);
    expect(await screen.findByText("Fame Fleet did not answer.")).toBeTruthy();
    answer = valid;
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
    expect(await screen.findByTestId("link-for")).toBeTruthy();
  });

  it("saved but the sign-in did not go through: the page says so and offers Sign in", async () => {
    const { api } = fakeApi(valid);
    render(<LinkPassword hash={HASH} api={api} signIn={() => Promise.resolve(false)} openApp={() => {}} />);
    await screen.findByTestId("link-for");
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "A long sentence here" } });
    fireEvent.change(screen.getByLabelText("Again"), { target: { value: "A long sentence here" } });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByText("Password saved. Sign in with your e-mail and the new password.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
  });
});
