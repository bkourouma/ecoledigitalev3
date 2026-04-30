"use client";

import { Suspense } from "react";
import { CatalogueFormationsPro } from "@/components/formations-pro/CatalogueFormationsPro";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { BookOpen } from "lucide-react";

function CatalogueContent() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-3">
                <BookOpen className="h-6 w-6 text-primary" aria-hidden="true" />
              </div>
              <div>
                <CardTitle className="text-2xl">Catalogue de Formations Professionnelles</CardTitle>
                <CardDescription>
                  Découvrez nos formations professionnelles et développez vos compétences
                </CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>
      </div>

      {/* Catalog Component with Error Boundary */}
      <ErrorBoundary>
        <CatalogueFormationsPro />
      </ErrorBoundary>
    </div>
  );
}

export default function CataloguePage() {
  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-8">Chargement...</div>}>
      <CatalogueContent />
    </Suspense>
  );
}

