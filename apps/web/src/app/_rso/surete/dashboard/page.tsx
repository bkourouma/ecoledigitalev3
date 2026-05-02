"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Loader2 } from "lucide-react";
import { getRSOToken, getRSOUserFromToken } from "@/lib/rso/auth";

export default function RSOSureteDashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if RSO token exists, redirect to login if not
    const token = getRSOToken();
    if (!token) {
      router.push("/login");
      return;
    }

    // Check if user is agent_surete
    const userInfo = getRSOUserFromToken();
    if (userInfo && userInfo.role !== 'agent_surete') {
      router.push("/login");
      return;
    }

    setLoading(false);
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Dashboard Agent de Sûreté</h1>
        <p className="text-muted-foreground mt-2">
          Tableau de bord agent de sûreté portuaire
        </p>
      </div>

    </div>
  );
}

