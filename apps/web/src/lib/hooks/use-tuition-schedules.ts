import { useState, useEffect } from "react";

import { createApiHeaders, buildQueryString } from '@/lib/api-utils';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// Types
export interface TuitionSchedule {
  id: string;
  tenantId: string;
  academicYearId: string;
  cycleId: string | null;
  scheduleName: string;
  installments: {
    percentage: number;
    dueDate: string;
    label: string;
  }[];
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  // Computed fields from joins
  academicYearName?: string;
  cycleName?: string;
  studentsCount?: number;
}

export interface CreateTuitionScheduleData {
  academicYearId: string;
  cycleId: string | null;
  programmeId?: string | null;
  scheduleName: string;
  installments: {
    percentage: number;
    dueDate: string;
    label: string;
  }[];
}

export interface UpdateTuitionScheduleData {
  scheduleName?: string;
  installments?: {
    percentage: number;
    dueDate: string;
    label: string;
  }[];
  isActive?: boolean;
}

export interface TuitionScheduleQuery {
  academicYearId?: string;
  cycleId?: string;
  isActive?: boolean;
  limit?: number;
  offset?: number;
}

// API functions
async function fetchTuitionSchedules(query: TuitionScheduleQuery = {}): Promise<{ data: TuitionSchedule[]; pagination: any }> {
  const searchParams = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      searchParams.append(key, value.toString());
    }
  });

  const response = await fetch(`${API_BASE_URL}/api/v1/tuition-schedules?${searchParams}`, {
    headers: createApiHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch tuition schedules: ${response.statusText}`);
  }

  return response.json();
}

async function createTuitionSchedule(data: CreateTuitionScheduleData): Promise<TuitionSchedule> {
  const response = await fetch(`${API_BASE_URL}/api/v1/tuition-schedules`, {
    method: "POST",
    headers: createApiHeaders(),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Network error" }));
    // Create an error object with additional details for duplicate schedules
    const errorObj: any = new Error(error.message || `HTTP ${response.status}`);
    if (error.existingScheduleId) {
      errorObj.existingScheduleId = error.existingScheduleId;
      errorObj.existingScheduleName = error.existingScheduleName;
    }
    throw errorObj;
  }

  const result = await response.json();
  return result.data;
}

async function fetchTuitionScheduleById(id: string): Promise<TuitionSchedule> {
  const response = await fetch(`${API_BASE_URL}/api/v1/tuition-schedules/${id}`, {
    headers: createApiHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Network error" }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  const result = await response.json();
  return result.data;
}

async function updateTuitionSchedule(id: string, data: UpdateTuitionScheduleData): Promise<TuitionSchedule> {
  const response = await fetch(`${API_BASE_URL}/api/v1/tuition-schedules/${id}`, {
    method: "PUT",
    headers: createApiHeaders(),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Network error" }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  const result = await response.json();
  return result.data;
}

async function deleteTuitionSchedule(id: string): Promise<void> {
  const headers = createApiHeaders();
  delete headers["Content-Type"];

  const response = await fetch(`${API_BASE_URL}/api/v1/tuition-schedules/${id}`, {
    method: "DELETE",
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Network error" }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }
}

// Generate installments from a schedule
export async function generateInstallments(params: { scheduleId: string; enrollmentIds?: string[]; overwriteExisting?: boolean }) {
  const response = await fetch(`${API_BASE_URL}/api/v1/tuition-schedules/generate-installments`, {
    method: "POST",
    headers: createApiHeaders(),
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Network error" }));
    throw new Error(error.message || error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

// Hooks
export function useTuitionSchedules(query: TuitionScheduleQuery = {}) {
  const [schedules, setSchedules] = useState<TuitionSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<any>(null);

  const loadSchedules = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await fetchTuitionSchedules(query);
      setSchedules(result.data);
      setPagination(result.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tuition schedules");
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSchedules();
  }, [JSON.stringify(query)]);

  const createSchedule = async (data: CreateTuitionScheduleData) => {
    try {
      const newSchedule = await createTuitionSchedule(data);
      setSchedules(prev => [newSchedule, ...prev]);
      return newSchedule;
    } catch (err) {
      throw err;
    }
  };

  const updateSchedule = async (id: string, data: UpdateTuitionScheduleData) => {
    try {
      const updatedSchedule = await updateTuitionSchedule(id, data);
      setSchedules(prev => prev.map(s => s.id === id ? updatedSchedule : s));
      return updatedSchedule;
    } catch (err) {
      throw err;
    }
  };

  const deleteSchedule = async (id: string) => {
    try {
      await deleteTuitionSchedule(id);
      setSchedules(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      throw err;
    }
  };

  return {
    schedules,
    loading,
    error,
    pagination,
    refetch: loadSchedules,
    createSchedule,
    updateSchedule,
    deleteSchedule,
  };
}

export function useCreateTuitionSchedule() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createSchedule = async (data: CreateTuitionScheduleData) => {
    try {
      setLoading(true);
      setError(null);
      const result = await createTuitionSchedule(data);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to create tuition schedule";
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return {
    createSchedule,
    loading,
    error,
  };
}

export function useUpdateTuitionSchedule() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateSchedule = async (id: string, data: UpdateTuitionScheduleData) => {
    try {
      setLoading(true);
      setError(null);
      const result = await updateTuitionSchedule(id, data);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to update tuition schedule";
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return {
    updateSchedule,
    loading,
    error,
  };
}
