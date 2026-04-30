"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2, Bug, Zap } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useSession } from 'next-auth/react';

interface AssignmentDownloadTestProps {
  assignmentId: string;
  fileName?: string;
  fileUrl?: string;
  disabled?: boolean;
  className?: string;
}

export default function AssignmentDownloadTest({
  assignmentId,
  fileName,
  fileUrl,
  disabled = false,
  className = ""
}: AssignmentDownloadTestProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [method, setMethod] = useState<string>('');
  const { data: session } = useSession();

  const handleDownload = async (method: string) => {
    if (!fileUrl) {
      toast.error('Aucun fichier disponible pour le téléchargement');
      return;
    }

    // Debug: Log all information
    console.log('=== DOWNLOAD DEBUG INFO ===');
    console.log('Method:', method);
    console.log('File URL:', fileUrl);
    console.log('Assignment ID:', assignmentId);
    console.log('File Name:', fileName);
    console.log('Session User ID:', session?.user?.id);
    console.log('===========================');

    setIsDownloading(true);
    setMethod(method);
    
    try {
      if (method === 'direct') {
        // Method 1: Direct download
        const fullUrl = fileUrl.startsWith('http') ? fileUrl : `http://localhost:4000${fileUrl}`;
        
        const response = await fetch(fullUrl, {
          method: 'GET',
          headers: {
            'X-Tenant': 'imhotepacademy',
'X-User-Id': session?.user?.id || '536a5c76-0de7-4d6f-8065-e09778566066',
          },
        });

        if (!response.ok) {
          throw new Error(`Erreur ${response.status}: ${response.statusText}`);
        }

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
        
        toast.success('Téléchargement direct réussi !');
        
      } else if (method === 'api') {
        // Method 2: API endpoint
        const downloadUrl = `/api/v1/files/download?url=${encodeURIComponent(fileUrl)}&assignmentId=${assignmentId}`;
        
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = fileName || 'devoir.pdf';
        link.target = '_blank';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        toast.success('Téléchargement via API réussi !');
        
      } else if (method === 'window') {
        // Method 3: Open in new window
        const fullUrl = fileUrl.startsWith('http') ? fileUrl : `http://localhost:4000${fileUrl}`;
        window.open(fullUrl, '_blank');
        toast.success('Ouverture dans un nouvel onglet');
      }
      
    } catch (error) {
      console.error('Download error:', error);
      toast.error(`Erreur avec la méthode ${method}: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    } finally {
      setIsDownloading(false);
      setMethod('');
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleDownload('direct')}
          disabled={disabled || isDownloading || !fileUrl}
          className={className}
        >
          {isDownloading && method === 'direct' ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Download className="w-4 h-4 mr-2" />
          )}
          Direct
        </Button>
        
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleDownload('api')}
          disabled={disabled || isDownloading || !fileUrl}
          className={className}
        >
          {isDownloading && method === 'api' ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Zap className="w-4 h-4 mr-2" />
          )}
          API
        </Button>
        
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleDownload('window')}
          disabled={disabled || isDownloading || !fileUrl}
          className={className}
        >
          {isDownloading && method === 'window' ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Bug className="w-4 h-4 mr-2" />
          )}
          Window
        </Button>
      </div>
      
      {fileUrl && (
        <div className="text-xs text-gray-500">
          URL: {fileUrl}
        </div>
      )}
    </div>
  );
}
