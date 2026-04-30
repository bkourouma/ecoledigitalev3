"use client";

import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, Loader2, Bug, FileText } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface UploadDebuggerProps {
  assignmentId: string;
}

export default function UploadDebugger({ assignmentId }: UploadDebuggerProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [activeTest, setActiveTest] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      console.log('📁 File selected:', {
        name: file.name,
        size: file.size,
        type: file.type
      });
    }
  };

  const runTest = async (testName: string, testFn: () => Promise<void>) => {
    if (!selectedFile) {
      toast.error('Veuillez sélectionner un fichier d\'abord');
      return;
    }

    console.log(`🧪 Starting upload test: ${testName}`);
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

  const testOriginalUpload = async () => {
    const formData = new FormData();
    formData.append('file', selectedFile!);

    const response = await fetch(`/api/v1/assignments/${assignmentId}/submissions/upload`, {
      method: 'POST',
      body: formData,
    });

    console.log('📡 Original upload response:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    console.log('✅ Original upload successful:', data);
  };

  const testDirectUpload = async () => {
    const formData = new FormData();
    formData.append('file', selectedFile!);

    const response = await fetch(`/api/v1/assignments/${assignmentId}/submissions/upload-direct`, {
      method: 'POST',
      body: formData,
    });

    console.log('📡 Direct upload response:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    console.log('✅ Direct upload successful:', data);
  };

  const testBackendDirect = async () => {
    const formData = new FormData();
    formData.append('file', selectedFile!);

    const response = await fetch(`http://localhost:4000/api/v1/assignments/${assignmentId}/submissions/upload`, {
      method: 'POST',
      headers: {
        'X-Tenant': '6eb9c106-b650-4398-b6fa-091b6828c4ba',
'X-User-Id': '536a5c76-0de7-4d6f-8065-e09778566066',
      },
      body: formData,
    });

    console.log('📡 Backend direct response:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    console.log('✅ Backend direct successful:', data);
  };

  return (
    <div className="p-4 border-2 border-orange-200 rounded-lg bg-orange-50">
      <div className="flex items-center gap-2 mb-4">
        <Bug className="w-5 h-5 text-orange-600" />
        <h3 className="font-semibold text-orange-800">🔧 Debugger d'Upload</h3>
      </div>
      
      {/* File Selection */}
      <div className="mb-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          onChange={handleFileSelect}
          className="hidden"
        />
        <Button
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          className="w-full mb-2"
        >
          <FileText className="w-4 h-4 mr-2" />
          {selectedFile ? selectedFile.name : 'Sélectionner un fichier PDF'}
        </Button>
        
        {selectedFile && (
          <div className="text-xs text-gray-600 space-y-1">
            <p><strong>Nom:</strong> {selectedFile.name}</p>
            <p><strong>Taille:</strong> {(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
            <p><strong>Type:</strong> {selectedFile.type}</p>
          </div>
        )}
      </div>
      
      {/* Test Buttons */}
      <div className="grid grid-cols-1 gap-2 mb-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => runTest('Original Upload', testOriginalUpload)}
          disabled={isLoading || !selectedFile}
          className={activeTest === 'Original Upload' ? 'bg-yellow-100' : ''}
        >
          {isLoading && activeTest === 'Original Upload' ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Upload className="w-4 h-4 mr-2" />
          )}
          Original Upload
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => runTest('Direct Upload', testDirectUpload)}
          disabled={isLoading || !selectedFile}
          className={activeTest === 'Direct Upload' ? 'bg-yellow-100' : ''}
        >
          {isLoading && activeTest === 'Direct Upload' ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Upload className="w-4 h-4 mr-2" />
          )}
          Direct Upload
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => runTest('Backend Direct', testBackendDirect)}
          disabled={isLoading || !selectedFile}
          className={activeTest === 'Backend Direct' ? 'bg-yellow-100' : ''}
        >
          {isLoading && activeTest === 'Backend Direct' ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Upload className="w-4 h-4 mr-2" />
          )}
          Backend Direct
        </Button>
      </div>

      <div className="text-xs text-gray-600">
        <p><strong>Assignment ID:</strong> <code className="bg-gray-200 px-1 rounded">{assignmentId}</code></p>
      </div>
    </div>
  );
}
