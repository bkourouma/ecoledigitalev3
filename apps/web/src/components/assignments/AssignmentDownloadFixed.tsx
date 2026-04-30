"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useSession } from 'next-auth/react';

interface AssignmentDownloadFixedProps {
  assignmentId: string;
  fileName?: string;
  fileUrl?: string;
  disabled?: boolean;
  className?: string;
}

export default function AssignmentDownloadFixed({
  assignmentId,
  fileName,
  fileUrl,
  disabled = false,
  className = ""
}: AssignmentDownloadFixedProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const { data: session } = useSession();

  const handleDownload = async () => {
    if (!fileUrl) {
      toast.error('Aucun fichier disponible pour le téléchargement');
      return;
    }

    setIsDownloading(true);
    
    try {
      console.log('=== FIXED DOWNLOAD ===');
      console.log('Original URL:', fileUrl);
      console.log('Assignment ID:', assignmentId);
      
      // Parse the URL to extract components
      // Expected format: /api/v1/files/tenantId/courseId/filename
      // But we have: /api/v1/files/tenantId/courseId/assignmentId/filename
      const urlParts = fileUrl.split('/');
      console.log('URL parts:', urlParts);
      
      if (urlParts.length >= 6) {
        const tenantId = urlParts[4]; // 6eb9c106-b650-4398-b6fa-091b6828c4ba
        const courseId = urlParts[5]; // 22a57716-1b30-4567-8234-f03f28d5ebbf
        const filename = urlParts[6]; // 1759692735351_assignment-09d4c44d-f3b3-4e60-9b3d-177fd7859bc0-subject_document-1759692735349.pdf
        
        console.log('Parsed components:');
        console.log('- Tenant ID:', tenantId);
        console.log('- Course ID:', courseId);
        console.log('- Filename:', filename);
        
        // Try the correct API route format
        const correctUrl = `http://localhost:4000/api/v1/files/${tenantId}/${assignmentId}/${filename}`;
        console.log('Corrected URL:', correctUrl);
        
        const response = await fetch(correctUrl, {
          method: 'GET',
          headers: {
            'X-Tenant': tenantId,
'X-User-Id': session?.user?.id || '536a5c76-0de7-4d6f-8065-e09778566066',
          },
        });
        
        console.log('Response status:', response.status);
        
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
          
          toast.success('Téléchargement réussi !');
        } else {
          const errorData = await response.json().catch(() => ({}));
          console.error('Error response:', errorData);
          throw new Error(`Erreur ${response.status}: ${errorData.error || response.statusText}`);
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
        {isDownloading ? 'Téléchargement...' : 'Télécharger (Corrigé)'}
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