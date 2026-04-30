"use client";

import React, { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';

// Dynamically import react-pdf to avoid SSR issues
const Document = dynamic(() => import('react-pdf').then(mod => mod.Document), { ssr: false });
const Page = dynamic(() => import('react-pdf').then(mod => mod.Page), { ssr: false });
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  Download,
  ChevronLeft,
  ChevronRight,
  Search,
  Loader2,
  AlertCircle,
  FileText
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

// Set up PDF.js worker - use local worker file
const setupPDFWorker = async () => {
  if (typeof window !== 'undefined') {
    const { pdfjs } = await import('react-pdf');
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      // Use local ESM worker file from public directory (pdfjs-dist v4)
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    }
  }
};

interface PDFViewerProps {
  url: string;
  title?: string;
  onDownload?: () => void;
}

export function PDFViewer({ url, title, onDownload }: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [rotation, setRotation] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState<string>('');
  const [isClient, setIsClient] = useState<boolean>(false);

  // Setup PDF worker and client-side rendering (ensure worker is ready before rendering)
  useEffect(() => {
    let mounted = true;
    (async () => {
      await setupPDFWorker();
      if (mounted) setIsClient(true);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setLoading(false);
    setError(null);
  }, []);

  const onDocumentLoadError = useCallback((error: Error) => {
    setError(`Failed to load PDF: ${error.message}`);
    setLoading(false);
  }, []);

  const goToPrevPage = () => {
    setPageNumber(prev => Math.max(1, prev - 1));
  };

  const goToNextPage = () => {
    setPageNumber(prev => Math.min(numPages, prev + 1));
  };

  const goToPage = (page: number) => {
    const pageNum = Math.max(1, Math.min(numPages, page));
    setPageNumber(pageNum);
  };

  const zoomIn = () => {
    setScale(prev => Math.min(3.0, prev + 0.2));
  };

  const zoomOut = () => {
    setScale(prev => Math.max(0.5, prev - 0.2));
  };

  const resetZoom = () => {
    setScale(1.0);
  };

  const rotate = () => {
    setRotation(prev => (prev + 90) % 360);
  };

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value);
    if (!isNaN(value)) {
      goToPage(value);
    }
  };

  if (!isClient) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {title || 'PDF Document'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            <span className="ml-2">Loading PDF viewer...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-500" />
            PDF Viewer Error
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="truncate">{title || 'PDF Document'}</CardTitle>
          <div className="flex items-center gap-2">
            {onDownload && (
              <Button variant="outline" size="sm" onClick={onDownload}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 p-2 bg-gray-50 rounded-lg">
          {/* Navigation */}
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={goToPrevPage}
              disabled={pageNumber <= 1 || loading}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            
            <div className="flex items-center gap-2 text-sm">
              <Input
                type="number"
                value={pageNumber}
                onChange={handlePageInputChange}
                min={1}
                max={numPages}
                className="w-16 h-8 text-center"
                disabled={loading}
              />
              <span>of {numPages}</span>
            </div>
            
            <Button
              variant="outline"
              size="sm"
              onClick={goToNextPage}
              disabled={pageNumber >= numPages || loading}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={zoomOut}
              disabled={scale <= 0.5 || loading}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              onClick={resetZoom}
              disabled={loading}
              className="min-w-[60px]"
            >
              {Math.round(scale * 100)}%
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              onClick={zoomIn}
              disabled={scale >= 3.0 || loading}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>

          {/* Rotation */}
          <Button
            variant="outline"
            size="sm"
            onClick={rotate}
            disabled={loading}
          >
            <RotateCw className="h-4 w-4" />
          </Button>

          {/* Search */}
          <div className="flex items-center gap-2 ml-auto">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search in document..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="pl-8 w-48"
                disabled={loading}
              />
            </div>
          </div>
        </div>

        {/* PDF Document */}
        <div className="border rounded-lg overflow-auto bg-gray-100 min-h-[600px] flex items-center justify-center">
          {loading && (
            <div className="flex items-center gap-2 text-gray-500">
              <Loader2 className="h-6 w-6 animate-spin" />
              Loading PDF...
            </div>
          )}
          
          <Document
            file={url}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={null}
            error={null}
            className="flex justify-center"
          >
            <Page
              pageNumber={pageNumber}
              scale={scale}
              rotate={rotation}
              renderTextLayer={true}
              renderAnnotationLayer={true}
              className="shadow-lg"
              loading={
                <div className="flex items-center justify-center h-96">
                  <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                </div>
              }
              error={
                <div className="flex items-center justify-center h-96 text-red-500">
                  <AlertCircle className="h-8 w-8 mr-2" />
                  Failed to load page
                </div>
              }
            />
          </Document>
        </div>

        {/* Document info */}
        {!loading && (
          <div className="text-sm text-gray-500 text-center">
            Page {pageNumber} of {numPages} • Zoom: {Math.round(scale * 100)}%
            {rotation > 0 && ` • Rotated: ${rotation}°`}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
