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
import DbExplorer from "./pages/DbExplorer";
import DbAuditLogs from "./pages/DbAuditLogs";
import Admin from "./pages/Admin";
import Status from "./pages/Status";
import ApprovalDetail from "./pages/ApprovalDetail";
import Roadmap from "./pages/Roadmap";
import Runbook from "./pages/Runbook";
import Runbooks from "./pages/Runbooks";
import Memory from "./pages/Memory";
import Notebook from "./pages/Notebook";
import MasterPlan from "./pages/MasterPlan";
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
            <Route path="/roadmap" element={<Roadmap />} />
            <Route path="/runbook" element={<Runbook />} />
            <Route path="/memory" element={<Memory />} />
            <Route path="/notebook" element={<Notebook />} />
            <Route path="/master-plan" element={<MasterPlan />} />
            <Route path="/api-explorer" element={<ApiExplorer />} />
            <Route path="/db-explorer" element={<DbExplorer />} />
            <Route path="/runbooks" element={<Runbooks />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/status" element={<Status />} />
            <Route path="/approvals/:id" element={<ApprovalDetail />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
