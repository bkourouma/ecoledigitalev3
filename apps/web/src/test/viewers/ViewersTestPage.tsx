"use client";

import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TestTube, FileText, Image, Video, Presentation, ExternalLink } from 'lucide-react';
import Link from 'next/link';

import PDFViewerTest from './PDFViewerTest';
import VideoPlayerTest from './VideoPlayerTest';
import PowerPointViewerTest from './PowerPointViewerTest';
import ImageViewerTest from './ImageViewerTest';

export default function ViewersTestPage() {
  const [activeTab, setActiveTab] = useState('pdf');

  const testSuites = [
    {
      id: 'pdf',
      name: 'PDF Viewer',
      icon: FileText,
      component: PDFViewerTest,
      description: 'Test PDF document viewing with zoom, navigation, and search'
    },
    {
      id: 'video',
      name: 'Video Player',
      icon: Video,
      component: VideoPlayerTest,
      description: 'Test video playback with controls, fullscreen, and multiple formats'
    },
    {
      id: 'powerpoint',
      name: 'PowerPoint Viewer',
      icon: Presentation,
      component: PowerPointViewerTest,
      description: 'Test PowerPoint presentation viewing with external viewers'
    },
    {
      id: 'image',
      name: 'Image Viewer',
      icon: Image,
      component: ImageViewerTest,
      description: 'Test image viewing with zoom, pan, rotation, and fullscreen'
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="container mx-auto">
        {/* Header */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <TestTube className="h-6 w-6 text-blue-600" />
              Material Viewers Test Suite
              <Badge variant="outline">v1.0</Badge>
            </CardTitle>
            <p className="text-gray-600">
              Comprehensive testing interface for all material viewer components.
              Use this page to test functionality, performance, and error handling of each viewer.
            </p>
          </CardHeader>
          <CardContent>
            <div className="bg-blue-50 p-4 rounded-lg">
              <h3 className="font-medium mb-2">Additional Test Pages:</h3>
              <div className="flex flex-wrap gap-2">
                <Link href="/test/pdf-worker">
                  <Button variant="outline" size="sm" className="gap-2">
                    <ExternalLink className="h-4 w-4" />
                    PDF Worker Test
                  </Button>
                </Link>
                <Link href="/test/material-viewer">
                  <Button variant="outline" size="sm" className="gap-2">
                    <ExternalLink className="h-4 w-4" />
                    Real Material Test
                  </Button>
                </Link>
                <Link href="/academic/courses/970e8400-e29b-41d4-a716-446655440204/materials">
                  <Button variant="outline" size="sm" className="gap-2">
                    <ExternalLink className="h-4 w-4" />
                    Live Materials Page
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Test Suite Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4 mb-6">
            {testSuites.map((suite) => {
              const IconComponent = suite.icon;
              return (
                <TabsTrigger 
                  key={suite.id} 
                  value={suite.id}
                  className="flex items-center gap-2"
                >
                  <IconComponent className="h-4 w-4" />
                  {suite.name}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {testSuites.map((suite) => {
            const TestComponent = suite.component;
            return (
              <TabsContent key={suite.id} value={suite.id}>
                <Card className="mb-4">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3 mb-2">
                      <suite.icon className="h-5 w-5 text-blue-600" />
                      <h2 className="text-lg font-semibold">{suite.name} Test Suite</h2>
                    </div>
                    <p className="text-gray-600 whitespace-nowrap text-sm md:text-base">{suite.description}</p>
                  </CardContent>
                </Card>
                <TestComponent />
              </TabsContent>
            );
          })}
        </Tabs>

        {/* Instructions */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Testing Instructions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-medium mb-2">How to Use This Test Suite:</h4>
              <ol className="list-decimal list-inside space-y-1 text-sm text-gray-600">
                <li>Select a viewer tab to test (PDF, Video, PowerPoint, or Image)</li>
                <li>Choose from preset test files or enter a custom URL</li>
                <li>Test all functionality using the provided controls</li>
                <li>Check off items in the test checklist as you verify they work</li>
                <li>Report any issues or unexpected behavior</li>
              </ol>
            </div>
            
            <div>
              <h4 className="font-medium mb-2">Common Test Scenarios:</h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-gray-600">
                <li><strong>Load Testing:</strong> Try different file sizes and formats</li>
                <li><strong>Error Handling:</strong> Test with invalid URLs or unsupported formats</li>
                <li><strong>Performance:</strong> Test with large files and multiple viewers open</li>
                <li><strong>Responsive Design:</strong> Test on different screen sizes</li>
                <li><strong>Accessibility:</strong> Test keyboard navigation and screen reader compatibility</li>
              </ul>
            </div>

            <div>
              <h4 className="font-medium mb-2">Known Limitations:</h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-gray-600">
                <li><strong>PowerPoint:</strong> External viewers require publicly accessible URLs</li>
                <li><strong>PDF:</strong> Some advanced PDF features may not be supported</li>
                <li><strong>Video:</strong> Format support depends on browser capabilities</li>
                <li><strong>CORS:</strong> Some external URLs may be blocked by CORS policies</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
