"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// Report Card Types
export interface ReportCard {
  id: string;
  studentId: string;
  studentName?: string;
  academicYearId: string;
  academicYearName?: string;
  semester: number;
  reportDate: string;
  overallGrade: number;
  reportUrl: string | null;
  downloadable: boolean;
  viewable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReportCard {
  studentId: string;
  academicYearId: string;
  semester: number;
  reportDate: string;
  overallGrade: number;
  reportUrl?: string;
  downloadable?: boolean;
  viewable?: boolean;
}

export interface UpdateReportCard {
  studentId?: string;
  academicYearId?: string;
  semester?: number;
  reportDate?: string;
  overallGrade?: number;
  reportUrl?: string;
  downloadable?: boolean;
  viewable?: boolean;
}

export interface ReportCardQuery {
  studentId?: string;
  academicYearId?: string;
  semester?: number;
  page?: number;
  limit?: number;
}

// API functions
async function fetchReportCards(query: ReportCardQuery = {}): Promise<{ data: ReportCard[]; pagination?: any }> {
  const searchParams = new URLSearchParams();
  
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      searchParams.append(key, value.toString());
    }
  });

  const url = `/api/v1/report-cards${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch report cards");
  }

  const payload = await response.json();
  
  // Handle both paginated and non-paginated responses
  if (payload.success !== false) {
    if (Array.isArray(payload.data)) {
      return { data: payload.data };
    } else if (payload.data && Array.isArray(payload.data.reportCards)) {
      return { data: payload.data.reportCards };
    } else if (Array.isArray(payload)) {
      return { data: payload };
    } else {
      return { data: [] };
    }
  }
  
  return { data: [] };
}

async function fetchReportCard(id: string): Promise<ReportCard> {
  // Since there's no GET /report-cards/:id endpoint, we use the list endpoint
  // and filter client-side. We fetch with max limit (100) and paginate if needed.
  let page = 1;
  const limit = 100;
  let reportCard: ReportCard | undefined;

  // Try to find the report card by paginating through results
  while (!reportCard) {
    const response = await fetch(`/api/v1/report-cards?limit=${limit}&page=${page}`, {
      headers: {
        "Content-Type": "application/json",
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(errorText || `Failed to fetch report card ${id}`);
    }
    
    const payload = await response.json();
    
    // Handle different response formats
    let reportCards: ReportCard[] = [];
    if (payload.success !== false) {
      if (Array.isArray(payload.data)) {
        reportCards = payload.data;
      } else if (payload.data && Array.isArray(payload.data.reportCards)) {
        reportCards = payload.data.reportCards;
      } else if (Array.isArray(payload)) {
        reportCards = payload;
      }
    }
    
    // Find the report card by ID
    reportCard = reportCards.find((r: any) => r.id === id);
    
    // If not found and there are more pages, continue
    if (!reportCard && payload?.pagination && page < payload.pagination.totalPages) {
      page++;
    } else {
      break;
    }
  }
  
  if (!reportCard) {
    throw new Error(`Report card with id ${id} not found`);
  }
  
  return reportCard;
}

async function createReportCard(data: CreateReportCard): Promise<ReportCard> {
  const response = await fetch(`/api/v1/report-cards`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || error.error || "Failed to create report card");
  }

  const payload = await response.json();
  return payload.data || payload;
}

async function updateReportCard(id: string, data: UpdateReportCard): Promise<ReportCard> {
  const response = await fetch(`/api/v1/report-cards/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || error.error || "Failed to update report card");
  }

  const payload = await response.json();
  return payload.data || payload;
}

async function deleteReportCard(id: string): Promise<void> {
  const response = await fetch(`/api/v1/report-cards/${id}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || error.error || `Failed to delete report card: ${response.statusText}`);
  }
}

// React Query hooks
export function useReportCards(query: ReportCardQuery = {}) {
  return useQuery({
    queryKey: ["report-cards", query],
    queryFn: () => fetchReportCards(query),
  });
}

export function useReportCard(id?: string) {
  return useQuery({
    queryKey: ["report-cards", id],
    queryFn: () => fetchReportCard(id as string),
    enabled: !!id,
  });
}

export function useCreateReportCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createReportCard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report-cards"] });
    },
  });
}

export function useUpdateReportCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateReportCard }) =>
      updateReportCard(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report-cards"] });
    },
  });
}

export function useDeleteReportCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteReportCard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report-cards"] });
    },
  });
}

