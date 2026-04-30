"use client";

import React, { useState } from 'react';
import { RSOFormateurSidebar } from './RSOFormateurSidebar';
import { RSOHeader } from '../admin/RSOHeader';

interface RSOFormateurLayoutProps {
  children: React.ReactNode;
}

export function RSOFormateurLayout({ children }: RSOFormateurLayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  return (
    <div className="h-full w-full overflow-hidden bg-background">
      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
          onClick={closeMobileMenu}
        />
      )}

      {/* Left Sidebar - Fixed width on desktop, overlay on mobile */}
      <div
        className={`
          fixed md:fixed
          top-0 left-0
          w-72 h-full
          flex-shrink-0
          z-50 md:z-auto
          transform transition-transform duration-300 ease-in-out
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        <RSOFormateurSidebar onCloseMobileMenu={closeMobileMenu} />
      </div>

      {/* Main Content Area */}
      <div className="h-full flex flex-col overflow-hidden md:ml-72 max-w-full">
        {/* Header */}
        <div className="h-12 flex-shrink-0 overflow-x-hidden">
          <RSOHeader onToggleMobileMenu={toggleMobileMenu} isMobileMenuOpen={isMobileMenuOpen} />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-8 py-6 min-w-0">
          {children}
        </div>
      </div>
    </div>
  );
}

