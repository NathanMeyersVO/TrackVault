import React from "react";

import ReactDOM from "react-dom/client";

import App from "./App";

import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { AppearanceProvider } from "./hooks/useAppearance";

import "./index.css";



ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(

  <React.StrictMode>

    <AppearanceProvider>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </AppearanceProvider>

  </React.StrictMode>,

);

