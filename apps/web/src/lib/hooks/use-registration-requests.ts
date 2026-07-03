import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";

const BASE = "/api/v1/registration-requests";

export type AccountType = "student" | "parent";
export type RegistrationStatus = "pending" | "approved" | "rejected";

export interface RegistrationRequest {
  id: string;
  accountType: AccountType;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  address?: string | null;
  details: Record<string, any>;
  status: RegistrationStatus;
  reviewNotes?: string | null;
  rejectionReason?: string | null;
  reviewedAt?: string | null;
  createdUserId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RegistrationListResult {
  requests: RegistrationRequest[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  pendingCount: number;
}

export interface CredentialAccount {
  userId: string;
  name: string;
  email: string;
  matricule?: string | null;
  hasPassword: boolean;
  accountType: AccountType;
}

export interface SendCredentialsResult {
  results: Array<{
    userId: string;
    email: string | null;
    status: "sent" | "failed" | "no_email";
    passwordReset: boolean;
    error?: string;
  }>;
  sent: number;
  failed: number;
  total: number;
}

export interface ApprovedChildAccount {
  name: string;
  email: string;
  matricule: string;
  password: string;
}

export interface ApproveResult {
  userId: string;
  email: string;
  matricule: string | null;
  password: string;
  emailSent: boolean;
  emailError?: string;
  children?: ApprovedChildAccount[];
}

async function parseError(response: Response, fallback: string): Promise<never> {
  const data = await response.json().catch(() => ({}));
  throw new Error(data.message || data.error || fallback);
}

export function useRegistrationRequests(query: {
  status?: RegistrationStatus | "all";
  accountType?: AccountType | "all";
  search?: string;
  page?: number;
  limit?: number;
}) {
  const { data: session } = useSession();

  return useQuery({
    queryKey: ["registration-requests", query],
    queryFn: async (): Promise<RegistrationListResult> => {
      const params = new URLSearchParams();
      if (query.status) params.append("status", query.status);
      if (query.accountType) params.append("accountType", query.accountType);
      if (query.search) params.append("search", query.search);
      if (query.page) params.append("page", String(query.page));
      if (query.limit) params.append("limit", String(query.limit));

      const qs = params.toString();
      const response = await fetch(`${BASE}${qs ? `?${qs}` : ""}`, {
        headers: createApiHeaders(session),
      });
      if (!response.ok) await parseError(response, "Échec du chargement des demandes");
      const json = await response.json();
      return json.data;
    },
    enabled: !!session,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useApproveRegistration() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async ({
      id,
      currentYear,
      notes,
    }: {
      id: string;
      currentYear?: number;
      notes?: string;
    }): Promise<ApproveResult> => {
      const response = await fetch(`${BASE}/${id}/approve`, {
        method: "POST",
        headers: createApiHeaders(session),
        body: JSON.stringify({ currentYear, notes }),
      });
      if (!response.ok) await parseError(response, "Échec de la validation");
      const json = await response.json();
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["registration-requests"] });
      queryClient.invalidateQueries({ queryKey: ["credential-accounts"] });
    },
  });
}

export function useRejectRegistration() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async ({ id, rejectionReason }: { id: string; rejectionReason?: string }) => {
      const response = await fetch(`${BASE}/${id}/reject`, {
        method: "POST",
        headers: createApiHeaders(session),
        body: JSON.stringify({ rejectionReason }),
      });
      if (!response.ok) await parseError(response, "Échec du rejet");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["registration-requests"] });
    },
  });
}

export function useCredentialAccounts(search?: string) {
  const { data: session } = useSession();

  return useQuery({
    queryKey: ["credential-accounts", search || ""],
    queryFn: async (): Promise<{ students: CredentialAccount[]; parents: CredentialAccount[] }> => {
      const qs = search ? `?search=${encodeURIComponent(search)}` : "";
      const response = await fetch(`${BASE}/accounts${qs}`, {
        headers: createApiHeaders(session),
      });
      if (!response.ok) await parseError(response, "Échec du chargement des comptes");
      const json = await response.json();
      return json.data;
    },
    enabled: !!session,
    staleTime: 30 * 1000,
  });
}

export function useSendCredentials() {
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (userIds: string[]): Promise<SendCredentialsResult> => {
      const response = await fetch(`${BASE}/send-credentials`, {
        method: "POST",
        headers: createApiHeaders(session),
        body: JSON.stringify({ userIds }),
      });
      if (!response.ok) await parseError(response, "Échec de l'envoi des identifiants");
      const json = await response.json();
      return json.data;
    },
  });
}
