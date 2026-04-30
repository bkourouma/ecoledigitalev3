"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { MesInscriptionsPro } from "@/components/inscriptions-pro/MesInscriptionsPro";
import { InscriptionFilters } from "@/components/inscriptions-pro/InscriptionFilters";
import { EnrollmentHistoryQuerySchema } from "@ecoledigitale/contracts/src/inscriptions-pro";
import { z } from "zod";

export default function MesInscriptionsPage() {
  const [filters, setFilters] = useState<z.infer<typeof EnrollmentHistoryQuerySchema>>({
    page: 1,
    limit: 10,
  });

  const handleFiltersChange = (newFilters: Partial<z.infer<typeof EnrollmentHistoryQuerySchema>>) => {
    setFilters((prev) => ({ ...prev, ...newFilters, page: 1 })); // Reset to page 1 when filters change
  };

  const handlePageChange = (page: number) => {
    setFilters((prev) => ({ ...prev, page }));
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Mes inscriptions</h1>
        <p className="text-muted-foreground">
          Consultez l'historique de vos inscriptions aux formations professionnelles
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1">
          <InscriptionFilters filters={filters} onFiltersChange={handleFiltersChange} />
        </div>

        <div className="lg:col-span-3">
          <MesInscriptionsPro filters={filters} onPageChange={handlePageChange} />
        </div>
      </div>
    </div>
  );
}

