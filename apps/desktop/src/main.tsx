import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, restoreDevice } from "@/app/app";
import { fakeRustInBrowser } from "@/core/rust/browser";
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";

const container = document.getElementById("app");

if (container === null) {
  throw new Error("В index.html нет #app");
}

// Подделка Rust встаёт до первого запроса окна.
void fakeRustInBrowser().then(() => {
  restoreDevice();
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
