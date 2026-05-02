"use client";

/**
 * RSO Test Page
 * Temporary page for testing RSO functionality without full authentication
 * This page will be removed once User Story 2 (Authentication) is complete
 */

import { useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { listRSOUsers, createRSOUser, RSOUser } from "@/lib/rso/users";
import { CreateUserForm } from "@/components/rso/admin/CreateUserForm";

export default function RSOTestPage() {
  const [users, setUsers] = useState<RSOUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const handleTestAPI = async () => {
    setLoading(true);
    setError(null);
    try {
      // Note: This will fail without authentication token
      // For now, we'll just show the error to guide the user
      const response = await listRSOUsers({ limit: 20 });
      setUsers(response.users);
    } catch (err: any) {
      setError(err.message || "Erreur lors du test de l'API");
      console.error("API Error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto py-8 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Page de Test RSO-PFSO</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <h3 className="font-semibold text-yellow-800 mb-2">⚠️ Page de Test Temporaire</h3>
            <p className="text-sm text-yellow-700">
              Cette page est destinée aux tests avant l'implémentation complète de l'authentification.
              Pour tester les fonctionnalités complètes, vous devez :
            </p>
            <ol className="list-decimal list-inside text-sm text-yellow-700 mt-2 space-y-1">
              <li>Créer un utilisateur admin via le script de seed</li>
              <li>Implémenter la User Story 2 (Authentification)</li>
              <li>Vous connecter avec les identifiants admin</li>
              <li>Accéder au dashboard admin via /rso/admin/dashboard</li>
            </ol>
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold">Étapes pour tester :</h3>
            <div className="bg-gray-50 p-4 rounded-lg space-y-2">
              <p className="text-sm">
                <strong>1. Créer un admin RSO :</strong>
              </p>
              <code className="block bg-gray-800 text-green-400 p-2 rounded text-xs">
                pnpm seed:rso-admin
              </code>

              <p className="text-sm mt-4">
                <strong>2. Tester l'API directement (avec token) :</strong>
              </p>
              <p className="text-xs text-gray-600">
                Utilisez Postman ou Thunder Client avec le token JWT RSO
              </p>

              <p className="text-sm mt-4">
                <strong>3. Accéder aux pages admin :</strong>
              </p>
              <ul className="text-xs text-gray-600 list-disc list-inside space-y-1">
                <li>Dashboard: <code className="bg-gray-200 px-1 rounded">/rso/admin/dashboard</code></li>
                <li>Gestion utilisateurs: <code className="bg-gray-200 px-1 rounded">/rso/admin/users</code></li>
              </ul>
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleTestAPI} disabled={loading}>
              {loading ? "Test en cours..." : "Tester l'API (nécessite auth)"}
            </Button>
            <Button variant="outline" onClick={() => setCreateModalOpen(true)}>
              Ouvrir Formulaire Création (test UI)
            </Button>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-800">
                <strong>Erreur:</strong> {error}
              </p>
              <p className="text-xs text-red-600 mt-2">
                Cette erreur est normale si vous n'êtes pas authentifié. L'authentification sera
                implémentée dans la User Story 2.
              </p>
            </div>
          )}

          {users.length > 0 && (
            <div className="mt-4">
              <h4 className="font-semibold mb-2">Utilisateurs trouvés ({users.length})</h4>
              <div className="space-y-2">
                {users.map((user) => (
                  <div key={user.id} className="bg-gray-50 p-2 rounded text-sm">
                    {user.username} - {user.email} - {user.role}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateUserForm
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={() => {
          setCreateModalOpen(false);
          handleTestAPI();
        }}
      />
    </div>
  );
}

