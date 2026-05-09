import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
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
import CapabilityPromotion from "./pages/CapabilityPromotion";
import Status from "./pages/Status";
import ApprovalDetail from "./pages/ApprovalDetail";
import Roadmap from "./pages/Roadmap";
import RiskDashboard from "./pages/RiskDashboard";
import ApprovalPack from "./pages/ApprovalPack";
import Jobs from "./pages/Jobs";
import Runbook from "./pages/Runbook";
import Runbooks from "./pages/Runbooks";
import Memory from "./pages/Memory";
import Notebook from "./pages/Notebook";
import Lessons from "./pages/Lessons";
import Transcripts from "./pages/Transcripts";
import MasterPlan from "./pages/MasterPlan";
import Copilot from "./pages/Copilot";
import CopilotAgents from "./pages/CopilotAgents";
import CopilotProfile from "./pages/CopilotProfile";
import NightShifts from "./pages/NightShifts";
import OvernightOverview from "./pages/OvernightOverview";
import AiUsage from "./pages/AiUsage";
import PromotionAudits from "./pages/PromotionAudits";
import AdminCronHealth from "./pages/AdminCronHealth";
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
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/tenants" element={<Tenants />} />
            <Route path="/tenants/:id" element={<TenantDetail />} />
            <Route path="/capabilities" element={<Capabilities />} />
            <Route path="/capabilities/:id" element={<CapabilityDetail />} />
            <Route path="/events" element={<Events />} />
            <Route path="/api-logs" element={<ApiLogs />} />
            <Route path="/control-plane" element={<ControlPlane />} />
            <Route path="/roadmap" element={<Roadmap />} />
            <Route path="/roadmap/risks" element={<RiskDashboard />} />
            <Route path="/roadmap/approval-pack" element={<ApprovalPack />} />
            <Route path="/jobs" element={<Jobs />} />
            <Route path="/night-shifts" element={<NightShifts />} />
            <Route path="/overnight" element={<OvernightOverview />} />
            <Route path="/ai-usage" element={<AiUsage />} />
            <Route path="/runbook" element={<Runbook />} />
            <Route path="/memory" element={<Memory />} />
            <Route path="/notebook" element={<Notebook />} />
            <Route path="/master-plan" element={<MasterPlan />} />
            <Route path="/copilot" element={<Copilot />} />
            <Route path="/copilot/agents" element={<CopilotAgents />} />
            <Route path="/copilot/profile" element={<CopilotProfile />} />
            <Route path="/copilot/lessons" element={<Lessons />} />
            <Route path="/copilot/transcripts" element={<Transcripts />} />
            <Route path="/api-explorer" element={<ApiExplorer />} />
            <Route path="/db-explorer" element={<DbExplorer />} />
            <Route path="/db-audit" element={<DbAuditLogs />} />
            <Route path="/runbooks" element={<Runbooks />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/admin/capability-promotion" element={<CapabilityPromotion />} />
            <Route path="/admin/promotion-audits" element={<PromotionAudits />} />
            <Route path="/admin/cron-health" element={<AdminCronHealth />} />
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
