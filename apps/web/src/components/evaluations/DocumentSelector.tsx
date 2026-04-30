"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, Button, Input, Label } from "@ecoledigitale/ui";
import { Checkbox } from "@/components/ui/checkbox";
import { FileText, Loader2, Upload, X, CheckCircle, AlertCircle } from "lucide-react";

interface Document {
  id: string;
  title: string;
  file_name: string;
  file_type: string;
  file_size: number;
  created_at: Date;
}

interface DocumentSelectorProps {
  courseId: string;
  selectedDocuments: string[];
  onSelectionChange: (documentIds: string[]) => void;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export function DocumentSelector({ courseId, selectedDocuments, onSelectionChange }: DocumentSelectorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const fetchDocuments = useCallback(async () => {
    if (!courseId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/ai-evaluations/courses/${courseId}/documents`, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch documents');
      }

      const data = await response.json();
      setDocuments(data.documents || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleDocumentToggle = (documentId: string, checked: boolean) => {
    if (checked) {
      onSelectionChange([...selectedDocuments, documentId]);
    } else {
      onSelectionChange(selectedDocuments.filter(id => id !== documentId));
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (file.type !== 'application/pdf') {
      setUploadError('Seuls les fichiers PDF sont acceptés');
      return;
    }

    // Validate file size (50MB limit)
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      setUploadError('Le fichier est trop volumineux. Taille maximale: 50MB');
      return;
    }

    setSelectedFile(file);
    setUploadError(null);
  };

  const handleUpload = async () => {
    if (!selectedFile || !courseId) return;

    setUploading(true);
    setUploadError(null);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('title', selectedFile.name.replace('.pdf', ''));
      formData.append('description', 'Document uploadé pour génération d\'évaluation IA');

      // Upload via Next.js API route
      const response = await fetch(`/api/courses/${courseId}/materials`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Erreur lors de l\'upload' }));
        throw new Error(errorData.error || 'Erreur lors de l\'upload');
      }

      const result = await response.json();
      setUploadProgress(100);

      // Refresh documents list
      await fetchDocuments();

      // Automatically select the newly uploaded document
      if (result.id) {
        onSelectionChange([...selectedDocuments, result.id]);
      }

      // Reset file selection
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      // Clear progress after a moment
      setTimeout(() => {
        setUploadProgress(0);
      }, 2000);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Erreur lors de l\'upload');
    } finally {
      setUploading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('fr-FR');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        <span>Chargement des documents...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3">
          <div className="flex items-center justify-between">
            <p className="text-red-600 text-sm">Erreur: {error}</p>
            <Button onClick={fetchDocuments} variant="outline" size="sm">
              Réessayer
            </Button>
          </div>
        </div>
      )}

      {/* Upload Section - Always visible */}
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 bg-gray-50">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="file-upload" className="text-sm font-medium text-gray-700">
              Télécharger un nouveau document PDF
            </Label>
            {selectedFile && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedFile(null);
                  setUploadError(null);
                  if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                  }
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            <Input
              id="file-upload"
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              onChange={handleFileSelect}
              disabled={uploading}
              className="flex-1"
            />
            {selectedFile && (
              <Button
                onClick={handleUpload}
                disabled={uploading}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Téléchargement...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Télécharger
                  </>
                )}
              </Button>
            )}
          </div>

          {selectedFile && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <FileText className="h-4 w-4 text-blue-600" />
              <span className="truncate">{selectedFile.name}</span>
              <span className="text-gray-400">({formatFileSize(selectedFile.size)})</span>
            </div>
          )}

          {uploadProgress > 0 && uploadProgress < 100 && (
            <div className="space-y-1">
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-emerald-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 text-center">{uploadProgress}%</p>
            </div>
          )}

          {uploadError && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-2">
              <AlertCircle className="h-4 w-4" />
              <span>{uploadError}</span>
            </div>
          )}

          {uploadProgress === 100 && !uploadError && (
            <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 border border-green-200 rounded-md p-2">
              <CheckCircle className="h-4 w-4" />
              <span>Document téléchargé avec succès !</span>
            </div>
          )}
        </div>
      </div>

      {/* Documents List */}
      {documents.length > 0 && (
        <>
          <div className="text-sm text-gray-600">
            Sélectionnez les documents qui serviront de base pour générer les questions ({selectedDocuments.length} sélectionné{selectedDocuments.length !== 1 ? 's' : ''})
          </div>
          
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {documents.map((document) => (
              <Card key={document.id} className="p-3">
                <div className="flex items-center space-x-3">
                  <Checkbox
                    id={`doc-${document.id}`}
                    checked={selectedDocuments.includes(document.id)}
                    onCheckedChange={(checked) => handleDocumentToggle(document.id, checked as boolean)}
                  />
                  <FileText className="h-5 w-5 text-blue-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <label 
                      htmlFor={`doc-${document.id}`}
                      className="block text-sm font-medium text-gray-900 cursor-pointer truncate"
                    >
                      {document.title}
                    </label>
                    <div className="flex items-center space-x-4 text-xs text-gray-500">
                      <span>{document.file_name}</span>
                      <span>{formatFileSize(document.file_size)}</span>
                      <span>{formatDate(document.created_at)}</span>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {selectedDocuments.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
          <p className="text-sm text-blue-800">
            <strong>{selectedDocuments.length}</strong> document{selectedDocuments.length !== 1 ? 's' : ''} sélectionné{selectedDocuments.length !== 1 ? 's' : ''} pour la génération de questions.
          </p>
        </div>
      )}
    </div>
  );
}
