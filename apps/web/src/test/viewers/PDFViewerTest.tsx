"use client";

import React, { useState, useEffect } from 'react';
import { PDFViewer } from '@/components/materials/viewers/PDFViewer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Download, FileText, TestTube } from 'lucide-react';

const TEST_PDFS = [
  {
    name: 'Sample PDF (W3C)',
    url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    description: 'Simple test PDF from W3C'
  },
  {
    name: 'Lorem Ipsum PDF',
    url: 'https://www.learningcontainer.com/wp-content/uploads/2019/09/sample-pdf-file.pdf',
    description: 'Sample PDF with Lorem Ipsum text'
  },
  {
    name: 'Multi-page PDF',
    url: 'https://www.adobe.com/support/products/enterprise/knowledgecenter/media/c4611_sample_explain.pdf',
    description: 'Multi-page PDF document'
  }
];

export default function PDFViewerTest() {
  const [selectedPdf, setSelectedPdf] = useState(TEST_PDFS[0]);
  const [customUrl, setCustomUrl] = useState('');
  const [isCustom, setIsCustom] = useState(false);

  const handleDownload = () => {
    const url = isCustom ? customUrl : selectedPdf.url;
    const link = document.createElement('a');
    link.href = url;
    link.download = isCustom ? 'custom-document.pdf' : `${selectedPdf.name}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCustomUrlTest = () => {
    if (customUrl.trim()) {
      setIsCustom(true);
    }
  };

  const handlePresetTest = (pdf: typeof TEST_PDFS[0]) => {
    setSelectedPdf(pdf);
    setIsCustom(false);
  };

  const currentUrl = isCustom ? customUrl : selectedPdf.url;
  const currentTitle = isCustom ? 'Custom PDF Document' : selectedPdf.name;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TestTube className="h-5 w-5" />
            PDF Viewer Test Suite
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Test Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Preset PDFs */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Test with Preset PDFs:</Label>
              {TEST_PDFS.map((pdf, index) => (
                <Button
                  key={index}
                  variant={!isCustom && selectedPdf.url === pdf.url ? "default" : "outline"}
                  size="sm"
                  onClick={() => handlePresetTest(pdf)}
                  className="w-full justify-start"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  {pdf.name}
                </Button>
              ))}
            </div>

            {/* Custom URL */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Test with Custom URL:</Label>
              <div className="space-y-2">
                <Input
                  placeholder="Enter PDF URL..."
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                />
                <Button
                  onClick={handleCustomUrlTest}
                  disabled={!customUrl.trim()}
                  variant="outline"
                  size="sm"
                  className="w-full"
                >
                  Test Custom URL
                </Button>
              </div>
            </div>
          </div>

          {/* Current Test Info */}
          <div className="bg-blue-50 p-3 rounded-lg">
            <p className="text-sm">
              <strong>Currently Testing:</strong> {currentTitle}
            </p>
            <p className="text-xs text-gray-600 break-all">
              <strong>URL:</strong> {currentUrl}
            </p>
            {!isCustom && (
              <p className="text-xs text-gray-600">
                <strong>Description:</strong> {selectedPdf.description}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* PDF Viewer */}
      {currentUrl && (
        <PDFViewer
          url={currentUrl}
          title={currentTitle}
          onDownload={handleDownload}
        />
      )}

      {/* Test Results */}
      <Card>
        <CardHeader>
          <CardTitle>Test Checklist</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="load" />
              <label htmlFor="load">PDF loads successfully</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="navigate" />
              <label htmlFor="navigate">Page navigation works (prev/next buttons)</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="zoom" />
              <label htmlFor="zoom">Zoom in/out controls work</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="rotate" />
              <label htmlFor="rotate">Rotation control works</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="page-input" />
              <label htmlFor="page-input">Direct page number input works</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="search" />
              <label htmlFor="search">Search functionality works</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="download" />
              <label htmlFor="download">Download button works</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="error" />
              <label htmlFor="error">Error handling works (test with invalid URL)</label>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
