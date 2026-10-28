// The password / PIN field (ui/SecretField.tsx): hidden by default, the eye shows the value as plain text and hides it
// again, says "Show password" / "Hide password" (a PIN: "Show PIN" / "Hide PIN") with aria-pressed, is a real button
// (keyboard reachable), and the input keeps its own id, autoComplete, maxLength, inputMode and value, so the label still
// points at it.
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { SecretField, type SecretKind } from "./SecretField";

function Form({ kind }: { kind?: SecretKind }) {
  const [v, setV] = useState("");
  return (
    <div className="field">
      <label htmlFor="f-secret">{kind === "pin" ? "6-digit PIN" : "Password"}</label>
      <SecretField kind={kind} id="f-secret" autoComplete="current-password" maxLength={kind === "pin" ? 6 : undefined} inputMode={kind === "pin" ? "numeric" : undefined} value={v} onChange={(e) => setV(e.target.value)} />
    </div>
  );
}

describe("SecretField (Material's password field with the visibility toggle)", () => {
  it("a password: dots by default, the eye shows it as text and hides it again, with the right words and aria-pressed", () => {
    render(<Form />);
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.getAttribute("autocomplete")).toBe("current-password");
    fireEvent.change(input, { target: { value: "correct horse battery" } });
    expect(input.value).toBe("correct horse battery");

    const eye = screen.getByRole("button", { name: "Show password" });
    expect(eye.getAttribute("type")).toBe("button");
    expect(eye.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(eye);
    expect(input.type).toBe("text");
    expect(input.value).toBe("correct horse battery");
    expect(screen.queryByRole("button", { name: "Show password" })).toBeNull();
    const hide = screen.getByRole("button", { name: "Hide password" });
    expect(hide.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(hide);
    expect(input.type).toBe("password");
    expect(screen.getByRole("button", { name: "Show password" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("a PIN: Show PIN / Hide PIN, and the 6-digit numeric input is untouched", () => {
    render(<Form kind="pin" />);
    const input = screen.getByLabelText("6-digit PIN") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.maxLength).toBe(6);
    expect(input.getAttribute("inputmode")).toBe("numeric");
    fireEvent.click(screen.getByRole("button", { name: "Show PIN" }));
    expect(input.type).toBe("text");
    expect(screen.getByRole("button", { name: "Hide PIN" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("the eye is a button the keyboard reaches (not tabindex -1), inside the field at the right", () => {
    const { container } = render(<Form />);
    const eye = screen.getByRole("button", { name: "Show password" });
    expect(eye.getAttribute("tabindex")).toBeNull();
    expect(container.querySelector(".secret > input + .secret-eye")).toBe(eye);
  });
});
