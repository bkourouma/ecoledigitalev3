'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { createApiHeaders } from '@/lib/api-utils';
import {
  ReportCard,
  Transcript,
  AttendanceReport,
  PaymentReceiptDocument,
  ReportCardFilter,
  TranscriptFilter,
  AttendanceReportFilter,
  PaymentReceiptFilter,
} from '@ecoledigitale/contracts';

// Base hook for parent documents API calls
// Provides session and headers for API calls
export function useParentDocuments() {
  const { data: session } = useSession();
  
  return {
    session,
    headers: createApiHeaders(session),
  };
}

// Base query configuration for parent documents hooks
const defaultQueryConfig = {
  enabled: (session: any) => !!session,
  staleTime: 2 * 60 * 1000, // 2 minutes
  retry: 1,
};

// Hook for fetching report cards
export function useReportCards(
  childId?: string,
  academicYearId?: string,
  semester?: number
) {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      reportCards: ReportCard[];
    } 
  }>({
    queryKey: ['parent-report-cards', childId, academicYearId, semester],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      if (academicYearId) params.append('academicYearId', academicYearId);
      if (semester !== undefined) params.append('semester', semester.toString());
      
      const queryString = params.toString();
      const url = `/api/v1/parent/documents/report-cards${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers,
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch report cards: ${response.statusText}`);
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: 1,
  });
}

// Hook for fetching transcripts
export function useTranscripts(
  childId?: string,
  academicYearId?: string
) {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      transcripts: Transcript[];
    } 
  }>({
    queryKey: ['parent-transcripts', childId, academicYearId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      if (academicYearId) params.append('academicYearId', academicYearId);
      
      const queryString = params.toString();
      const url = `/api/v1/parent/documents/transcripts${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers,
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch transcripts: ${response.statusText}`);
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: 1,
  });
}

// Hook for fetching attendance reports
export function useAttendanceReports(
  childId?: string,
  academicYearId?: string,
  startDate?: string,
  endDate?: string
) {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      attendanceReports: AttendanceReport[];
    } 
  }>({
    queryKey: ['parent-attendance-reports', childId, academicYearId, startDate, endDate],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      if (academicYearId) params.append('academicYearId', academicYearId);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      
      const queryString = params.toString();
      const url = `/api/v1/parent/documents/attendance-reports${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers,
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch attendance reports: ${response.statusText}`);
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: 1,
  });
}

// Hook for fetching payment receipts
export function usePaymentReceipts(
  childId?: string,
  academicYearId?: string,
  startDate?: string,
  endDate?: string
) {
  const { data: session } = useSession();
  
  return useQuery<{ 
    success: boolean; 
    data: { 
      paymentReceipts: PaymentReceiptDocument[];
    } 
  }>({
    queryKey: ['parent-payment-receipts', childId, academicYearId, startDate, endDate],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (childId) params.append('childId', childId);
      if (academicYearId) params.append('academicYearId', academicYearId);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      
      const queryString = params.toString();
      const url = `/api/v1/parent/documents/payment-receipts${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers,
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch payment receipts: ${response.statusText}`);
      }
      
      return response.json();
    },
    enabled: !!session,
    staleTime: 2 * 60 * 1000, // 2 minutes
    retry: 1,
  });
}

