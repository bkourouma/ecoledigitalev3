/**
 * use-formateur-profile.ts
 * 
 * React hooks for trainer profile management
 * Uses TanStack Query for data fetching and mutations
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ProfileResponseSchema,
  UpdateProfileSchema,
} from "@ecoledigitale/contracts/src/formateurs";
import { createApiHeaders } from "@/lib/api-utils";
import { toast } from "sonner";

/**
 * Hook to fetch trainer profile
 */
export function useFormateurProfile() {
  return useQuery({
    queryKey: ["formateur", "profile"],
    queryFn: async () => {
      const response = await fetch(`/api/v1/formateur/profil`, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch profile");
      }

      const rawData = await response.json();
      return ProfileResponseSchema.parse(rawData);
    },
    staleTime: 60000, // Cache for 1 minute
  });
}

/**
 * Hook to update trainer profile
 */
export function useUpdateFormateurProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: {
      bio?: string;
      specialites?: string[];
      linkedin_url?: string;
      photo?: File;
    }) => {
      const formData = new FormData();
      
      if (updates.bio !== undefined) {
        formData.append("bio", updates.bio);
      }
      if (updates.specialites !== undefined) {
        formData.append("specialites", JSON.stringify(updates.specialites));
      }
      if (updates.linkedin_url !== undefined) {
        formData.append("linkedin_url", updates.linkedin_url);
      }
      if (updates.photo) {
        formData.append("photo", updates.photo);
      }

      const response = await fetch(`/api/v1/formateur/profil`, {
        method: "PUT",
        headers: createApiHeaders(),
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update profile");
      }

      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["formateur", "profile"] });
      toast.success("Profil mis à jour avec succès");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Erreur lors de la mise à jour du profil"
      );
    },
  });
}

/**
 * Hook to upload trainer CV
 */
export function useUploadFormateurCV() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`/api/v1/formateur/profil/cv`, {
        method: "POST",
        headers: createApiHeaders(),
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to upload CV");
      }

      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["formateur", "profile"] });
      toast.success("CV téléchargé avec succès");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Erreur lors du téléchargement du CV"
      );
    },
  });
}

