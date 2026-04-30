"use client";

import React from 'react';
import { Search, Menu, X } from 'lucide-react';
import { NotificationWidget } from '@/components/rso/notifications/NotificationWidget';

interface RSOHeaderProps {
  onToggleMobileMenu: () => void;
  isMobileMenuOpen: boolean;
}

export function RSOHeader({ onToggleMobileMenu, isMobileMenuOpen }: RSOHeaderProps) {

  return (
    <div className="h-full bg-gray-700 border-b border-gray-600 flex items-center px-4 gap-4">
      {/* Mobile Menu Button */}
      <button
        onClick={onToggleMobileMenu}
        className="md:hidden p-2 text-gray-300 hover:text-white hover:bg-gray-600 rounded-md transition-colors"
        aria-label="Toggle menu"
      >
        {isMobileMenuOpen ? (
          <X className="h-5 w-5" />
        ) : (
          <Menu className="h-5 w-5" />
        )}
      </button>

      {/* Search Bar */}
      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher..."
            className="w-full bg-gray-800 border border-gray-600 rounded-md pl-10 pr-4 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Notifications Widget */}
      <div className="flex items-center gap-2">
        <NotificationWidget />
      </div>
    </div>
  );
}


