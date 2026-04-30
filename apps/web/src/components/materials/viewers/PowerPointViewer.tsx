"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Download, 
  ExternalLink, 
  FileText,
  AlertCircle,
  Maximize2
} from 'lucide-react';

interface PowerPointViewerProps {
  url: string;
  title?: string;
  onDownload?: () => void;
}

export function PowerPointViewer({ url, title, onDownload }: PowerPointViewerProps) {
  const [viewerError, setViewerError] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Check if URL is localhost/local development
  const isLocalUrl = url.includes('localhost') || url.includes('127.0.0.1') || url.includes('192.168.') || url.includes('10.0.') || url.includes('172.');

  // Office Online viewer URL for PowerPoint files
  const getOfficeViewerUrl = (fileUrl: string) => {
    // Microsoft Office Online viewer
    return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`;
  };

  // Google Docs viewer as fallback
  const getGoogleViewerUrl = (fileUrl: string) => {
    return `https://docs.google.com/gview?url=${encodeURIComponent(fileUrl)}&embedded=true`;
  };

  const handleIframeError = () => {
    setViewerError(true);
  };

  // Auto-set error state for local URLs since external viewers can't access them
  useEffect(() => {
    if (isLocalUrl) {
      setViewerError(true);
    }
  }, [isLocalUrl]);

  const openInNewTab = () => {
    window.open(url, '_blank');
  };

  const toggleFullscreen = () => {
    setIsFullscreen(prev => !prev);
  };

  const containerClass = isFullscreen 
    ? "fixed inset-0 z-50 bg-white"
    : "w-full";

  return (
    <Card className={containerClass}>
      <CardHeader className={isFullscreen ? "border-b" : ""}>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 truncate">
            <FileText className="h-5 w-5 text-orange-500" />
            {title || 'PowerPoint Presentation'}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={openInNewTab}
              title="Open in new tab"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Open
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              <Maximize2 className="h-4 w-4" />
            </Button>

            {onDownload && (
              <Button variant="outline" size="sm" onClick={onDownload}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
            )}

            {isFullscreen && (
              <Button
                variant="outline"
                size="sm"
                onClick={toggleFullscreen}
              >
                ✕
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className={isFullscreen ? "p-0 h-full" : "space-y-4"}>
        {viewerError ? (
          <div className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {isLocalUrl
                  ? "PowerPoint presentations cannot be displayed in the browser during local development. External viewers like Microsoft Office Online require publicly accessible URLs."
                  : "Unable to display the PowerPoint presentation in the browser. This might be due to file format restrictions or network issues."
                }
              </AlertDescription>
            </Alert>

            <div className="text-center space-y-4 py-8">
              <div className="text-6xl mb-4">📊</div>
              <h3 className="text-lg font-medium">PowerPoint Presentation</h3>
              <p className="text-gray-600 max-w-md mx-auto">
                {isLocalUrl
                  ? "During local development, download the file to view it in PowerPoint or a compatible application."
                  : "To view this presentation, you can download it or open it in a new tab where your browser might be able to display it directly."
                }
              </p>
              
              <div className="flex justify-center gap-4">
                <Button onClick={openInNewTab} variant="outline">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open in New Tab
                </Button>
                {onDownload && (
                  <Button onClick={onDownload}>
                    <Download className="h-4 w-4 mr-2" />
                    Download File
                  </Button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className={`relative ${isFullscreen ? "h-full" : "h-[600px]"} bg-gray-50 rounded-lg overflow-hidden`}>
            {/* Try Office Online viewer first */}
            <iframe
              src={getOfficeViewerUrl(url)}
              width="100%"
              height="100%"
              frameBorder="0"
              title={title || 'PowerPoint Presentation'}
              onError={handleIframeError}
              className="border-0"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            />
            
            {/* Fallback message */}
            <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-90 opacity-0 hover:opacity-100 transition-opacity duration-300 pointer-events-none">
              <div className="text-center space-y-2">
                <p className="text-sm text-gray-600">
                  If the presentation doesn't load, try opening it in a new tab
                </p>
                <Button 
                  onClick={openInNewTab} 
                  size="sm" 
                  variant="outline"
                  className="pointer-events-auto"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open in New Tab
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Alternative viewers section */}
        {!isFullscreen && (
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium mb-2">Alternative Viewers</h4>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(getOfficeViewerUrl(url), '_blank')}
              >
                Microsoft Office Online
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(getGoogleViewerUrl(url), '_blank')}
              >
                Google Docs Viewer
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={openInNewTab}
              >
                Direct Link
              </Button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Different viewers may have varying compatibility with PowerPoint features.
            </p>
          </div>
        )}

        {/* File info */}
        {!isFullscreen && (
          <div className="text-sm text-gray-500 text-center border-t pt-4">
            <p>
              PowerPoint presentations are best viewed in Microsoft PowerPoint or compatible applications.
              Some advanced features may not display correctly in web viewers.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
