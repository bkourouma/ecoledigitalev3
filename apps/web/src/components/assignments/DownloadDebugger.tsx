"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2, Bug } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface DownloadDebuggerProps {
  assignmentId: string;
  fileName?: string;
  fileUrl?: string;
}

export default function DownloadDebugger({
  assignmentId,
  fileName,
  fileUrl
}: DownloadDebuggerProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [activeTest, setActiveTest] = useState<string>('');

  const runTest = async (testName: string, testFn: () => Promise<void>) => {
    console.log(`🧪 Starting test: ${testName}`);
    setIsLoading(true);
    setActiveTest(testName);
    
    try {
      await testFn();
      toast.success(`✅ ${testName} réussi`);
    } catch (error) {
      console.error(`❌ ${testName} failed:`, error);
      toast.error(`❌ ${testName} échoué: ${error.message}`);
    } finally {
      setIsLoading(false);
      setActiveTest('');
    }
  };

  const testDirectDownload = async () => {
    const response = await fetch('/api/v1/files/direct-download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ fileUrl, assignmentId, fileName })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName || 'document.pdf';
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const testOriginalAPI = async () => {
    const response = await fetch('/api/v1/files/download-assignment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ fileUrl, assignmentId, fileName })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName || 'document.pdf';
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const testBackendDirect = async () => {
    const response = await fetch(`http://localhost:4000${fileUrl}`, {
      method: 'GET',
      headers: {
        'X-Tenant': '6eb9c106-b650-4398-b6fa-091b6828c4ba',
'X-User-Id': '536a5c76-0de7-4d6f-8065-e09778566066',
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || `HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName || 'document.pdf';
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const testSimpleRoute = async () => {
    const response = await fetch('/api/v1/files/test-download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ fileUrl, assignmentId, fileName })
    });

    const data = await response.json();
    console.log('Test route response:', data);
    
    if (!data.success) {
      throw new Error(data.error || 'Test route failed');
    }
  };

  return (
    <div className="p-4 border-2 border-blue-200 rounded-lg bg-blue-50">
      <div className="flex items-center gap-2 mb-4">
        <Bug className="w-5 h-5 text-blue-600" />
        <h3 className="font-semibold text-blue-800">🔧 Debugger de Téléchargement</h3>
      </div>
      
      <div className="grid grid-cols-2 gap-2 mb-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => runTest('Test Route', testSimpleRoute)}
          disabled={isLoading}
          className={activeTest === 'Test Route' ? 'bg-yellow-100' : ''}
        >
          {isLoading && activeTest === 'Test Route' ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Bug className="w-4 h-4 mr-2" />
          )}
          Test Route
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => runTest('Direct Download', testDirectDownload)}
          disabled={isLoading}
          className={activeTest === 'Direct Download' ? 'bg-yellow-100' : ''}
        >
          {isLoading && activeTest === 'Direct Download' ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Download className="w-4 h-4 mr-2" />
          )}
          Direct Download
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => runTest('Original API', testOriginalAPI)}
          disabled={isLoading}
          className={activeTest === 'Original API' ? 'bg-yellow-100' : ''}
        >
          {isLoading && activeTest === 'Original API' ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Download className="w-4 h-4 mr-2" />
          )}
          Original API
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => runTest('Backend Direct', testBackendDirect)}
          disabled={isLoading}
          className={activeTest === 'Backend Direct' ? 'bg-yellow-100' : ''}
        >
          {isLoading && activeTest === 'Backend Direct' ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Download className="w-4 h-4 mr-2" />
          )}
          Backend Direct
        </Button>
      </div>

      <div className="text-xs text-gray-600 space-y-1">
        <p><strong>File URL:</strong> <code className="bg-gray-200 px-1 rounded">{fileUrl}</code></p>
        <p><strong>Assignment ID:</strong> <code className="bg-gray-200 px-1 rounded">{assignmentId}</code></p>
        <p><strong>File Name:</strong> <code className="bg-gray-200 px-1 rounded">{fileName}</code></p>
      </div>
    </div>
  );
}
