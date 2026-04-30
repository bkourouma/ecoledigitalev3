"use client";

import { Suspense } from "react";
import { CatalogueSessionsPro } from "@/components/sessions-pro/CatalogueSessionsPro";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Calendar } from "lucide-react";

function SessionsContent() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-3">
                <Calendar className="h-6 w-6 text-primary" aria-hidden="true" />
              </div>
              <div>
                <CardTitle className="text-2xl">Catalogue des Sessions</CardTitle>
                <CardDescription>
                  Découvrez nos sessions de formation disponibles et leurs disponibilités en temps réel
                </CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>
      </div>

      {/* Sessions Catalog Component with Error Boundary */}
      <ErrorBoundary>
        <CatalogueSessionsPro />
      </ErrorBoundary>
    </div>
  );
}

export default function SessionsPage() {
  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-8">Chargement...</div>}>
      <SessionsContent />
    </Suspense>
  );
}

