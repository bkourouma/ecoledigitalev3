"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

export default function PDFWorkerTest() {
  const [workerStatus, setWorkerStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [workerUrl, setWorkerUrl] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    testPDFWorker();
  }, []);

  const testPDFWorker = async () => {
    try {
      setWorkerStatus('loading');
      
      // Test if the worker file is accessible
      const workerResponse = await fetch('/pdf.worker.min.js');
      if (!workerResponse.ok) {
        throw new Error(`Worker file not accessible: ${workerResponse.status}`);
      }

      // Test PDF.js setup
      const { pdfjs } = await import('react-pdf');
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
      
      setWorkerUrl(pdfjs.GlobalWorkerOptions.workerSrc);
      
      // Try to load a simple PDF to test the worker
      const testPdfUrl = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';
      const loadingTask = pdfjs.getDocument(testPdfUrl);
      const pdf = await loadingTask.promise;
      
      if (pdf.numPages > 0) {
        setWorkerStatus('success');
      } else {
        throw new Error('PDF loaded but has no pages');
      }
      
    } catch (error) {
      console.error('PDF Worker test failed:', error);
      setWorkerStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>PDF Worker Test</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {workerStatus === 'loading' && <Loader2 className="h-5 w-5 animate-spin" />}
              {workerStatus === 'success' && <CheckCircle className="h-5 w-5 text-green-500" />}
              {workerStatus === 'error' && <XCircle className="h-5 w-5 text-red-500" />}
              <span className="font-medium">
                PDF Worker Status: {workerStatus === 'loading' ? 'Testing...' : workerStatus}
              </span>
            </div>

            {workerUrl && (
              <div className="text-sm text-gray-600">
                <strong>Worker URL:</strong> {workerUrl}
              </div>
            )}

            {workerStatus === 'error' && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Error:</strong> {errorMessage}
                </AlertDescription>
              </Alert>
            )}

            {workerStatus === 'success' && (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  PDF worker is working correctly! The PDF viewers should now function properly.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div className="pt-4 border-t">
            <Button onClick={testPDFWorker} disabled={workerStatus === 'loading'}>
              {workerStatus === 'loading' ? 'Testing...' : 'Test Again'}
            </Button>
          </div>

          <div className="text-sm text-gray-500 space-y-2">
            <p><strong>What this test does:</strong></p>
            <ul className="list-disc list-inside space-y-1">
              <li>Checks if the PDF worker file is accessible at /pdf.worker.min.js</li>
              <li>Configures PDF.js to use the local worker</li>
              <li>Attempts to load a test PDF document</li>
              <li>Verifies the PDF can be parsed successfully</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
