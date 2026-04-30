"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2, ExternalLink } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useSession } from 'next-auth/react';

interface AssignmentDownloadDirectProps {
  assignmentId: string;
  fileName?: string;
  fileUrl?: string;
  disabled?: boolean;
  className?: string;
}

export default function AssignmentDownloadDirect({
  assignmentId,
  fileName,
  fileUrl,
  disabled = false,
  className = ""
}: AssignmentDownloadDirectProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const { data: session } = useSession();

  const handleDownload = async () => {
    if (!fileUrl) {
      toast.error('Aucun fichier disponible pour le téléchargement');
      return;
    }

    setIsDownloading(true);
    
    try {
      console.log('=== DIRECT DOWNLOAD ===');
      console.log('Original URL:', fileUrl);
      console.log('Assignment ID:', assignmentId);
      
      // Method 1: Try to open directly in new tab (bypass API issues)
      const fullUrl = fileUrl.startsWith('http') ? fileUrl : `http://localhost:4000${fileUrl}`;
      console.log('Full URL:', fullUrl);
      
      // Try to open in new tab first
      try {
        window.open(fullUrl, '_blank');
        toast.success('Ouverture du fichier dans un nouvel onglet');
        return;
      } catch (error) {
        console.log('Window.open failed:', error);
      }
      
      // Method 2: Try fetch with minimal headers
      try {
        const response = await fetch(fullUrl, {
          method: 'GET',
          headers: {
            'X-Tenant': '6eb9c106-b650-4398-b6fa-091b6828c4ba',
'X-User-Id': session?.user?.id || '536a5c76-0de7-4d6f-8065-e09778566066',
          },
        });
        
        console.log('Response status:', response.status);
        console.log('Response headers:', Object.fromEntries(response.headers.entries()));
        
        if (response.ok) {
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
          
          toast.success('Téléchargement réussi !');
        } else {
          const errorText = await response.text().catch(() => 'Erreur inconnue');
          console.error('Error response:', errorText);
          throw new Error(`Erreur ${response.status}: ${errorText}`);
        }
      } catch (fetchError) {
        console.error('Fetch error:', fetchError);
        throw fetchError;
      }
      
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
        {isDownloading ? 'Téléchargement...' : 'Télécharger (Direct)'}
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
