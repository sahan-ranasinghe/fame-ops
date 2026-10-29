// Fix B (29 October 2026): From / To / Add stop, Uber's and Google Maps' route form. A new trip opens with From (the base
// place) and one To, and comes back to the office; the forms used to open with two rows, a pickup at Stop 1 and the drop at
// Stop 2, going one way. `twoStops` makes that same trip on the new form, so a test that only needs a trip sends what it sent
// before: + Add stop, Stop 1 with People get in (a pickup of people) under its ⋯ Options, To, and Then back to the office off.
import type { Page } from "@playwright/test";

export async function twoStops(page: Page, first: string, to: string, { back = false }: { back?: boolean } = {}): Promise<void> {
  await page.getByRole("button", { name: "Add stop" }).click();
  await page.getByRole("button", { name: "Options for Stop 1" }).click();
  const options = page.getByTestId("stop-options");
  await options.getByRole("button", { name: "People get in" }).click();
  await options.getByRole("button", { name: "Done" }).click();
  await page.getByLabel("Stop 1", { exact: true }).fill(first);
  await page.getByLabel("To", { exact: true }).fill(to);
  const switchBack = page.getByRole("switch", { name: "Then back to the office" });
  if (!back && (await switchBack.isChecked())) await switchBack.uncheck();
}

/** To's arrive-by, in its ⋯ Options (it was the second row's Arrive by). */
export async function arriveByAtTo(page: Page, time: string): Promise<void> {
  await page.getByRole("button", { name: "Options for To" }).click();
  const options = page.getByTestId("stop-options");
  await options.getByLabel("Arrive by").fill(time);
  await options.getByRole("button", { name: "Done" }).click();
}
