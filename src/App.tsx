import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Tenants from "./pages/Tenants";
import TenantDetail from "./pages/TenantDetail";
import Capabilities from "./pages/Capabilities";
import Events from "./pages/Events";
import ApiLogs from "./pages/ApiLogs";
import ControlPlane from "./pages/ControlPlane";
import CapabilityDetail from "./pages/CapabilityDetail";
import ApiExplorer from "./pages/ApiExplorer";
import Admin from "./pages/Admin";
import Status from "./pages/Status";
import NotFound from "./pages/NotFound";
import RequireAuth from "./components/RequireAuth";
import OperatorLayout from "./components/OperatorLayout";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/auth" element={<Auth />} />
          <Route element={<RequireAuth><OperatorLayout /></RequireAuth>}>
            <Route path="/tenants" element={<Tenants />} />
            <Route path="/tenants/:id" element={<TenantDetail />} />
            <Route path="/capabilities" element={<Capabilities />} />
            <Route path="/capabilities/:id" element={<CapabilityDetail />} />
            <Route path="/events" element={<Events />} />
            <Route path="/api-logs" element={<ApiLogs />} />
            <Route path="/control-plane" element={<ControlPlane />} />
            <Route path="/api-explorer" element={<ApiExplorer />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/status" element={<Status />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
