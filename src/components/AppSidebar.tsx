import { useMemo } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem,
  SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Building2, Boxes, Activity, ScrollText, Settings2, Map as MapIcon, BookOpen, Brain,
  Notebook as NotebookIcon, Code2, Shield, Heart, Database, Library, ShieldAlert,
  Mic, UserCircle2, GraduationCap, MessageSquareText, FileCheck2, ListChecks, Moon,
  FileSearch, Users, ChevronRight, Star, LayoutDashboard, Sparkles, Target, Bot,
} from "lucide-react";
import {
  DOT_CLASSES, DOT_LABELS, getCopilotLastChild, rememberCopilotChild,
  useCopilotOpen, useFavorites, useStatusDots,
} from "@/lib/sidebar-state";

type NavItem = {
  url: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
};

const operateTopItems: NavItem[] = [
  { url: "/dashboard", title: "Dashboard", icon: LayoutDashboard },
  { url: "/tenants", title: "Tenants", icon: Building2 },
  { url: "/capabilities", title: "Capabilities", icon: Boxes },
  { url: "/events", title: "Events", icon: Activity },
  { url: "/api-logs", title: "API logs", icon: ScrollText },
  { url: "/control-plane", title: "Control plane", icon: Settings2 },
];

const copilotParent = { url: "/copilot", title: "Copilot", icon: Mic };
const copilotChildren: NavItem[] = [
  { url: "/copilot/agents", title: "Agents", icon: Users },
  { url: "/copilot/profile", title: "Profile", icon: UserCircle2 },
  { url: "/copilot/lessons", title: "Lessons", icon: GraduationCap },
  { url: "/copilot/transcripts", title: "Transcripts", icon: MessageSquareText },
];

const planItems: NavItem[] = [
  { url: "/companion", title: "Companion (local LLM)", icon: Bot },
  { url: "/plan", title: "Plan (workstreams)", icon: Target },
  { url: "/morning-review", title: "Morning Review", icon: Sparkles },
  { url: "/admin/lessons", title: "Lessons Loop", icon: GraduationCap },
  { url: "/roadmap", title: "Roadmap", icon: MapIcon },
  { url: "/roadmap/risks", title: "Risk dashboard", icon: ShieldAlert },
  { url: "/roadmap/approval-pack", title: "Approval pack", icon: FileCheck2 },
  { url: "/jobs", title: "Jobs board", icon: ListChecks },
  { url: "/overnight", title: "Overnight overview", icon: Activity },
  { url: "/night-shifts", title: "Night shifts", icon: Moon },
  { url: "/ai-usage", title: "AI usage & cost", icon: Sparkles },
  { url: "/notebook", title: "Notebook", icon: NotebookIcon },
  { url: "/runbook", title: "Runbook", icon: BookOpen },
  { url: "/memory", title: "Memory", icon: Brain },
];

const systemItems: NavItem[] = [
  { url: "/api-explorer", title: "API explorer", icon: Code2 },
  { url: "/db-explorer", title: "DB explorer", icon: Database },
  { url: "/db-audit", title: "DB audit log", icon: ShieldAlert },
  { url: "/runbooks", title: "Runbooks", icon: Library },
  { url: "/admin", title: "Admin", icon: Shield },
  { url: "/admin/capability-promotion", title: "Capability promotion", icon: Boxes },
  { url: "/admin/promotion-audits", title: "Promotion audits", icon: FileSearch },
  { url: "/admin/cron-health", title: "Cron health", icon: Activity },
  { url: "/admin/logs", title: "Logs", icon: ScrollText },
  { url: "/status", title: "Status", icon: Heart },
];

const allItems: NavItem[] = [
  ...operateTopItems,
  copilotParent,
  ...copilotChildren,
  ...planItems,
  ...systemItems,
];

