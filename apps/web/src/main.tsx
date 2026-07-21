import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
// Self-hosted, legibility-research typefaces: Lexend (display) + Atkinson Hyperlegible (body).
import "@fontsource-variable/lexend";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
// Handwritten accent used only for the signed-out welcome headline.
import "@fontsource/caveat/700.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
