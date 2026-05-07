import { NavLink, useLocation } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import {
  Building2, Boxes, Activity, ScrollText, Settings2, Map, BookOpen, Brain,
  Notebook as NotebookIcon, Code2, Shield, Heart, Database, Library,
} from "lucide-react";

const groups = [
  {
    label: "Operate",
    items: [
      { url: "/tenants", title: "Tenants", icon: Building2 },
      { url: "/capabilities", title: "Capabilities", icon: Boxes },
      { url: "/events", title: "Events", icon: Activity },
      { url: "/api-logs", title: "API logs", icon: ScrollText },
      { url: "/control-plane", title: "Control plane", icon: Settings2 },
    ],
  },
  {
    label: "Plan",
    items: [
      { url: "/roadmap", title: "Roadmap", icon: Map },
      { url: "/notebook", title: "Notebook", icon: NotebookIcon },
      { url: "/runbook", title: "Runbook", icon: BookOpen },
      { url: "/memory", title: "Memory", icon: Brain },
    ],
  },
  {
    label: "System",
    items: [
      { url: "/api-explorer", title: "API explorer", icon: Code2 },
      { url: "/db-explorer", title: "DB explorer", icon: Database },
      { url: "/runbooks", title: "Runbooks", icon: Library },
      { url: "/admin", title: "Admin", icon: Shield },
      { url: "/status", title: "Status", icon: Heart },
    ],
  },
];

export const AppSidebar = () => {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const isActive = (p: string) => pathname === p || pathname.startsWith(p + "/");
  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        {groups.map((g) => (
          <SidebarGroup key={g.label}>
            {!collapsed && <SidebarGroupLabel>{g.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((it) => (
                  <SidebarMenuItem key={it.url}>
                    <SidebarMenuButton asChild isActive={isActive(it.url)}>
                      <NavLink to={it.url} className="flex items-center gap-2">
                        <it.icon className="h-4 w-4" />
                        {!collapsed && <span>{it.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
};

export default AppSidebar;
