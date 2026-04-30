"use client";

import React, { useState } from 'react';
import { Button } from "@ecoledigitale/ui";

export default function TestUploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };

  const handleTestUpload = async () => {
    if (!file) return;

    setLoading(true);
    setResult('');

    try {
      const formData = new FormData();
      formData.append('file', file);

      console.log('🔄 Starting simple test upload:', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type
      });

      const response = await fetch('/api/test-upload', {
        method: 'POST',
        body: formData,
      });

      console.log('📥 Test upload response:', {
        status: response.status,
        ok: response.ok,
        statusText: response.statusText
      });

      const data = await response.json();
      console.log('📄 Test response data:', data);

      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('❌ Test upload error:', error);
      setResult(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRealUpload = async () => {
    if (!file) return;

    setLoading(true);
    setResult('');

    try {
      const formData = new FormData();
      formData.append('file', file);

      console.log('🔄 Starting real upload:', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type
      });

      const response = await fetch('/api/v1/assignments/44d4eb08-e62e-43c8-a9bb-40a7ade39ce9/submissions/upload', {
        method: 'POST',
        headers: {
          'X-Tenant': 'imhotepacademy',
'X-User-Id': '634a57fe-2007-4ecb-ae5b-f9e3152a24fb',
        },
        body: formData,
      });

      console.log('📥 Real upload response:', {
        status: response.status,
        ok: response.ok,
        statusText: response.statusText
      });

      const data = await response.json();
      console.log('📄 Real response data:', data);

      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('❌ Real upload error:', error);
      setResult(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Test Upload</h1>
      
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">
            Select PDF file:
          </label>
          <input
            type="file"
            accept=".pdf"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
        </div>

        {file && (
          <div className="p-4 bg-gray-50 rounded">
            <p><strong>File:</strong> {file.name}</p>
            <p><strong>Size:</strong> {(file.size / 1024 / 1024).toFixed(2)} MB</p>
            <p><strong>Type:</strong> {file.type}</p>
          </div>
        )}

        <div className="space-y-2">
          <Button
            onClick={handleTestUpload}
            disabled={!file || loading}
            className="w-full"
            variant="outline"
          >
            {loading ? 'Testing...' : 'Test Simple Upload'}
          </Button>

          <Button
            onClick={handleRealUpload}
            disabled={!file || loading}
            className="w-full"
          >
            {loading ? 'Uploading...' : 'Real Upload (Assignment)'}
          </Button>
        </div>

        {result && (
          <div className="mt-4">
            <h3 className="text-lg font-semibold mb-2">Result:</h3>
            <pre className="bg-gray-100 p-4 rounded text-sm overflow-auto">
              {result}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
