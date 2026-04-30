import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

export function useCurrentTeacherId() {
  const { data: session } = useSession();
  const sessionUserId =
    (session?.user as { id?: string } | undefined)?.id ||
    (session as { userId?: string } | null)?.userId;
  
  return useQuery({
    queryKey: ["current-teacher-id", sessionUserId],
    queryFn: async () => {
      if (!sessionUserId) {
        throw new Error("No user ID found");
      }

      const response = await fetch(`/api/teacher/current`, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to fetch teacher");
      }

      const teacher = await response.json();
      
      return teacher?.id || null;
    },
    enabled: !!sessionUserId,
    retry: false,
  });
}
