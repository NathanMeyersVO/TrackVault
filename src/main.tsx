import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppearanceProvider } from "./hooks/useAppearance";
import { ApplicationProvider } from "./hooks/useApplication";
import { DemoPrivacyProvider } from "./hooks/useDemoPrivacy";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppearanceProvider>
      <DemoPrivacyProvider>
        <ApplicationProvider>
          <App />
        </ApplicationProvider>
      </DemoPrivacyProvider>
    </AppearanceProvider>
  </React.StrictMode>,
);
