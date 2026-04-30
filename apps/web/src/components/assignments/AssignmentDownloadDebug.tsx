"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2, Bug } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useSession } from 'next-auth/react';

interface AssignmentDownloadDebugProps {
  assignmentId: string;
  fileName?: string;
  fileUrl?: string;
  disabled?: boolean;
  className?: string;
}

export default function AssignmentDownloadDebug({
  assignmentId,
  fileName,
  fileUrl,
  disabled = false,
  className = ""
}: AssignmentDownloadDebugProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string>('');
  const { data: session } = useSession();

  const handleDownload = async () => {
    if (!fileUrl) {
      toast.error('Aucun fichier disponible pour le téléchargement');
      return;
    }

    setIsDownloading(true);
    setDebugInfo('');
    
    try {
      // Debug: Log all information
      const debug = {
        originalUrl: fileUrl,
        assignmentId,
        fileName,
        sessionUserId: session?.user?.id,
        timestamp: new Date().toISOString()
      };
      
      console.log('Download Debug Info:', debug);
      setDebugInfo(JSON.stringify(debug, null, 2));
      
      // Construct the full URL
      let downloadUrl = fileUrl;
      if (!fileUrl.startsWith('http')) {
        downloadUrl = `http://localhost:4000${fileUrl}`;
      }
      
      console.log('Final download URL:', downloadUrl);
      
      // Try to download
      const response = await fetch(downloadUrl, {
        method: 'GET',
        headers: {
          'X-Tenant': 'imhotepacademy',
'X-User-Id': session?.user?.id || '536a5c76-0de7-4d6f-8065-e09778566066',
        },
      });

      console.log('Response status:', response.status);
      console.log('Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Erreur inconnue');
        console.error('Download failed:', {
          status: response.status,
          statusText: response.statusText,
          errorText,
          url: downloadUrl
        });
        throw new Error(`Erreur ${response.status}: ${response.statusText} - ${errorText}`);
      }

      // Get the file content
      const blob = await response.blob();
      console.log('Blob info:', {
        size: blob.size,
        type: blob.type
      });
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName || 'devoir.pdf';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up
      window.URL.revokeObjectURL(url);
      
      toast.success('Téléchargement réussi !');
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
          <Bug className="w-4 h-4 mr-2" />
        )}
        {isDownloading ? 'Téléchargement...' : 'Télécharger (Debug)'}
      </Button>
      
      {debugInfo && (
        <div className="text-xs bg-gray-100 p-2 rounded">
          <strong>Debug Info:</strong>
          <pre className="whitespace-pre-wrap">{debugInfo}</pre>
        </div>
      )}
    </div>
  );
}
