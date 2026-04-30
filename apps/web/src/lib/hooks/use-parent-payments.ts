'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { createApiHeaders } from '@/lib/api-utils';
import { useActiveAcademicYear } from '@/lib/hooks/use-academic-years';
import { 
  ParentPaymentHistory, 
  TuitionInstallment, 
  PaymentSchedule, 
  OutstandingBalance, 
  PaymentReceipt, 
  PaymentMethod, 
  PaymentFilter 
} from '@ecoledigitale/contracts';

// Base hook for parent payments API calls
// Provides session and headers for API calls
export function useParentPayments() {
  const { data: session } = useSession();
  
  return {
    session,
    headers: createApiHeaders(session),
  };
}

// Hook for fetching payment history
export function usePaymentHistory(
  childId?: string,
  filters: PaymentFilter = {},
  page: number = 1,
  limit: number = 20
) {
  const { data: session } = useSession();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id || 'no-academic-year';
  
  return useQuery<{ 
    success: boolean; 
    data: ParentPaymentHistory;
  }>({
    queryKey: ['parent-payment-history', childId, filters, page, limit, activeAcademicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      if (filters.feeType) params.append('feeType', filters.feeType);
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.status) params.append('status', filters.status);
      params.append('page', page.toString());
      params.append('limit', limit.toString());
      
      const queryString = params.toString();
      const url = `/api/v1/parent/payments/history${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch payment history' }));
        throw new Error(error.message || 'Failed to fetch payment history');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

// Hook for fetching tuition installments
export function useTuitionInstallments(childId?: string) {
  const { data: session } = useSession();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id || 'no-academic-year';
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      installments: TuitionInstallment[];
    };
  }>({
    queryKey: ['parent-tuition-installments', childId, activeAcademicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      
      const queryString = params.toString();
      const url = `/api/v1/parent/payments/installments${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch tuition installments' }));
        throw new Error(error.message || 'Failed to fetch tuition installments');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

// Hook for fetching payment schedules
export function usePaymentSchedules(childId?: string) {
  const { data: session } = useSession();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id || 'no-academic-year';
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      schedules: PaymentSchedule[];
    };
  }>({
    queryKey: ['parent-payment-schedules', childId, activeAcademicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      
      const queryString = params.toString();
      const url = `/api/v1/parent/payments/schedules${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch payment schedules' }));
        throw new Error(error.message || 'Failed to fetch payment schedules');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

// Hook for fetching outstanding balances
export function useOutstandingBalances(childId?: string, feeType?: 'tuition' | 'inscription' | 'annexes' | 'autres') {
  const { data: session } = useSession();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id || 'no-academic-year';
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      balances: OutstandingBalance[];
    };
  }>({
    queryKey: ['parent-outstanding-balances', childId, feeType, activeAcademicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      if (feeType) params.append('feeType', feeType);
      
      const queryString = params.toString();
      const url = `/api/v1/parent/payments/balances${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch outstanding balances' }));
        throw new Error(error.message || 'Failed to fetch outstanding balances');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

// Hook for fetching payment receipts
export function usePaymentReceipts(
  childId?: string,
  filters: { feeType?: 'tuition' | 'inscription' | 'annexes' | 'autres'; startDate?: string; endDate?: string } = {},
  page: number = 1,
  limit: number = 20
) {
  const { data: session } = useSession();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id || 'no-academic-year';
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      receipts: PaymentReceipt[];
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
    };
  }>({
    queryKey: ['parent-payment-receipts', childId, filters, page, limit, activeAcademicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      if (filters.feeType) params.append('feeType', filters.feeType);
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      params.append('page', page.toString());
      params.append('limit', limit.toString());
      
      const queryString = params.toString();
      const url = `/api/v1/parent/payments/receipts${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch payment receipts' }));
        throw new Error(error.message || 'Failed to fetch payment receipts');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

// Hook for fetching payment methods
export function usePaymentMethods() {
  const { data: session } = useSession();
  const { data: activeAcademicYearData } = useActiveAcademicYear();
  const activeAcademicYearId = activeAcademicYearData?.academicYear?.id || 'no-academic-year';
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      methods: PaymentMethod[];
    };
  }>({
    queryKey: ['parent-payment-methods', activeAcademicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      const url = '/api/v1/parent/payments/methods';
      
      const response = await fetch(url, {
        headers,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to fetch payment methods' }));
        throw new Error(error.message || 'Failed to fetch payment methods');
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

