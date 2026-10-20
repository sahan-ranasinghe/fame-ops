import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles.css";
import { mobileTarget, readChoice, touchPointer } from "./app/viewChoice";

// A phone gets the mobile website (/m/, Office mode's own screens) unless this browser chose the desktop view (O4). The
// artifact (Claude) never moves.
const toMobile = import.meta.env.MODE === "artifact" ? null : mobileTarget(location.pathname, location.search, readChoice(), window.innerWidth, navigator.userAgent, touchPointer());
if (toMobile) location.replace(toMobile);
else createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
