import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Building2,
  KanbanSquare,
  Mail,
  Sparkles,
  BarChart3,
  Shield,
  Settings,
  Search,
  LogOut,
  CalendarCheck,
  Inbox,
  FileText,
} from "lucide-react";
import { useAuth, isAdmin } from "@/lib/auth-context";
import { initials } from "@/lib/format";
import { useState } from "react";
import { NotificationsBell } from "@/components/NotificationsBell";

// Each module gets its own warm hue (bg + fg) used on hover and when active
const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, bg: "#ffe4d1", fg: "#c95c47" }, // peach
  { to: "/contacts", label: "Contacts", icon: Users, bg: "#fce5d8", fg: "#b04a2a" }, // terracotta
  { to: "/companies", label: "Companies", icon: Building2, bg: "#fde7d4", fg: "#a85a2c" }, // pumpkin
  { to: "/pipeline", label: "Pipeline", icon: KanbanSquare, bg: "#fde0e0", fg: "#b8413f" }, // coral red
  { to: "/tasks", label: "Tasks & Calendar", icon: CalendarCheck, bg: "#e6e2f0", fg: "#5a4f8a" }, // lavender
  { to: "/inbox", label: "Inbox", icon: Inbox, bg: "#dce9f0", fg: "#3a6680" }, // sky
  { to: "/documents", label: "Documents", icon: FileText, bg: "#f0e6d2", fg: "#7a5e2a" }, // parchment
  { to: "/email-sync", label: "Email Sync", icon: Mail, bg: "#fff0c8", fg: "#9a6a14" }, // honey
  { to: "/ai-writer", label: "AI Writer", icon: Sparkles, bg: "#f5e3d0", fg: "#8a5a2a" }, // caramel
  { to: "/analytics", label: "Analytics", icon: BarChart3, bg: "#dceadf", fg: "#3f6a52" }, // mint
  { to: "/reports", label: "Reports", icon: BarChart3, bg: "#e0ecdc", fg: "#4f7a4a" }, // sage
] as const;

const ADMIN_NAV = [
  { to: "/roles", label: "Roles & Access", icon: Shield, bg: "#e7e0d2", fg: "#6b5a3e" }, // sand
  { to: "/settings", label: "Settings", icon: Settings, bg: "#ece4d8", fg: "#6a553c" }, // taupe
] as const;

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  bg: string;
  fg: string;
};

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  const [hover, setHover] = useState(false);
  const tinted = active || hover;
  return (
    <Link
      to={item.to}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors"
      style={{
        backgroundColor: tinted ? item.bg : "transparent",
        color: tinted ? item.fg : "var(--color-foreground)",
      }}
    >
      {active ? (
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.fg }} />
      ) : (
        <Icon
          className="h-4 w-4"
          style={{ color: tinted ? item.fg : "var(--color-muted-foreground)" }}
        />
      )}
      <span>{item.label}</span>
    </Link>
  );
}

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, role, signOut } = useAuth();
  const [search, setSearch] = useState("");
  const adminNav = ADMIN_NAV.filter((item) => item.to !== "/roles" || isAdmin(role));

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + "/");

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Sidebar (desktop) */}
      <aside className="hidden md:flex w-[200px] shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="px-5 py-6">
          <Link to="/dashboard" className="text-xl tracking-tight" style={{ color: "#e2725b", fontWeight: 500 }}>
            CRM360
          </Link>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          {NAV.map((item) => (
            <NavLink key={item.to} item={item} active={isActive(item.to)} />
          ))}
          <div className="my-3 border-t border-border" />
          {adminNav.map((item) => (
            <NavLink key={item.to} item={item} active={isActive(item.to)} />
          ))}
        </nav>
        <div className="px-3 py-4">
          <button
            onClick={async () => {
              await signOut();
              navigate({ to: "/login" });
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex items-center gap-3 border-b border-border bg-card px-4 md:px-8 py-3">
          <div className="md:hidden text-lg" style={{ color: "#e2725b", fontWeight: 500 }}>
            CRM360
          </div>
          <div className="flex-1 max-w-md">
            <div className="flex items-center gap-2 rounded-full bg-search-bg px-4 py-2 border border-transparent focus-within:border-secondary">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search contacts, deals, companies..."
                className="bg-transparent flex-1 outline-none text-sm placeholder:text-muted-foreground"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <NotificationsBell />
            <div className="hidden sm:block text-right">
              <div className="text-sm" style={{ fontWeight: 500 }}>{profile?.display_name ?? "—"}</div>
              <div className="text-xs text-muted-foreground">{profile?.email}</div>
            </div>
            <div className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center text-sm text-foreground" style={{ fontWeight: 500 }}>
              {initials(profile?.display_name ?? "U")}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-8 pb-24 md:pb-8">
          <Outlet />
        </main>

        {/* Mobile bottom nav */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border flex justify-around px-2 py-2 z-40">
          {NAV.slice(0, 5).map((item) => {
            const active = isActive(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className="flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-colors"
                style={{
                  backgroundColor: active ? item.bg : "transparent",
                  color: active ? item.fg : "var(--color-muted-foreground)",
                }}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px]">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
