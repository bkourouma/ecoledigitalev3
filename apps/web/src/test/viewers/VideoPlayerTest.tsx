"use client";

import React, { useState } from 'react';
import { VideoPlayer } from '@/components/materials/viewers/VideoPlayer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Download, Video, TestTube } from 'lucide-react';

const TEST_VIDEOS = [
  {
    name: 'Big Buck Bunny (MP4)',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    description: 'Sample MP4 video from Google'
  },
  {
    name: 'Elephant Dream (MP4)',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    description: 'Another sample MP4 video'
  },
  {
    name: 'YouTube Video',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    description: 'Test YouTube video support'
  },
  {
    name: 'Vimeo Video',
    url: 'https://vimeo.com/90509568',
    description: 'Test Vimeo video support'
  }
];

export default function VideoPlayerTest() {
  const [selectedVideo, setSelectedVideo] = useState(TEST_VIDEOS[0]);
  const [customUrl, setCustomUrl] = useState('');
  const [isCustom, setIsCustom] = useState(false);

  const handleDownload = () => {
    const url = isCustom ? customUrl : selectedVideo.url;
    const link = document.createElement('a');
    link.href = url;
    link.download = isCustom ? 'custom-video.mp4' : `${selectedVideo.name}.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCustomUrlTest = () => {
    if (customUrl.trim()) {
      setIsCustom(true);
    }
  };

  const handlePresetTest = (video: typeof TEST_VIDEOS[0]) => {
    setSelectedVideo(video);
    setIsCustom(false);
  };

  const currentUrl = isCustom ? customUrl : selectedVideo.url;
  const currentTitle = isCustom ? 'Custom Video' : selectedVideo.name;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TestTube className="h-5 w-5" />
            Video Player Test Suite
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Test Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Preset Videos */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Test with Preset Videos:</Label>
              {TEST_VIDEOS.map((video, index) => (
                <Button
                  key={index}
                  variant={!isCustom && selectedVideo.url === video.url ? "default" : "outline"}
                  size="sm"
                  onClick={() => handlePresetTest(video)}
                  className="w-full justify-start"
                >
                  <Video className="h-4 w-4 mr-2" />
                  {video.name}
                </Button>
              ))}
            </div>

            {/* Custom URL */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Test with Custom URL:</Label>
              <div className="space-y-2">
                <Input
                  placeholder="Enter video URL (MP4, YouTube, Vimeo, etc.)..."
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
                <strong>Description:</strong> {selectedVideo.description}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Video Player */}
      {currentUrl && (
        <VideoPlayer
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
              <label htmlFor="load">Video loads successfully</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="play-pause" />
              <label htmlFor="play-pause">Play/pause controls work</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="volume" />
              <label htmlFor="volume">Volume controls work</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="seek" />
              <label htmlFor="seek">Seek/progress bar works</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="skip" />
              <label htmlFor="skip">Skip forward/backward works</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="speed" />
              <label htmlFor="speed">Playback speed controls work</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="fullscreen" />
              <label htmlFor="fullscreen">Fullscreen mode works</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="restart" />
              <label htmlFor="restart">Restart button works</label>
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
