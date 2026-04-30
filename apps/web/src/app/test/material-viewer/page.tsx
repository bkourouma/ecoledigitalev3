"use client";

import React, { useState } from 'react';
import { PDFViewer } from '@/components/materials/viewers/PDFViewer';
import { VideoPlayer } from '@/components/materials/viewers/VideoPlayer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Test materials from the actual database
const TEST_MATERIALS = [
  {
    id: '523b6908-30db-47d9-9a4f-09eac553bfd7',
    title: 'Sample PDF Document',
    fileType: 'application/pdf',
    viewer: 'pdf'
  },
  {
    id: '8e6684fb-f3c3-4462-a9cd-168f7c121905',
    title: 'Banfora _ une foule en liesse accueil le Capitaine Ibrahim Traoré.mp4',
    fileType: 'video/mp4',
    viewer: 'video'
  },
  {
    id: 'f9294c60-0a00-4395-8419-8ef8c9ac046c',
    title: 'DNS _ Serveurs de noms _ Hostinger.pdf',
    fileType: 'application/pdf',
    viewer: 'pdf'
  }
];

export default function MaterialViewerTest() {
  const [selectedMaterial, setSelectedMaterial] = useState(TEST_MATERIALS[0]);
  const [customMaterialId, setCustomMaterialId] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [customViewer, setCustomViewer] = useState<'pdf' | 'video'>('pdf');
  const [isCustom, setIsCustom] = useState(false);

  const handleTestCustom = () => {
    if (customMaterialId.trim()) {
      setSelectedMaterial({
        id: customMaterialId,
        title: customTitle || 'Custom Material',
        fileType: customViewer === 'pdf' ? 'application/pdf' : 'video/mp4',
        viewer: customViewer
      });
      setIsCustom(true);
    }
  };

  const handleTestPreset = (material: typeof TEST_MATERIALS[0]) => {
    setSelectedMaterial(material);
    setIsCustom(false);
  };

  const contentUrl = `/api/materials/${selectedMaterial.id}/content`;

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = contentUrl;
    link.download = selectedMaterial.title;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Material Viewer Test</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Test Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Preset Materials */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Test with Uploaded Materials:</Label>
              {TEST_MATERIALS.map((material, index) => (
                <Button
                  key={index}
                  variant={!isCustom && selectedMaterial.id === material.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleTestPreset(material)}
                  className="w-full justify-start text-left"
                >
                  <div className="truncate">
                    <div className="font-medium">{material.title}</div>
                    <div className="text-xs text-gray-500">{material.fileType}</div>
                  </div>
                </Button>
              ))}
            </div>

            {/* Custom Material */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Test with Custom Material ID:</Label>
              <div className="space-y-2">
                <Input
                  placeholder="Enter material ID..."
                  value={customMaterialId}
                  onChange={(e) => setCustomMaterialId(e.target.value)}
                />
                <Input
                  placeholder="Enter title (optional)..."
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                />
                <Select value={customViewer} onValueChange={(value: 'pdf' | 'video') => setCustomViewer(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pdf">PDF Viewer</SelectItem>
                    <SelectItem value="video">Video Player</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleTestCustom}
                  disabled={!customMaterialId.trim()}
                  variant="outline"
                  size="sm"
                  className="w-full"
                >
                  Test Custom Material
                </Button>
              </div>
            </div>
          </div>

          {/* Current Test Info */}
          <div className="bg-blue-50 p-3 rounded-lg">
            <p className="text-sm">
              <strong>Currently Testing:</strong> {selectedMaterial.title}
            </p>
            <p className="text-xs text-gray-600">
              <strong>Material ID:</strong> {selectedMaterial.id}
            </p>
            <p className="text-xs text-gray-600">
              <strong>Content URL:</strong> {contentUrl}
            </p>
            <p className="text-xs text-gray-600">
              <strong>Viewer Type:</strong> {selectedMaterial.viewer}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Material Viewer */}
      <div className="space-y-4">
        {selectedMaterial.viewer === 'pdf' && (
          <PDFViewer
            url={contentUrl}
            title={selectedMaterial.title}
            onDownload={handleDownload}
          />
        )}

        {selectedMaterial.viewer === 'video' && (
          <VideoPlayer
            url={contentUrl}
            title={selectedMaterial.title}
            onDownload={handleDownload}
          />
        )}
      </div>

      {/* Debug Info */}
      <Card>
        <CardHeader>
          <CardTitle>Debug Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div><strong>API Endpoint:</strong> {contentUrl}</div>
            <div><strong>Expected Behavior:</strong> Should redirect to MinIO presigned URL</div>
            <div><strong>PDF Worker:</strong> /pdf.worker.min.js (local file)</div>
            <div><strong>Test Status:</strong> {isCustom ? 'Custom Material' : 'Preset Material'}</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
