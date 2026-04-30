"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface AssignmentDownloadNextAPIProps {
  assignmentId: string;
  fileName?: string;
  fileUrl?: string;
  disabled?: boolean;
  className?: string;
}

export default function AssignmentDownloadNextAPI({
  assignmentId,
  fileName,
  fileUrl,
  disabled = false,
  className = ""
}: AssignmentDownloadNextAPIProps) {
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    if (!fileUrl) {
      toast.error('Aucun fichier disponible pour le téléchargement');
      return;
    }

    setIsDownloading(true);
    
    try {
      console.log('=== NEXT API DOWNLOAD ===');
      console.log('File URL:', fileUrl);
      console.log('Assignment ID:', assignmentId);
      
      // Use our Next.js API endpoint
      const downloadUrl = `/api/v1/files/download?url=${encodeURIComponent(fileUrl)}&assignmentId=${assignmentId}`;
      console.log('Download URL:', downloadUrl);
      
      // Try to download using fetch
      const response = await fetch(downloadUrl);
      
      console.log('Response status:', response.status);
      console.log('Response headers:', Object.fromEntries(response.headers.entries()));
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Error response:', errorData);
        throw new Error(errorData.error || `Erreur ${response.status}: ${response.statusText}`);
      }
      
      // Get the file content
      const blob = await response.blob();
      console.log(`Blob size: ${blob.size} bytes, type: ${blob.type}`);
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName || 'devoir.pdf';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast.success('Téléchargement via Next API réussi !');
      
    } catch (error) {
      console.error('Download error:', error);
      toast.error(`Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleDownload}
        disabled={disabled || isDownloading || !fileUrl}
        className={className}
      >
        {isDownloading ? (
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
        ) : (
          <Download className="w-4 h-4 mr-2" />
        )}
        {isDownloading ? 'Téléchargement...' : 'Télécharger (Next API)'}
      </Button>
      
      {fileUrl && (
        <div className="text-xs text-gray-500 break-all bg-gray-50 p-2 rounded">
          <strong>URL:</strong><br />
          {fileUrl}
        </div>
      )}
    </div>
  );
}