import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, restoreDevice } from "@/app/app";
import { loadAppStorage } from "@/core/storage/app-storage";
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";

const container = document.getElementById("app");

if (container === null) {
  throw new Error("В index.html нет #app");
}

// Кеши из Rust приходят до первой отрисовки: иначе лента и плашки задач
// мигнули бы пустыми. Это один короткий вызов, и он не падает.
void loadAppStorage().then(() => {
  restoreDevice();
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
