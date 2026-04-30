'use client';

import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { FileText } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useParentChildren } from '@/lib/hooks/use-parent-children';
import { useAcademicYearInfo } from '@/lib/hooks/use-parent-academic';
import { ReportCards } from '../components/documents/ReportCards';
import { PaymentReceipts } from '../components/documents/PaymentReceipts';
import { ReportCardFilter, PaymentReceiptFilter } from '@ecoledigitale/contracts';

export default function ParentDocumentsPage() {
  const { data: session, status } = useSession();

  // Redirect if not authenticated
  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div
          className="h-10 w-10 animate-spin rounded-full border-2 border-emerald-500/30 border-t-emerald-400"
          role="status"
          aria-label="Chargement"
        />
      </div>
    );
  }

  if (!session) {
    redirect('/login');
  }

  // Check if user has parent role
  const roles = (session as any)?.roles ?? [];
  const isParent = Array.isArray(roles) && roles.some((r: string) => ['parent', 'Parent'].includes(r));

  if (!isParent) {
    redirect('/');
  }

  // Fetch children list for filter
  const { data: childrenData } = useParentChildren();
  const children = childrenData?.data?.children || [];

  // Fetch academic years for filters
  const { data: academicYearData } = useAcademicYearInfo();
  const academicYears: Array<{ id: string; name: string }> =
    academicYearData?.data?.academicYears?.map((ay) => ({ id: ay.id, name: ay.name })) || [];

  // State for filters
  const [reportCardsFilters, setReportCardsFilters] = useState<ReportCardFilter>({});
  const [paymentReceiptsFilters, setPaymentReceiptsFilters] = useState<PaymentReceiptFilter>({});
  const [activeTab, setActiveTab] = useState<'report-cards' | 'payment-receipts'>('report-cards');

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/80 shadow-sm backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-500/15 p-2">
              <FileText className="h-8 w-8 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Documents</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Consultez et téléchargez les documents de vos enfants
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as 'report-cards' | 'payment-receipts')}
          className="w-full"
        >
          <TabsList className="mb-6 grid w-full grid-cols-2 gap-1 rounded-lg bg-muted/50 p-1">
            <TabsTrigger
              value="report-cards"
              className="text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              Bulletins
            </TabsTrigger>
            <TabsTrigger
              value="payment-receipts"
              className="text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              Reçus de Paiement
            </TabsTrigger>
          </TabsList>

          <TabsContent value="report-cards" className="space-y-6">
            <ReportCards
              children={children}
              academicYears={academicYears}
              filters={reportCardsFilters}
              onFiltersChange={setReportCardsFilters}
            />
          </TabsContent>

          <TabsContent value="payment-receipts" className="space-y-6">
            <PaymentReceipts
              children={children}
              academicYears={academicYears}
              filters={paymentReceiptsFilters}
              onFiltersChange={setPaymentReceiptsFilters}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
