"use client";

import React, { useState } from 'react';
import { PowerPointViewer } from '@/components/materials/viewers/PowerPointViewer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Download, FileText, TestTube, AlertCircle } from 'lucide-react';

const TEST_POWERPOINTS = [
  {
    name: 'Sample PowerPoint (PPTX)',
    url: 'https://www.learningcontainer.com/wp-content/uploads/2019/09/sample-ppt-file.ppt',
    description: 'Sample PowerPoint presentation'
  },
  {
    name: 'Test Presentation',
    url: 'https://file-examples.com/storage/fe86c96b3d0b0b1e8e8b8e8/2017/08/file_example_PPT_250kB.ppt',
    description: 'Another test PowerPoint file'
  }
];

export default function PowerPointViewerTest() {
  const [selectedPpt, setSelectedPpt] = useState(TEST_POWERPOINTS[0]);
  const [customUrl, setCustomUrl] = useState('');
  const [isCustom, setIsCustom] = useState(false);

  const handleDownload = () => {
    const url = isCustom ? customUrl : selectedPpt.url;
    const link = document.createElement('a');
    link.href = url;
    link.download = isCustom ? 'custom-presentation.pptx' : `${selectedPpt.name}.pptx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCustomUrlTest = () => {
    if (customUrl.trim()) {
      setIsCustom(true);
    }
  };

  const handlePresetTest = (ppt: typeof TEST_POWERPOINTS[0]) => {
    setSelectedPpt(ppt);
    setIsCustom(false);
  };

  const currentUrl = isCustom ? customUrl : selectedPpt.url;
  const currentTitle = isCustom ? 'Custom PowerPoint Presentation' : selectedPpt.name;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TestTube className="h-5 w-5" />
            PowerPoint Viewer Test Suite
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Important Note */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Note:</strong> PowerPoint viewing in browsers has limitations. External viewers like Microsoft Office Online 
              require publicly accessible URLs. Local development URLs will not work with external viewers.
            </AlertDescription>
          </Alert>

          {/* Test Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Preset PowerPoints */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Test with Preset PowerPoints:</Label>
              {TEST_POWERPOINTS.map((ppt, index) => (
                <Button
                  key={index}
                  variant={!isCustom && selectedPpt.url === ppt.url ? "default" : "outline"}
                  size="sm"
                  onClick={() => handlePresetTest(ppt)}
                  className="w-full justify-start"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  {ppt.name}
                </Button>
              ))}
            </div>

            {/* Custom URL */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Test with Custom URL:</Label>
              <div className="space-y-2">
                <Input
                  placeholder="Enter PowerPoint URL (.ppt, .pptx)..."
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
                <strong>Description:</strong> {selectedPpt.description}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* PowerPoint Viewer */}
      {currentUrl && (
        <PowerPointViewer
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
              <label htmlFor="load">PowerPoint loads in Office Online viewer</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="fallback" />
              <label htmlFor="fallback">Fallback message shows for local URLs</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="open-tab" />
              <label htmlFor="open-tab">"Open in New Tab" button works</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="fullscreen" />
              <label htmlFor="fullscreen">Fullscreen toggle works</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="download" />
              <label htmlFor="download">Download button works</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="alternative-viewers" />
              <label htmlFor="alternative-viewers">Alternative viewer buttons work</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="error-handling" />
              <label htmlFor="error-handling">Error handling works properly</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="responsive" />
              <label htmlFor="responsive">Responsive design works on different screen sizes</label>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
