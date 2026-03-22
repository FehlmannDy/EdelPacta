// Polyfill crypto.randomUUID for non-secure contexts (HTTP)
if (typeof crypto.randomUUID !== "function") {
  crypto.randomUUID = () =>
    "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => {
      const n = parseInt(c);
      return (n ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (n / 4)))).toString(16);
    }) as `${string}-${string}-${string}-${string}-${string}`;
}

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ToastProvider } from "@shared/context/ToastContext";
import { ToastContainer } from "@shared/components/Toast";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <App />
      <ToastContainer />
    </ToastProvider>
  </StrictMode>
);
