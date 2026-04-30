"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2, ExternalLink } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface AssignmentDownloadSimpleProps {
  assignmentId: string;
  fileName?: string;
  fileUrl?: string;
  disabled?: boolean;
  className?: string;
}

export default function AssignmentDownloadSimple({
  assignmentId,
  fileName,
  fileUrl,
  disabled = false,
  className = ""
}: AssignmentDownloadSimpleProps) {
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    if (!fileUrl) {
      toast.error('Aucun fichier disponible pour le téléchargement');
      return;
    }

    setIsDownloading(true);
    
    try {
      console.log('=== SIMPLE DOWNLOAD ===');
      console.log('File URL:', fileUrl);
      
      // Construct the full URL
      const fullUrl = fileUrl.startsWith('http') ? fileUrl : `http://localhost:4000${fileUrl}`;
      console.log('Full URL:', fullUrl);
      
      // Try to open in new tab (this should work even if the file doesn't exist)
      // The browser will handle the error gracefully
      window.open(fullUrl, '_blank');
      
      toast.success('Ouverture du fichier dans un nouvel onglet');
      
    } catch (error) {
      console.error('Download error:', error);
      toast.error('Erreur lors de l\'ouverture du fichier');
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
          <ExternalLink className="w-4 h-4 mr-2" />
        )}
        {isDownloading ? 'Ouverture...' : 'Ouvrir PDF'}
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