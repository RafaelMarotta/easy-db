import React from "react";
import { createRoot } from "react-dom/client";
import { VariablesPage } from "./pages/VariablesPage";

const container = document.getElementById("root")!;
createRoot(container).render(
  <React.StrictMode>
    <VariablesPage />
  </React.StrictMode>
);


