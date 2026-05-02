'use client';

import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CreditCard } from 'lucide-react';
import { usePaymentHistory, useTuitionInstallments, usePaymentSchedules, useOutstandingBalances } from '@/lib/hooks/use-parent-payments';
import { useParentChildren } from '@/lib/hooks/use-parent-children';
import { PaymentHistory } from '../components/payments/PaymentHistory';
import { TuitionInstallments } from '../components/payments/TuitionInstallments';
import { PaymentSchedules } from '../components/payments/PaymentSchedules';
import { OutstandingBalances } from '../components/payments/OutstandingBalances';
import { PaymentFilter } from '@ecoledigitale/contracts';

export default function ParentPaymentsPage() {
  const { data: session, status } = useSession();
  const [filters, setFilters] = useState<PaymentFilter>({});
  const [selectedChildId, setSelectedChildId] = useState<string | undefined>(undefined);
  const [selectedFeeType, setSelectedFeeType] = useState<'tuition' | 'inscription' | 'annexes' | 'autres' | undefined>(undefined);
  const [page, setPage] = useState(1);
  const limit = 20;

  // Redirect if not authenticated
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-emerald-500"></div>
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
  const { data: childrenData, isLoading: isLoadingChildren } = useParentChildren();
  
  // Deduplicate children by id to prevent duplicate key errors
  const children = React.useMemo(() => {
    const childrenList = childrenData?.data?.children || [];
    const seenIds = new Set<string>();
    const uniqueChildren: typeof childrenList = [];
    
    childrenList.forEach((child: any, index: number) => {
      if (!seenIds.has(child.id)) {
        seenIds.add(child.id);
        uniqueChildren.push(child);
      } else {
        console.warn(`[ParentPaymentsPage] Duplicate child ID found at index ${index}:`, child.id);
      }
    });
    
    return uniqueChildren;
  }, [childrenData?.data?.children]);

  // Build children array for filter component
  const childrenForFilter = children.map((child) => ({
    id: child.id,
    name: child.name,
  }));

  // Fetch payment history
  const { data: paymentHistoryData, isLoading: isLoadingPayments, error: paymentsError } = usePaymentHistory(
    selectedChildId || filters.childId,
    filters,
    page,
    limit
  );
  
  const transactions = paymentHistoryData?.data?.transactions || null;
  const pagination = paymentHistoryData?.data?.pagination || undefined;

  // Fetch tuition installments
  const { data: installmentsData, isLoading: isLoadingInstallments, error: installmentsError } = useTuitionInstallments(
    selectedChildId
  );
  
  const installments = installmentsData?.data?.installments || null;

  // Fetch payment schedules
  const { data: schedulesData, isLoading: isLoadingSchedules, error: schedulesError } = usePaymentSchedules(
    selectedChildId
  );
  
  const schedules = schedulesData?.data?.schedules || null;

  // Fetch outstanding balances
  const { data: balancesData, isLoading: isLoadingBalances, error: balancesError } = useOutstandingBalances(
    selectedChildId,
    selectedFeeType
  );
  
  const balances = balancesData?.data?.balances || null;

  // Handle filter change
  const handleFiltersChange = (newFilters: PaymentFilter) => {
    setFilters(newFilters);
    setPage(1); // Reset to first page when filters change
    // Update selected child if childId filter is set
    if (newFilters.childId) {
      setSelectedChildId(newFilters.childId);
    } else {
      setSelectedChildId(undefined);
    }
  };

  // Handle page change
  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    // Scroll to top when page changes
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex-1">
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold mb-2">Paiements & Finances</h1>
              <p className="text-xs sm:text-sm lg:text-base text-emerald-100">
                Consultez l'historique des paiements, les échéanciers et les soldes de vos enfants
              </p>
            </div>
            <div className="hidden sm:flex items-center gap-2 sm:gap-4">
              <div className="bg-white/10 rounded-lg p-4 backdrop-blur-sm" role="region" aria-label="Statistiques des paiements">
                <div className="flex items-center gap-2 mb-1">
                  <CreditCard className="h-5 w-5" aria-hidden="true" />
                  <span className="text-sm font-medium">Transactions</span>
                </div>
                <div className="text-2xl font-bold" aria-live="polite">
                  {pagination?.total || 0}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
        <div className="space-y-4 sm:space-y-6">
          {/* Outstanding Balances */}
          <OutstandingBalances
            balances={balances}
            isLoading={isLoadingBalances}
            error={balancesError as Error | null}
            children={childrenForFilter}
            selectedChildId={selectedChildId}
            selectedFeeType={selectedFeeType}
            onChildChange={setSelectedChildId}
            onFeeTypeChange={setSelectedFeeType}
          />

          {/* Tuition Installments */}
          <TuitionInstallments
            installments={installments}
            isLoading={isLoadingInstallments}
            error={installmentsError as Error | null}
            children={childrenForFilter}
            selectedChildId={selectedChildId}
            onChildChange={setSelectedChildId}
          />

          {/* Payment Schedules */}
          <PaymentSchedules
            schedules={schedules}
            isLoading={isLoadingSchedules}
            error={schedulesError as Error | null}
            children={childrenForFilter}
            selectedChildId={selectedChildId}
            onChildChange={setSelectedChildId}
          />

          {/* Payment History */}
          <PaymentHistory
            transactions={transactions}
            isLoading={isLoadingPayments}
            error={paymentsError as Error | null}
            children={childrenForFilter}
            filters={filters}
            onFiltersChange={handleFiltersChange}
            pagination={pagination}
            onPageChange={handlePageChange}
          />
        </div>
      </div>
    </div>
  );
}

