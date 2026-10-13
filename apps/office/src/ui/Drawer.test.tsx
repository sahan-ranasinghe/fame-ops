import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DrawerProvider, DrawerTop, useDraft, useDrawer } from "./Drawer";

function Form() {
  const [f, setF] = useDraft({ name: "" });
  return (
    <>
      <DrawerTop title="Add office user" />
      <label htmlFor="name">Full name</label>
      <input id="name" value={f.name} onChange={(e) => setF({ name: e.target.value })} />
    </>
  );
}
function Opener() {
  const drawer = useDrawer();
  return <button type="button" onClick={() => drawer.open(<Form />)}>Open</button>;
}

describe("the form dialog", () => {
  it("never closes on a click outside; Close with unsaved input asks first, Keep editing keeps the text, Discard closes", () => {
    render(<DrawerProvider><Opener /></DrawerProvider>);
    fireEvent.click(screen.getByText("Open"));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Palitha" } });
    fireEvent.click(screen.getByTestId("drawer")); // the backdrop
    expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe("Palitha");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("discard").textContent).toContain("Discard changes?");
    fireEvent.click(screen.getByText("Keep editing"));
    expect(screen.queryByTestId("discard")).toBeNull();
    expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe("Palitha");

    fireEvent.click(screen.getByLabelText("Close"));
    fireEvent.click(screen.getByText("Discard"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes at once when nothing was typed", () => {
    render(<DrawerProvider><Opener /></DrawerProvider>);
    fireEvent.click(screen.getByText("Open"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
