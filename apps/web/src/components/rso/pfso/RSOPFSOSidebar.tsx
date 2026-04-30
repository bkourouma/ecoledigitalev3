"use client";

import React from 'react';
import {
  BarChart3,
  Activity,
  LogOut,
  X,
  ShieldCheck,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { rsoLogout } from '@/lib/rso/auth';

interface RSOPFSOSidebarProps {
  onCloseMobileMenu?: () => void;
}

const pfsoMenuItems = [
  {
    icon: BarChart3,
    label: 'Consultation',
    href: '/rso/pfso/consultation',
  },
  {
    icon: Activity,
    label: 'Mes Activités',
    href: '/rso/pfso/activites',
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
  const isActive = pathname === href || pathname.startsWith(href + '/');

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

export function RSOPFSOSidebar({ onCloseMobileMenu }: RSOPFSOSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

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
            <ShieldCheck className="w-5 h-5 text-white" />
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
          {pfsoMenuItems.map((item) => {
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

