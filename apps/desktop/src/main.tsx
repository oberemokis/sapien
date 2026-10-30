import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/app";
import "./styles.css";

const container = document.getElementById("app");

if (container === null) {
  throw new Error("В index.html нет #app");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
