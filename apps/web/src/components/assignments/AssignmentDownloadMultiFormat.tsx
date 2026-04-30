"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useSession } from 'next-auth/react';

interface AssignmentDownloadMultiFormatProps {
  assignmentId: string;
  fileName?: string;
  fileUrl?: string;
  disabled?: boolean;
  className?: string;
}

export default function AssignmentDownloadMultiFormat({
  assignmentId,
  fileName,
  fileUrl,
  disabled = false,
  className = ""
}: AssignmentDownloadMultiFormatProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const { data: session } = useSession();

  const handleDownload = async () => {
    if (!fileUrl) {
      toast.error('Aucun fichier disponible pour le téléchargement');
      return;
    }

    setIsDownloading(true);
    
    try {
      console.log('=== MULTI-FORMAT DOWNLOAD ===');
      console.log('Original URL:', fileUrl);
      console.log('Assignment ID:', assignmentId);
      
      // Parse the URL to extract components
      const urlParts = fileUrl.split('/');
      console.log('URL parts:', urlParts);
      
      if (urlParts.length >= 6) {
        const tenantId = urlParts[4];
        const courseId = urlParts[5];
        const filename = urlParts[6];
        
        console.log('Parsed components:');
        console.log('- Tenant ID:', tenantId);
        console.log('- Course ID:', courseId);
        console.log('- Filename:', filename);
        
        // Try multiple URL formats
        const urlFormats = [
          // Format 1: Use assignment ID instead of course ID
          `http://localhost:4000/api/v1/files/${tenantId}/${assignmentId}/${filename}`,
          // Format 2: Use course ID (original format)
          `http://localhost:4000/api/v1/files/${tenantId}/${courseId}/${filename}`,
          // Format 3: Direct file access
          `http://localhost:4000/api/v1/files/${tenantId}/${assignmentId}/${filename}`,
          // Format 4: Alternative format
          `http://localhost:4000/uploads/${tenantId}/${assignmentId}/${filename}`
        ];
        
        let success = false;
        let lastError = null;
        
        for (let i = 0; i < urlFormats.length; i++) {
          const testUrl = urlFormats[i];
          console.log(`Trying format ${i + 1}:`, testUrl);
          
          try {
            const response = await fetch(testUrl, {
              method: 'GET',
              headers: {
                'X-Tenant': tenantId,
'X-User-Id': session?.user?.id || '536a5c76-0de7-4d6f-8065-e09778566066',
              },
            });
            
            console.log(`Response status for format ${i + 1}:`, response.status);
            
            if (response.ok) {
              const blob = await response.blob();
              console.log(`Blob size: ${blob.size} bytes, type: ${blob.type}`);
              
              // Create download link
              const url = window.URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = fileName || filename;
              link.style.display = 'none';
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              window.URL.revokeObjectURL(url);
              
              success = true;
              toast.success(`Téléchargement réussi avec le format ${i + 1} !`);
              break;
            } else {
              const errorData = await response.json().catch(() => ({}));
              lastError = `Format ${i + 1}: ${response.status} - ${errorData.error || response.statusText}`;
            }
          } catch (error) {
            console.log(`Error with format ${i + 1}:`, error);
            lastError = `Format ${i + 1}: ${error instanceof Error ? error.message : 'Erreur inconnue'}`;
          }
        }
        
        if (!success) {
          throw new Error(`Tous les formats ont échoué. Dernière erreur: ${lastError}`);
        }
        
      } else {
        throw new Error('Format d\'URL invalide');
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
        {isDownloading ? 'Téléchargement...' : 'Télécharger (Multi-Format)'}
      </Button>
      
      {fileUrl && (
        <div className="text-xs text-gray-500 break-all bg-gray-50 p-2 rounded">
          <strong>URL originale:</strong><br />
          {fileUrl}
        </div>
      )}
    </div>
  );
}
