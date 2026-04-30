"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { 
  Search, 
  Filter, 
  Grid, 
  List, 
  Download, 
  Eye, 
  Trash2, 
  MoreVertical,
  FileText,
  Image,
  Video,
  File,
  Calendar,
  User,
  HardDrive
} from 'lucide-react';
import { MaterialWithMetadata, getFileCategory } from '@ecoledigitale/contracts';

interface MaterialsListProps {
  materials: MaterialWithMetadata[];
  loading?: boolean;
  onView?: (material: MaterialWithMetadata) => void;
  onDownload?: (material: MaterialWithMetadata) => void;
  onDelete?: (material: MaterialWithMetadata) => void;
  onRefresh?: () => void;
}

type ViewMode = 'grid' | 'list';
type SortBy = 'createdAt' | 'title' | 'fileSize';
type SortOrder = 'asc' | 'desc';

const getFileIcon = (fileType: string, className = "h-5 w-5") => {
  const category = getFileCategory(fileType);
  switch (category) {
    case 'document':
      return <FileText className={`${className} text-red-500`} />;
    case 'image':
      return <Image className={`${className} text-green-500`} />;
    case 'video':
      return <Video className={`${className} text-blue-500`} />;
    default:
      return <File className={`${className} text-gray-500`} />;
  }
};

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatDate = (dateString: string): string => {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (error) {
    console.error('Date formatting error:', error, 'for date:', dateString);
    return 'Invalid date';
  }
};

