"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2, ExternalLink } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useSession } from 'next-auth/react';

interface AssignmentDownloadFallbackProps {
  assignmentId: string;
  fileName?: string;
  fileUrl?: string;
  disabled?: boolean;
  className?: string;
}

export default function AssignmentDownloadFallback({
  assignmentId,
  fileName,
  fileUrl,
  disabled = false,
  className = ""
}: AssignmentDownloadFallbackProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const { data: session } = useSession();

  const handleDownload = async () => {
    if (!fileUrl) {
      toast.error('Aucun fichier disponible pour le téléchargement');
      return;
    }

    setIsDownloading(true);
    
    try {
      console.log('=== FALLBACK DOWNLOAD ===');
      console.log('Original URL:', fileUrl);
      console.log('Assignment ID:', assignmentId);
      
      let success = false;
      
      // Method 1: Try to open directly in new tab (bypass all API issues)
      try {
        const fullUrl = fileUrl.startsWith('http') ? fileUrl : `http://localhost:4000${fileUrl}`;
        console.log('Trying direct window.open:', fullUrl);
        
        window.open(fullUrl, '_blank');
        success = true;
        toast.success('Ouverture du fichier dans un nouvel onglet');
      } catch (error) {
        console.log('Window.open failed:', error);
      }
      
      // Method 2: Try Next.js API if direct opening failed
      if (!success) {
        try {
          console.log('Trying Next.js API...');
          const downloadUrl = `/api/v1/files/download?url=${encodeURIComponent(fileUrl)}&assignmentId=${assignmentId}`;
          
          const response = await fetch(downloadUrl);
          
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
            
            success = true;
            toast.success('Téléchargement via Next API réussi !');
          } else {
            const errorData = await response.json().catch(() => ({}));
            console.error('Next API error:', errorData);
          }
        } catch (error) {
          console.error('Next API failed:', error);
        }
      }
      
      // Method 3: Try direct fetch as last resort
      if (!success) {
        try {
          console.log('Trying direct fetch...');
          const fullUrl = fileUrl.startsWith('http') ? fileUrl : `http://localhost:4000${fileUrl}`;
          
          const response = await fetch(fullUrl, {
            method: 'GET',
            headers: {
              'X-Tenant': '6eb9c106-b650-4398-b6fa-091b6828c4ba',
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
            toast.success('Téléchargement direct réussi !');
          }
        } catch (error) {
          console.error('Direct fetch failed:', error);
        }
      }
      
      if (!success) {
        throw new Error('Toutes les méthodes de téléchargement ont échoué');
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
        {isDownloading ? 'Téléchargement...' : 'Télécharger (Fallback)'}
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