function StatusDot({ color, label }: { color?: string; label?: string }) {
  if (!color) return null;
  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full ${color}`}
      aria-label={label}
      title={label}
    />
  );
}

export const AppSidebar = ({ collapsible = "icon" }: { collapsible?: "icon" | "offcanvas" | "none" }) => {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { favorites, isFavorite, toggleFavorite } = useFavorites();
  const dots = useStatusDots();

  const isActive = (p: string) => pathname === p || pathname.startsWith(p + "/");
  const isInCopilot = pathname.startsWith("/copilot");
  const [copilotOpen, setCopilotOpen] = useCopilotOpen(isInCopilot);

  const itemsByUrl = useMemo(() => {
    const m = new Map<string, NavItem>();
    for (const it of allItems) m.set(it.url, it);
    return m;
  }, []);

  const favoriteItems = favorites
    .map((u) => itemsByUrl.get(u))
    .filter((x): x is NavItem => Boolean(x));

  const renderRow = (it: NavItem, opts?: { showPin?: boolean; inFavorites?: boolean }) => {
    const active = isActive(it.url);
    const dot = dots[it.url];
    const pinned = isFavorite(it.url);
    return (
      <SidebarMenuItem key={(opts?.inFavorites ? "fav-" : "") + it.url} className="group/row">
        <SidebarMenuButton
          asChild
          isActive={active}
          className={active ? "border-l-2 border-sidebar-primary" : ""}
        >
          <NavLink to={it.url} className="flex items-center gap-2">
            <it.icon className={`h-4 w-4 ${active ? "text-sidebar-primary" : "text-sidebar-foreground/70"}`} />
            {!collapsed && <span className="flex-1 truncate">{it.title}</span>}
            {!collapsed && dot && <StatusDot color={DOT_CLASSES[dot]} label={`${it.title}: ${DOT_LABELS[dot]}`} />}
          </NavLink>
        </SidebarMenuButton>
        {!collapsed && opts?.showPin && (opts?.inFavorites || !pinned) && (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <SidebarMenuAction
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleFavorite(it.url);
                  }}
                  className={opts?.inFavorites ? "opacity-100" : "opacity-0 group-hover/row:opacity-100 focus:opacity-100"}
                  aria-label={opts?.inFavorites ? `Remove ${it.title} from Favorites` : `Add ${it.title} to Favorites`}
                >
                  <Star className={`h-3.5 w-3.5 ${opts?.inFavorites ? "fill-sidebar-primary text-sidebar-primary" : ""}`} />
                </SidebarMenuAction>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                {opts?.inFavorites ? "Remove from Favorites" : "Add to Favorites"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </SidebarMenuItem>
    );
  };

  const renderCopilotGroup = () => {
    const childActive = copilotChildren.some((c) => isActive(c.url));
    const parentActive = isActive(copilotParent.url) && !childActive;
    const showAsActiveAncestor = childActive && !collapsed;

    return (
      <SidebarMenuItem className="group/row">
        <SidebarMenuButton
          isActive={parentActive}
          className={`${parentActive ? "border-l-2 border-sidebar-primary" : ""} ${
            showAsActiveAncestor ? "border-l-2 border-sidebar-primary/40" : ""
          }`}
          onClick={() => {
            const target = childActive
              ? copilotParent.url
              : (getCopilotLastChild() ?? copilotParent.url);
            navigate(target);
          }}
        >
          <copilotParent.icon className={`h-4 w-4 ${parentActive || childActive ? "text-sidebar-primary" : "text-sidebar-foreground/70"}`} />
          {!collapsed && <span className="flex-1 truncate">{copilotParent.title}</span>}
        </SidebarMenuButton>
        {!collapsed && (
          <SidebarMenuAction
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setCopilotOpen(!copilotOpen);
            }}
            aria-label={copilotOpen ? "Collapse Copilot" : "Expand Copilot"}
            aria-expanded={copilotOpen}
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${copilotOpen ? "rotate-90" : ""}`} />
          </SidebarMenuAction>
        )}
        {!collapsed && copilotOpen && (
          <SidebarMenuSub>
            {copilotChildren.map((c) => {
              const active = isActive(c.url);
              const dot = dots[c.url];
              const pinned = isFavorite(c.url);
              return (
                <SidebarMenuSubItem key={c.url} className="group/subrow">
                  <SidebarMenuSubButton
                    asChild
                    isActive={active}
                    className={active ? "border-l-2 border-sidebar-primary" : ""}
                  >
                    <NavLink
                      to={c.url}
                      onClick={() => rememberCopilotChild(c.url)}
                      className="flex items-center gap-2"
                    >
                      <c.icon className={`h-4 w-4 ${active ? "text-sidebar-primary" : "text-sidebar-foreground/70"}`} />
                      <span className="flex-1 truncate">{c.title}</span>
                      {dot && <StatusDot color={DOT_CLASSES[dot]} label={`${c.title}: ${DOT_LABELS[dot]}`} />}
                    </NavLink>
                  </SidebarMenuSubButton>
                  {!pinned && (
                    <TooltipProvider delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleFavorite(c.url);
                            }}
                            className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded text-sidebar-foreground/60 opacity-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-hover/subrow:opacity-100 focus:opacity-100"
                            aria-label={`Add ${c.title} to Favorites`}
                          >
                            <Star className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="text-xs">
                          Add to Favorites
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        )}
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible={collapsible}>
      <SidebarContent>
        {favoriteItems.length > 0 && (
          <SidebarGroup>
            {!collapsed && <SidebarGroupLabel>Favorites</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {favoriteItems.map((it) => renderRow(it, { showPin: true, inFavorites: true }))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel>Operate</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {operateTopItems.map((it) => renderRow(it, { showPin: true }))}
              {renderCopilotGroup()}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel>Plan</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {planItems.map((it) => renderRow(it, { showPin: true }))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel>System</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {systemItems.map((it) => renderRow(it, { showPin: true }))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
};

export default AppSidebar;
