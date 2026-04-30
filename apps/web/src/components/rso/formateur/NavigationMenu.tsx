"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Building2,
  Calendar,
  Users,
  Image,
  MessageSquare,
  BarChart3,
  User,
} from "lucide-react";

interface NavigationMenuProps {
  className?: string;
}

export function FormateurNavigationMenu({ className }: NavigationMenuProps) {
  const pathname = usePathname();

  const menuItems = [
    {
      label: "Dashboard",
      href: "/rso/formateur/dashboard",
      icon: BarChart3,
    },
    {
      label: "Installations",
      href: "/rso/formateur/installations",
      icon: Building2,
    },
    {
      label: "Activités",
      href: "/rso/formateur/activities",
      icon: Calendar,
    },
    {
      label: "Agents PFSO",
      href: "/rso/formateur/users",
      icon: Users,
    },
    {
      label: "Médias",
      href: "/rso/formateur/media",
      icon: Image,
    },
    {
      label: "SMS",
      href: "/rso/formateur/sms",
      icon: MessageSquare,
    },
    {
      label: "Statistiques",
      href: "/rso/formateur/statistics",
      icon: BarChart3,
    },
    {
      label: "Profil",
      href: "/rso/formateur/profile",
      icon: User,
    },
  ];

  return (
    <nav className={cn("space-y-1", className)}>
      {menuItems.map((item) => {
        const Icon = item.icon;
        const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
        
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent"
            )}
          >
            <Icon className="h-4 w-4" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

