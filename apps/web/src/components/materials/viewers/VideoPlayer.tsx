"use client";

import React, { useState, useRef } from 'react';
import ReactPlayer from 'react-player';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { 
  Play, 
  Pause, 
  Volume2, 
  VolumeX, 
  Maximize2,
  Download,
  SkipBack,
  SkipForward,
  RotateCcw,
  Settings
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface VideoPlayerProps {
  url: string;
  title?: string;
  onDownload?: () => void;
}

export function VideoPlayer({ url, title, onDownload }: VideoPlayerProps) {
  const [playing, setPlaying] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(0.8);
  const [muted, setMuted] = useState<boolean>(false);
  const [played, setPlayed] = useState<number>(0);
  const [loaded, setLoaded] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [seeking, setSeeking] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showControls, setShowControls] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const playerRef = useRef<ReactPlayer>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handlePlayPause = () => {
    setPlaying(prev => !prev);
  };

  const handleProgress = (state: { played: number; loaded: number }) => {
    if (!seeking) {
      setPlayed(state.played);
      setLoaded(state.loaded);
    }
  };

  const handleSeekMouseDown = () => {
    setSeeking(true);
  };

  const handleSeekChange = (value: number[]) => {
    setPlayed(value[0] / 100);
  };

  const handleSeekMouseUp = (value: number[]) => {
    setSeeking(false);
    if (playerRef.current) {
      playerRef.current.seekTo(value[0] / 100);
    }
  };

  const handleVolumeChange = (value: number[]) => {
    setVolume(value[0] / 100);
    setMuted(value[0] === 0);
  };

  const handleMute = () => {
    setMuted(prev => !prev);
  };

  const handleDuration = (duration: number) => {
    setDuration(duration);
  };

  const handleSkipBack = () => {
    if (playerRef.current) {
      const currentTime = playerRef.current.getCurrentTime();
      playerRef.current.seekTo(Math.max(0, currentTime - 10));
    }
  };

  const handleSkipForward = () => {
    if (playerRef.current) {
      const currentTime = playerRef.current.getCurrentTime();
      playerRef.current.seekTo(Math.min(duration, currentTime + 10));
    }
  };

  const handleRestart = () => {
    if (playerRef.current) {
      playerRef.current.seekTo(0);
      setPlaying(true);
    }
  };

  const handlePlaybackRateChange = (rate: number) => {
    setPlaybackRate(rate);
  };

  const handleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (playing && isFullscreen) {
        setShowControls(false);
      }
    }, 3000);
  };

  const handleError = (error: any) => {
    setError('Failed to load video. Please check the video format and try again.');
    console.error('Video player error:', error);
  };

  const formatTime = (seconds: number): string => {
    const date = new Date(seconds * 1000);
    const hh = date.getUTCHours();
    const mm = date.getUTCMinutes();
    const ss = date.getUTCSeconds().toString().padStart(2, '0');
    if (hh) {
      return `${hh}:${mm.toString().padStart(2, '0')}:${ss}`;
    }
    return `${mm}:${ss}`;
  };

  const playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 2];

  return (
    <Card className={isFullscreen ? "fixed inset-0 z-50 bg-black border-none rounded-none" : "w-full"}>
      <CardHeader className={isFullscreen && !showControls ? "hidden" : ""}>
        <div className="flex items-center justify-between">
          <CardTitle className={`truncate ${isFullscreen ? "text-white" : ""}`}>
            {title || 'Video'}
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
      
      <CardContent className={isFullscreen ? "p-0 h-full flex flex-col" : "space-y-4"}>
        {error ? (
          <div className="flex items-center justify-center h-64 text-red-500">
            <div className="text-center">
              <div className="text-4xl mb-2">🎥</div>
              <p>{error}</p>
            </div>
          </div>
        ) : (
          <div 
            ref={containerRef}
            className={`relative ${isFullscreen ? "flex-1" : "aspect-video"} bg-black rounded-lg overflow-hidden`}
            onMouseMove={handleMouseMove}
          >
            <ReactPlayer
              ref={playerRef}
              url={url}
              width="100%"
              height="100%"
              playing={playing}
              volume={volume}
              muted={muted}
              playbackRate={playbackRate}
              onProgress={handleProgress}
              onDuration={handleDuration}
              onError={handleError}
              onEnded={() => setPlaying(false)}
              config={{
                file: {
                  attributes: {
                    controlsList: 'nodownload',
                  },
                },
              }}
            />

            {/* Custom Controls Overlay */}
            <div 
              className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 transition-opacity duration-300 ${
                showControls || !playing ? 'opacity-100' : 'opacity-0'
              }`}
            >
              {/* Progress Bar */}
              <div className="mb-4">
                <Slider
                  value={[played * 100]}
                  onValueChange={handleSeekChange}
                  onValueCommit={handleSeekMouseUp}
                  onPointerDown={handleSeekMouseDown}
                  max={100}
                  step={0.1}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-white mt-1">
                  <span>{formatTime(duration * played)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              {/* Control Buttons */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handlePlayPause}
                    className="text-white hover:bg-white/20"
                  >
                    {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSkipBack}
                    className="text-white hover:bg-white/20"
                  >
                    <SkipBack className="h-4 w-4" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSkipForward}
                    className="text-white hover:bg-white/20"
                  >
                    <SkipForward className="h-4 w-4" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRestart}
                    className="text-white hover:bg-white/20"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>

                  {/* Volume Control */}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleMute}
                      className="text-white hover:bg-white/20"
                    >
                      {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                    </Button>
                    <Slider
                      value={[muted ? 0 : volume * 100]}
                      onValueChange={handleVolumeChange}
                      max={100}
                      step={1}
                      className="w-20"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Playback Speed */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-white hover:bg-white/20"
                      >
                        <Settings className="h-4 w-4 mr-1" />
                        {playbackRate}x
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {playbackRates.map(rate => (
                        <DropdownMenuItem
                          key={rate}
                          onClick={() => handlePlaybackRateChange(rate)}
                          className={playbackRate === rate ? "bg-gray-100" : ""}
                        >
                          {rate}x
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Fullscreen */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleFullscreen}
                    className="text-white hover:bg-white/20"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Video Info */}
        {!isFullscreen && !error && (
          <div className="text-sm text-gray-500 text-center">
            Duration: {formatTime(duration)} • 
            Playback Rate: {playbackRate}x • 
            Volume: {Math.round((muted ? 0 : volume) * 100)}%
          </div>
        )}
      </CardContent>
    </Card>
  );
}