const getProcessingStatusBadge = (status: string) => {
  switch (status) {
    case 'completed':
      return <Badge variant="default" className="bg-green-100 text-green-800">Completed</Badge>;
    case 'processing':
      return <Badge variant="default" className="bg-blue-100 text-blue-800">Processing</Badge>;
    case 'pending':
      return <Badge variant="secondary">Pending</Badge>;
    case 'failed':
      return <Badge variant="destructive">Failed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
};

export function MaterialsList({ 
  materials, 
  loading = false, 
  onView, 
  onDownload, 
  onDelete,
  onRefresh 
}: MaterialsListProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [fileTypeFilter, setFileTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortBy>('createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [materialToDelete, setMaterialToDelete] = useState<MaterialWithMetadata | null>(null);

  // Filter and sort materials
  const filteredMaterials = materials
    .filter(material => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (!material.title.toLowerCase().includes(query) && 
            !material.fileName.toLowerCase().includes(query)) {
          return false;
        }
      }

      // File type filter
      if (fileTypeFilter !== 'all') {
        const category = getFileCategory(material.fileType);
        if (category !== fileTypeFilter) {
          return false;
        }
      }

      // Status filter
      if (statusFilter !== 'all' && material.processingStatus !== statusFilter) {
        return false;
      }

      return true;
    })
    .sort((a, b) => {
      let aValue: any, bValue: any;
      
      switch (sortBy) {
        case 'title':
          aValue = a.title.toLowerCase();
          bValue = b.title.toLowerCase();
          break;
        case 'fileSize':
          aValue = a.fileSize;
          bValue = b.fileSize;
          break;
        case 'createdAt':
        default:
          aValue = new Date(a.createdAt);
          bValue = new Date(b.createdAt);
          break;
      }

      if (sortOrder === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });

  const handleDelete = (material: MaterialWithMetadata) => {
    setMaterialToDelete(material);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (materialToDelete && onDelete) {
      onDelete(materialToDelete);
    }
    setDeleteDialogOpen(false);
    setMaterialToDelete(null);
  };

  const uniqueFileTypes = Array.from(new Set(materials.map(m => getFileCategory(m.fileType))));

  return (
    <div className="space-y-6">
      {/* Header with controls */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Course Materials</h2>
          <p className="text-gray-600">{filteredMaterials.length} of {materials.length} materials</p>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant={viewMode === 'grid' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('grid')}
          >
            <Grid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'list' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('list')}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Filters and search */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search materials..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        
        <Select value={fileTypeFilter} onValueChange={setFileTypeFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="File type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {uniqueFileTypes.map(type => (
              <SelectItem key={type} value={type}>
                {type.charAt(0).toUpperCase() + type.slice(1)}s
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={`${sortBy}-${sortOrder}`} onValueChange={(value) => {
          const [field, order] = value.split('-');
          setSortBy(field as SortBy);
          setSortOrder(order as SortOrder);
        }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="createdAt-desc">Newest first</SelectItem>
            <SelectItem value="createdAt-asc">Oldest first</SelectItem>
            <SelectItem value="title-asc">Title A-Z</SelectItem>
            <SelectItem value="title-desc">Title Z-A</SelectItem>
            <SelectItem value="fileSize-desc">Largest first</SelectItem>
            <SelectItem value="fileSize-asc">Smallest first</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Materials grid/list */}
      {loading ? (
        <div className="text-center py-8">
          <p>Loading materials...</p>
        </div>
      ) : filteredMaterials.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-500">No materials found</p>
        </div>
      ) : (
        <div className={
          viewMode === 'grid' 
            ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            : "space-y-4"
        }>
          {filteredMaterials.map((material) => (
            <MaterialCard
              key={material.id}
              material={material}
              viewMode={viewMode}
              onView={onView}
              onDownload={onDownload}
              onDelete={() => handleDelete(material)}
            />
          ))}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Material</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{materialToDelete?.title}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface MaterialCardProps {
  material: MaterialWithMetadata;
  viewMode: ViewMode;
  onView?: (material: MaterialWithMetadata) => void;
  onDownload?: (material: MaterialWithMetadata) => void;
  onDelete?: () => void;
}

function MaterialCard({ material, viewMode, onView, onDownload, onDelete }: MaterialCardProps) {
  if (viewMode === 'list') {
    return (
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            {getFileIcon(material.fileType, "h-8 w-8")}
            
            <div className="flex-1 min-w-0">
              <h3 className="font-medium truncate">{material.title}</h3>
              <p className="text-sm text-gray-500 truncate">{material.fileName}</p>
            </div>

            <div className="flex items-center gap-4 text-sm text-gray-500">
              <span className="flex items-center gap-1">
                <HardDrive className="h-4 w-4" />
                {formatFileSize(material.fileSize)}
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {formatDate(material.createdAt)}
              </span>
              <span className="flex items-center gap-1">
                <User className="h-4 w-4" />
                {material.uploadedByName}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {getProcessingStatusBadge(material.processingStatus)}
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {onView && (
                    <DropdownMenuItem onClick={() => onView(material)}>
                      <Eye className="h-4 w-4 mr-2" />
                      View
                    </DropdownMenuItem>
                  )}
                  {onDownload && (
                    <DropdownMenuItem onClick={() => onDownload(material)}>
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </DropdownMenuItem>
                  )}
                  {material.canDelete && onDelete && (
                    <DropdownMenuItem onClick={onDelete} className="text-red-600">
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => onView?.(material)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          {getFileIcon(material.fileType, "h-8 w-8")}
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="sm">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onView && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onView(material); }}>
                  <Eye className="h-4 w-4 mr-2" />
                  View
                </DropdownMenuItem>
              )}
              {onDownload && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDownload(material); }}>
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </DropdownMenuItem>
              )}
              {material.canDelete && onDelete && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-red-600">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <CardTitle className="text-lg truncate">{material.title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-3">
          <p className="text-sm text-gray-500 truncate">{material.fileName}</p>
          
          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>{formatFileSize(material.fileSize)}</span>
            {getProcessingStatusBadge(material.processingStatus)}
          </div>
          
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <Calendar className="h-3 w-3" />
            {formatDate(material.createdAt)}
          </div>
          
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <User className="h-3 w-3" />
            {material.uploadedByName}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
