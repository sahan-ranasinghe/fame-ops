import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

// waitFor and findBy wait up to 5 s (1 s by default): under the full suite's load (about 100 files at once) a screen's
// answer can take longer than a second, and two tests failed that way while passing alone (19 October). A condition
// that never holds still fails; the test's own limit stays 15 s (vite.config.ts).
configure({ asyncUtilTimeout: 5_000 });
