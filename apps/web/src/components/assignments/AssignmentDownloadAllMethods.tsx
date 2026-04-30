"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2, ExternalLink, Zap } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useSession } from 'next-auth/react';

interface AssignmentDownloadAllMethodsProps {
  assignmentId: string;
  fileName?: string;
  fileUrl?: string;
  disabled?: boolean;
  className?: string;
}

export default function AssignmentDownloadAllMethods({
  assignmentId,
  fileName,
  fileUrl,
  disabled = false,
  className = ""
}: AssignmentDownloadAllMethodsProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [method, setMethod] = useState<string>('');
  const { data: session } = useSession();

  const handleDownload = async (method: string) => {
    if (!fileUrl) {
      toast.error('Aucun fichier disponible pour le téléchargement');
      return;
    }

    setIsDownloading(true);
    setMethod(method);
    
    try {
      console.log(`=== ${method.toUpperCase()} DOWNLOAD ===`);
      console.log('File URL:', fileUrl);
      console.log('Assignment ID:', assignmentId);
      
      let success = false;
      
      if (method === 'direct') {
        // Method 1: Direct download from backend
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
          toast.success('Téléchargement direct réussi !');
        }
        
      } else if (method === 'nextapi') {
        // Method 2: Next.js API endpoint
        const downloadUrl = `/api/v1/files/download?url=${encodeURIComponent(fileUrl)}&assignmentId=${assignmentId}`;
        
        const response = await fetch(downloadUrl);
        
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
          toast.success('Téléchargement via Next API réussi !');
        }
        
      } else if (method === 'window') {
        // Method 3: Open in new window
        const fullUrl = fileUrl.startsWith('http') ? fileUrl : `http://localhost:4000${fileUrl}`;
        window.open(fullUrl, '_blank');
        success = true;
        toast.success('Ouverture dans un nouvel onglet');
      }
      
      if (!success) {
        throw new Error(`Méthode ${method} a échoué`);
      }
      
    } catch (error) {
      console.error('Download error:', error);
      toast.error(`Erreur avec ${method}: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    } finally {
      setIsDownloading(false);
      setMethod('');
    }
  };

  return (
    <div className="space-y-3">
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
          onClick={() => handleDownload('nextapi')}
          disabled={disabled || isDownloading || !fileUrl}
          className={className}
        >
          {isDownloading && method === 'nextapi' ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Zap className="w-4 h-4 mr-2" />
          )}
          Next API
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
            <ExternalLink className="w-4 h-4 mr-2" />
          )}
          Window
        </Button>
      </div>
      
      {fileUrl && (
        <div className="text-xs text-gray-500 break-all bg-gray-50 p-2 rounded">
          <strong>URL du fichier:</strong><br />
          {fileUrl}
        </div>
      )}
      
      <div className="text-xs text-gray-400">
        💡 Essayez les 3 méthodes pour identifier celle qui fonctionne
      </div>
    </div>
  );
}
