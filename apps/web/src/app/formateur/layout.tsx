export default function FormateurLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Use the global AppLayout + Sidebar for visual consistency with admin areas.
  return <>{children}</>;
}
