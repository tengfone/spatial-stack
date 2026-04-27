import { Crosshair, LayoutDashboard, Network } from "lucide-react";
import { NavLink } from "react-router-dom";

import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Workspace", icon: LayoutDashboard },
  { to: "/architecture", label: "Architecture", icon: Network },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="z-10 flex h-12 shrink-0 items-center border-b border-border bg-surface px-4">
        <div className="flex items-center gap-4">
          <NavLink to="/" className="flex items-center gap-1.5">
            <Crosshair className="h-3.5 w-3.5 text-primary" strokeWidth={2.5} />
            <span className="text-[0.8125rem] font-semibold tracking-[-0.011em] text-foreground">
              Spatial Stack
            </span>
          </NavLink>
          <span className="h-4 w-px bg-border" />
          <nav className="flex items-center gap-0.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground",
                      isActive && "bg-secondary text-foreground",
                    )
                  }
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
