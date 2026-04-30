"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useSession } from 'next-auth/react';

interface AssignmentDownloadFinalProps {
  assignmentId: string;
  fileName?: string;
  fileUrl?: string;
  disabled?: boolean;
  className?: string;
}

export default function AssignmentDownloadFinal({
  assignmentId,
  fileName,
  fileUrl,
  disabled = false,
  className = ""
}: AssignmentDownloadFinalProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const { data: session } = useSession();

  const handleDownload = async () => {
    if (!fileUrl) {
      toast.error('Aucun fichier disponible pour le téléchargement');
      return;
    }

    setIsDownloading(true);
    
    try {
      // Try multiple methods in sequence
      let success = false;
      
      // Method 1: Direct download with proper headers
      try {
        const fullUrl = fileUrl.startsWith('http') ? fileUrl : `http://localhost:4000${fileUrl}`;
        
        const response = await fetch(fullUrl, {
          method: 'GET',
          headers: {
            'X-Tenant': 'imhotepacademy',
'X-User-Id': session?.user?.id || '536a5c76-0de7-4d6f-8065-e09778566066',
          },
        });

        if (response.ok) {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = fileName || 'devoir.pdf';
          link.style.display = 'none';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);
          success = true;
          toast.success('Téléchargement réussi !');
        }
      } catch (error) {
        console.log('Method 1 failed:', error);
      }
      
      // Method 2: If direct download fails, try opening in new tab
      if (!success) {
        try {
          const fallbackUrl = fileUrl.startsWith('http') ? fileUrl : `http://localhost:4000${fileUrl}`;
          window.open(fallbackUrl, '_blank');
          success = true;
          toast.success('Ouverture du fichier dans un nouvel onglet');
        } catch (error) {
          console.log('Method 2 failed:', error);
        }
      }
      
      // Method 3: If both fail, try API endpoint
      if (!success) {
        try {
          const downloadUrl = `/api/v1/files/download?url=${encodeURIComponent(fileUrl)}&assignmentId=${assignmentId}`;
          const link = document.createElement('a');
          link.href = downloadUrl;
          link.download = fileName || 'devoir.pdf';
          link.target = '_blank';
          link.style.display = 'none';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          success = true;
          toast.success('Téléchargement via API réussi !');
        } catch (error) {
          console.log('Method 3 failed:', error);
        }
      }
      
      if (!success) {
        throw new Error('Toutes les méthodes de téléchargement ont échoué');
      }
      
    } catch (error) {
      console.error('Download error:', error);
      toast.error('Impossible de télécharger le fichier. Vérifiez votre connexion.');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
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
      {isDownloading ? 'Téléchargement...' : 'Télécharger'}
    </Button>
  );
}
