"use client";

import React, { useState } from 'react';
import {
  BarChart3,
  Users,
  Activity,
  Building,
  AlertTriangle,
  LogOut,
  ChevronDown,
  ChevronRight,
  X,
  Shield,
  FileText,
  Key,
  Calendar,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { rsoLogout } from '@/lib/rso/auth';

interface RSOSidebarProps {
  onCloseMobileMenu?: () => void;
}

const rsoMenuItems = [
  {
    icon: BarChart3,
    label: 'Tableau de Bord',
    href: '/rso/admin/dashboard',
  },
];

const rsoAdminMenuItems = [
  {
    icon: Users,
    label: 'Gestion Utilisateurs',
    href: '/rso/admin/users',
  },
  {
    icon: Activity,
    label: 'Gestion Activités',
    href: '/rso/admin/activities',
  },
  {
    icon: Building,
    label: 'Gestion Installations',
    href: '/rso/admin/installations',
  },
  {
    icon: BarChart3,
    label: 'Statistiques Installations',
    href: '/rso/admin/installations/dashboard',
  },
  {
    icon: Calendar,
    label: 'Gestion des Années',
    href: '/rso/admin/annees',
  },
  {
    icon: FileText,
    label: 'Journaux d\'Activité',
    href: '/rso/admin/activity-logs',
  },
  {
    icon: Key,
    label: 'Permissions',
    href: '/rso/admin/permissions',
  },
];

const NavLink = ({
  href,
  children,
  onCloseMobileMenu,
  className,
}: {
  href: string;
  children: React.ReactNode;
  onCloseMobileMenu?: () => void;
  className?: string;
}) => {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      onClick={onCloseMobileMenu}
      className={className}
    >
      {children}
    </Link>
  );
};

export function RSOSidebar({ onCloseMobileMenu }: RSOSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isAdminExpanded, setIsAdminExpanded] = useState(
    pathname.startsWith('/rso/admin') && 
    pathname !== '/rso/admin/dashboard' ||
    pathname.startsWith('/rso/admin/activity-logs') ||
    pathname.startsWith('/rso/admin/permissions') ||
    pathname.startsWith('/rso/admin/annees') ||
    pathname.startsWith('/rso/admin/installations/dashboard')
  );

  const handleLogout = async () => {
    try {
      await rsoLogout();
      // rsoLogout already redirects to /login
    } catch (error) {
      console.error('Logout error:', error);
      router.push('/login');
    }
  };

  return (
    <div className="h-full bg-gray-900 flex flex-col">
      <div className="h-12 flex items-center justify-between px-4 border-b border-gray-700">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <span className="text-white font-normal text-xs tracking-wide">RSO-PFSO</span>
        </div>
        {/* Mobile close button */}
        {onCloseMobileMenu && (
          <button
            onClick={onCloseMobileMenu}
            className="md:hidden p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded-md transition-colors"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <div className="flex-1 py-4 overflow-y-auto">
        <nav className="space-y-1 px-2">
          {/* Main Navigation */}
          {rsoMenuItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <NavLink
                key={item.href}
                href={item.href}
                onCloseMobileMenu={onCloseMobileMenu}
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}

          {/* Administration Section */}
          <div className="pt-2">
            <button
              onClick={() => setIsAdminExpanded(!isAdminExpanded)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${
                isAdminExpanded
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <div className="flex items-center space-x-3">
                <Shield className="w-5 h-5" />
                <span>Administration</span>
              </div>
              {isAdminExpanded ? (
                <ChevronDown className="w-5 h-5" />
              ) : (
                <ChevronRight className="w-5 h-5" />
              )}
            </button>

            {isAdminExpanded && (
              <div className="ml-4 mt-1 space-y-1">
                {rsoAdminMenuItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href || pathname.startsWith(item.href + '/');

                  return (
                    <NavLink
                      key={item.href}
                      href={item.href}
                      onCloseMobileMenu={onCloseMobileMenu}
                      className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal transition-colors ${
                        isActive
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>
        </nav>
      </div>

      {/* Logout Button */}
      <div className="p-4 border-t border-gray-700">
        <button
          onClick={handleLogout}
          className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-[16px] font-normal text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
        >
          <LogOut className="w-5 h-5" />
          <span>Déconnexion</span>
        </button>
      </div>
    </div>
  );
}


