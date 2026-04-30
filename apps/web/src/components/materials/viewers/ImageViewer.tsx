"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  ZoomIn, 
  ZoomOut, 
  RotateCw, 
  Download, 
  Maximize2,
  Minimize2,
  Move,
  RotateCcw,
  RefreshCw
} from 'lucide-react';

interface ImageViewerProps {
  url: string;
  title?: string;
  alt?: string;
  onDownload?: () => void;
}

export function ImageViewer({ url, title, alt, onDownload }: ImageViewerProps) {
  const [scale, setScale] = useState<number>(1.0);
  const [rotation, setRotation] = useState<number>(0);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [imageLoaded, setImageLoaded] = useState<boolean>(false);
  const [imageError, setImageError] = useState<boolean>(false);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const zoomIn = () => {
    setScale(prev => Math.min(5.0, prev + 0.2));
  };

  const zoomOut = () => {
    setScale(prev => Math.max(0.1, prev - 0.2));
  };

  const resetZoom = () => {
    setScale(1.0);
    setPosition({ x: 0, y: 0 });
  };

  const fitToScreen = () => {
    if (!containerRef.current || !imageRef.current) return;
    
    const container = containerRef.current.getBoundingClientRect();
    const containerWidth = container.width - 40; // Account for padding
    const containerHeight = container.height - 40;
    
    const scaleX = containerWidth / naturalSize.width;
    const scaleY = containerHeight / naturalSize.height;
    const newScale = Math.min(scaleX, scaleY, 1.0); // Don't scale up beyond 100%
    
    setScale(newScale);
    setPosition({ x: 0, y: 0 });
  };

  const rotateClockwise = () => {
    setRotation(prev => (prev + 90) % 360);
  };

  const rotateCounterClockwise = () => {
    setRotation(prev => (prev - 90 + 360) % 360);
  };

  const resetRotation = () => {
    setRotation(0);
  };

  const toggleFullscreen = () => {
    setIsFullscreen(prev => !prev);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale > 1.0) {
      setIsDragging(true);
      setDragStart({
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && scale > 1.0) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      zoomIn();
    } else {
      zoomOut();
    }
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
    setImageLoaded(true);
    setImageError(false);
  };

  const handleImageError = () => {
    setImageError(true);
    setImageLoaded(false);
  };

  // Reset position when scale changes to prevent image from going off-screen
  useEffect(() => {
    if (scale <= 1.0) {
      setPosition({ x: 0, y: 0 });
    }
  }, [scale]);

  const imageStyle = {
    transform: `translate(${position.x}px, ${position.y}px) scale(${scale}) rotate(${rotation}deg)`,
    cursor: scale > 1.0 ? (isDragging ? 'grabbing' : 'grab') : 'default',
    transition: isDragging ? 'none' : 'transform 0.2s ease-out',
  };

  const containerClass = isFullscreen 
    ? "fixed inset-0 z-50 bg-black bg-opacity-90 flex items-center justify-center"
    : "border rounded-lg overflow-hidden bg-gray-50 min-h-[400px] flex items-center justify-center relative";

  return (
    <Card className={isFullscreen ? "border-none shadow-none bg-transparent" : "w-full"}>
      <CardHeader className={isFullscreen ? "absolute top-4 left-4 z-10 bg-black bg-opacity-50 rounded-lg" : ""}>
        <div className="flex items-center justify-between">
          <CardTitle className={`truncate ${isFullscreen ? "text-white" : ""}`}>
            {title || 'Image'}
          </CardTitle>
          <div className="flex items-center gap-2">
            {onDownload && (
              <Button 
                variant={isFullscreen ? "secondary" : "outline"} 
                size="sm" 
                onClick={onDownload}
              >
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className={isFullscreen ? "p-0 w-full h-full" : "space-y-4"}>
        {/* Toolbar */}
        <div className={`flex flex-wrap items-center gap-2 p-2 rounded-lg ${
          isFullscreen 
            ? "absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10 bg-black bg-opacity-50" 
            : "bg-gray-100"
        }`}>
          {/* Zoom controls */}
          <div className="flex items-center gap-1">
            <Button
              variant={isFullscreen ? "secondary" : "outline"}
              size="sm"
              onClick={zoomOut}
              disabled={scale <= 0.1}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            
            <Button
              variant={isFullscreen ? "secondary" : "outline"}
              size="sm"
              onClick={resetZoom}
              className="min-w-[60px]"
            >
              {Math.round(scale * 100)}%
            </Button>
            
            <Button
              variant={isFullscreen ? "secondary" : "outline"}
              size="sm"
              onClick={zoomIn}
              disabled={scale >= 5.0}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>

            <Button
              variant={isFullscreen ? "secondary" : "outline"}
              size="sm"
              onClick={fitToScreen}
              title="Fit to screen"
            >
              <Minimize2 className="h-4 w-4" />
            </Button>
          </div>

          {/* Rotation controls */}
          <div className="flex items-center gap-1">
            <Button
              variant={isFullscreen ? "secondary" : "outline"}
              size="sm"
              onClick={rotateCounterClockwise}
              title="Rotate counter-clockwise"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            
            <Button
              variant={isFullscreen ? "secondary" : "outline"}
              size="sm"
              onClick={rotateClockwise}
              title="Rotate clockwise"
            >
              <RotateCw className="h-4 w-4" />
            </Button>

            {rotation !== 0 && (
              <Button
                variant={isFullscreen ? "secondary" : "outline"}
                size="sm"
                onClick={resetRotation}
                title="Reset rotation"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Fullscreen toggle */}
          <Button
            variant={isFullscreen ? "secondary" : "outline"}
            size="sm"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>

          {/* Pan indicator */}
          {scale > 1.0 && (
            <div className={`flex items-center gap-1 text-sm ${isFullscreen ? "text-white" : "text-gray-600"}`}>
              <Move className="h-4 w-4" />
              <span>Drag to pan</span>
            </div>
          )}
        </div>

        {/* Image container */}
        <div 
          ref={containerRef}
          className={containerClass}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          {imageError ? (
            <div className="text-center text-gray-500">
              <div className="text-4xl mb-2">🖼️</div>
              <p>Failed to load image</p>
            </div>
          ) : (
            <img
              ref={imageRef}
              src={url}
              alt={alt || title || 'Image'}
              style={imageStyle}
              onLoad={handleImageLoad}
              onError={handleImageError}
              className="max-w-none select-none"
              draggable={false}
            />
          )}

          {/* Close fullscreen overlay */}
          {isFullscreen && (
            <Button
              variant="secondary"
              size="sm"
              onClick={toggleFullscreen}
              className="absolute top-4 right-4 z-10"
            >
              ✕
            </Button>
          )}
        </div>

        {/* Image info */}
        {imageLoaded && !isFullscreen && (
          <div className="text-sm text-gray-500 text-center">
            {naturalSize.width} × {naturalSize.height} pixels • 
            Zoom: {Math.round(scale * 100)}%
            {rotation > 0 && ` • Rotated: ${rotation}°`}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
