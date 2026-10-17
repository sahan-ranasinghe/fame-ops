// The short name in "Kamal's vehicle today" (hotfix, 17 October 2026).
import { assertEquals } from "@std/assert";
import { firstName, shortName } from "./names.ts";

Deno.test("shortName: the first name unless another driver shares it", () => {
  assertEquals(firstName("  Kamal  Perera "), "Kamal");
  assertEquals(shortName("Kamal Perera", ["Kamal Perera", "Nimal Silva"]), "Kamal");
  assertEquals(shortName("Test Driver", ["Test Driver", "Test Driver 2", "Kanishka"]), "Test Driver");
  assertEquals(shortName("Test Driver 2", ["Test Driver", "Test Driver 2"]), "Test Driver 2");
  assertEquals(shortName("kamal a", ["Kamal B"]), "kamal a");
  assertEquals(shortName("Kanishka", []), "Kanishka");
});
