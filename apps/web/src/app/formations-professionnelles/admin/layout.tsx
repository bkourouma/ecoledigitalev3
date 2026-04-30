"use client";

// This layout is now empty - the main AppLayout will handle the sidebar
// We keep this file to maintain the route structure but don't render a separate layout
export default function AdminFormationsProLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Just render children - the main AppLayout will wrap this with the Sidebar
  return <>{children}</>;
}

