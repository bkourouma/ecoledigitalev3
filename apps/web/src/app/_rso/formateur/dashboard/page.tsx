"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Loader2 } from "lucide-react";
import { getRSOToken, getRSOUserFromToken } from "@/lib/rso/auth";
import { listRSOUsers, RSOUser } from "@/lib/rso/users";

export default function RSOFormateurDashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalPFSOAgents: 0,
    activePFSOAgents: 0,
  });

  useEffect(() => {
    // Check if RSO token exists, redirect to login if not
    const token = getRSOToken();
    if (!token) {
      router.push("/login");
      return;
    }

    // Check if user is formateur
    const userInfo = getRSOUserFromToken();
    if (userInfo && userInfo.role !== 'rso_formateur') {
      router.push("/login");
      return;
    }

    loadDashboardData();
  }, [router]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      
      // Load PFSO agents only
      const response = await listRSOUsers({
        role: 'agent_pfso',
        page: 1,
        limit: 1000, // Get all for stats
      });

      const totalPFSOAgents = response.users.length;
      const activePFSOAgents = response.users.filter(u => u.statut === 'actif').length;

      setStats({
        totalPFSOAgents,
        activePFSOAgents,
      });
    } catch (error: any) {
      console.error("[RSO Formateur Dashboard] Error loading dashboard data:", error);
      
      if (
        error.message?.includes("Non authentifié") || 
        error.message?.includes("Authentication") ||
        error.message?.includes("401") ||
        error.message?.includes("Unauthorized")
      ) {
        router.push("/login");
      }
    } finally {
      setLoading(false);
    }
  };

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
        <h1 className="text-3xl font-bold">Dashboard Formateur RSO</h1>
        <p className="text-muted-foreground mt-2">
          Vue d'ensemble de vos agents PFSO
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Agents PFSO</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.totalPFSOAgents}</div>
            <p className="text-sm text-muted-foreground">Total des agents PFSO créés</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Agents Actifs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{stats.activePFSOAgents}</div>
            <p className="text-sm text-muted-foreground">Agents PFSO actifs</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Actions Rapides</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <button
            onClick={() => router.push("/rso/formateur/users")}
            className="w-full text-left p-3 rounded-lg border hover:bg-accent transition-colors"
          >
            <div className="font-medium">Gérer les Agents PFSO</div>
            <div className="text-sm text-muted-foreground">Créer et gérer les comptes agents PFSO</div>
          </button>
          <button
            onClick={() => router.push("/rso/formateur/activities")}
            className="w-full text-left p-3 rounded-lg border hover:bg-accent transition-colors"
          >
            <div className="font-medium">Gérer les Activités</div>
            <div className="text-sm text-muted-foreground">Créer et gérer les activités de sûreté portuaire</div>
          </button>
        </CardContent>
      </Card>
    </div>
  );
}

