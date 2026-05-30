import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installFrontendErrorCapture } from "./lib/frontend-error-capture";
import { BrandingProvider } from "./lib/branding/BrandingProvider";

installFrontendErrorCapture();

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <BrandingProvider>
      <App />
    </BrandingProvider>
  </ErrorBoundary>
);
