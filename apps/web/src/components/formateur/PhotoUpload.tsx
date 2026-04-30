"use client";

import { useState, useRef } from "react";
import { Button } from "@ecoledigitale/ui";
import { Upload, X, Loader2, User } from "lucide-react";
import Image from "next/image";

interface PhotoUploadProps {
  currentPhotoUrl?: string;
  preview?: string | null;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
}

export function PhotoUpload({
  currentPhotoUrl,
  preview,
  onFileChange,
  disabled = false,
}: PhotoUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith("image/")) {
        alert("Veuillez sélectionner une image");
        return;
      }
      // Validate file size (5MB)
      if (file.size > 5 * 1024 * 1024) {
        alert("L'image ne doit pas dépasser 5MB");
        return;
      }
      onFileChange(file);
    }
  };

  const handleRemove = () => {
    onFileChange(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const displayUrl = preview || currentPhotoUrl;

  return (
    <div className="flex items-center gap-4">
      {displayUrl ? (
        <div className="relative w-24 h-24 rounded-full overflow-hidden border-2 border-border">
          <Image
            src={displayUrl}
            alt="Photo de profil"
            fill
            className="object-cover"
            unoptimized
          />
        </div>
      ) : (
        <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center border-2 border-dashed border-muted-foreground/25">
          <User className="h-8 w-8 text-muted-foreground" />
        </div>
      )}

      <div className="flex gap-2">
        <label className="cursor-pointer">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png"
            onChange={handleFileSelect}
            disabled={disabled}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            asChild
          >
            <span>
              <Upload className="mr-2 h-4 w-4" />
              {displayUrl ? "Changer" : "Télécharger"}
            </span>
          </Button>
        </label>
        {displayUrl && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRemove}
            disabled={disabled}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">JPG ou PNG, max 5MB</p>
    </div>
  );
}

