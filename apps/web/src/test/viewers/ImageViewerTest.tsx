"use client";

import React, { useState } from 'react';
import { ImageViewer } from '@/components/materials/viewers/ImageViewer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Download, Image, TestTube } from 'lucide-react';

const TEST_IMAGES = [
  {
    name: 'Sample JPEG',
    url: 'https://picsum.photos/800/600?random=1',
    description: 'Random image from Lorem Picsum (JPEG)'
  },
  {
    name: 'Large Image',
    url: 'https://picsum.photos/2000/1500?random=2',
    description: 'Large image to test zoom and pan functionality'
  },
  {
    name: 'Portrait Image',
    url: 'https://picsum.photos/600/800?random=3',
    description: 'Portrait orientation image'
  },
  {
    name: 'Square Image',
    url: 'https://picsum.photos/800/800?random=4',
    description: 'Square aspect ratio image'
  },
  {
    name: 'PNG with Transparency',
    url: 'https://www.pngarts.com/files/3/Logo-PNG-High-Quality-Image.png',
    description: 'PNG image with transparency'
  }
];

export default function ImageViewerTest() {
  const [selectedImage, setSelectedImage] = useState(TEST_IMAGES[0]);
  const [customUrl, setCustomUrl] = useState('');
  const [isCustom, setIsCustom] = useState(false);

  const handleDownload = () => {
    const url = isCustom ? customUrl : selectedImage.url;
    const link = document.createElement('a');
    link.href = url;
    link.download = isCustom ? 'custom-image.jpg' : `${selectedImage.name}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCustomUrlTest = () => {
    if (customUrl.trim()) {
      setIsCustom(true);
    }
  };

  const handlePresetTest = (image: typeof TEST_IMAGES[0]) => {
    setSelectedImage(image);
    setIsCustom(false);
  };

  const currentUrl = isCustom ? customUrl : selectedImage.url;
  const currentTitle = isCustom ? 'Custom Image' : selectedImage.name;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TestTube className="h-5 w-5" />
            Image Viewer Test Suite
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Test Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Preset Images */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Test with Preset Images:</Label>
              {TEST_IMAGES.map((image, index) => (
                <Button
                  key={index}
                  variant={!isCustom && selectedImage.url === image.url ? "default" : "outline"}
                  size="sm"
                  onClick={() => handlePresetTest(image)}
                  className="w-full justify-start"
                >
                  <Image className="h-4 w-4 mr-2" />
                  {image.name}
                </Button>
              ))}
            </div>

            {/* Custom URL */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Test with Custom URL:</Label>
              <div className="space-y-2">
                <Input
                  placeholder="Enter image URL (JPG, PNG, GIF, etc.)..."
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
                <strong>Description:</strong> {selectedImage.description}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Image Viewer */}
      {currentUrl && (
        <ImageViewer
          url={currentUrl}
          title={currentTitle}
          alt={currentTitle}
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
              <label htmlFor="load">Image loads successfully</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="zoom-in" />
              <label htmlFor="zoom-in">Zoom in control works</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="zoom-out" />
              <label htmlFor="zoom-out">Zoom out control works</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="reset-zoom" />
              <label htmlFor="reset-zoom">Reset zoom control works</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="fit-screen" />
              <label htmlFor="fit-screen">Fit to screen control works</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="rotate-cw" />
              <label htmlFor="rotate-cw">Rotate clockwise works</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="rotate-ccw" />
              <label htmlFor="rotate-ccw">Rotate counter-clockwise works</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="reset-rotation" />
              <label htmlFor="reset-rotation">Reset rotation works</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="pan" />
              <label htmlFor="pan">Pan/drag functionality works when zoomed</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="wheel-zoom" />
              <label htmlFor="wheel-zoom">Mouse wheel zoom works</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="fullscreen" />
              <label htmlFor="fullscreen">Fullscreen mode works</label>
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
