'use client';

import { useState } from 'react';

export default function DebugUploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      console.log('🔧 DEBUG: Starting upload:', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type
      });

      const response = await fetch('/api/debug-upload', {
        method: 'POST',
        body: formData,
      });

      console.log('🔧 DEBUG: Response status:', response.status);

      const data = await response.json();
      console.log('🔧 DEBUG: Response data:', data);

      setResult({
        success: response.ok,
        status: response.status,
        data: data
      });

    } catch (error) {
      console.error('🔧 DEBUG: Upload error:', error);
      setResult({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">🔧 Debug Upload Test</h1>
      
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">
            Sélectionner un fichier PDF :
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
            <h3 className="font-medium">Fichier sélectionné :</h3>
            <p>Nom : {file.name}</p>
            <p>Taille : {(file.size / 1024 / 1024).toFixed(2)} MB</p>
            <p>Type : {file.type}</p>
          </div>
        )}

        <button
          onClick={handleUpload}
          disabled={!file || uploading}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
        >
          {uploading ? 'Téléchargement...' : 'Télécharger (Debug)'}
        </button>

        {result && (
          <div className={`p-4 rounded ${result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            <h3 className="font-medium mb-2">
              {result.success ? '✅ Succès' : '❌ Erreur'}
            </h3>
            <pre className="text-sm overflow-auto">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
