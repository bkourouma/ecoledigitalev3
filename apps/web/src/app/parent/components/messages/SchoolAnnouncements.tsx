'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Megaphone, Calendar, User, Filter, AlertCircle, Bell, Clock } from 'lucide-react';
import { SchoolAnnouncement, AnnouncementFilter } from '@ecoledigitale/contracts';

interface SchoolAnnouncementsProps {
  announcements: SchoolAnnouncement[] | null;
  isLoading?: boolean;
  error?: Error | null;
  filters?: AnnouncementFilter;
  onFiltersChange?: (filters: AnnouncementFilter) => void;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  onPageChange?: (page: number) => void;
  onAnnouncementClick?: (announcement: SchoolAnnouncement) => void;
  onMarkAsRead?: (announcementId: string) => void;
}

export function SchoolAnnouncements({ 
  announcements, 
  isLoading, 
  error,
  filters = {},
  onFiltersChange,
  pagination,
  onPageChange,
  onAnnouncementClick,
  onMarkAsRead
}: SchoolAnnouncementsProps) {
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<SchoolAnnouncement | null>(null);

  // Handle filter change
  const handleFilterChange = (key: keyof AnnouncementFilter, value: string | undefined) => {
    const newFilters = { ...filters, [key]: value || undefined };
    if (onFiltersChange) {
      onFiltersChange(newFilters);
    }
  };

  // Reset filters
  const handleResetFilters = () => {
    const resetFilters: AnnouncementFilter = {
      startDate: undefined,
      endDate: undefined,
      priorityLevel: undefined,
      readStatus: undefined,
    };
    if (onFiltersChange) {
      onFiltersChange(resetFilters);
    }
  };

  // Format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Get priority badge
  const getPriorityBadge = (priorityLevel?: string | null) => {
    if (!priorityLevel) return null;
    
    switch (priorityLevel) {
      case 'urgent':
        return <Badge className="bg-red-100 text-red-800">Urgent</Badge>;
      case 'high':
        return <Badge className="bg-orange-100 text-orange-800">Élevé</Badge>;
      case 'normal':
        return <Badge className="bg-blue-100 text-blue-800">Normal</Badge>;
      case 'low':
        return <Badge className="bg-green-100 text-green-800">Faible</Badge>;
      default:
        return null;
    }
  };

  // Get content preview
  const getContentPreview = (content: string, maxLength: number = 150) => {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  };

  // Handle announcement click
  const handleAnnouncementClick = (announcement: SchoolAnnouncement) => {
    setSelectedAnnouncement(announcement);
    if (onAnnouncementClick) {
      onAnnouncementClick(announcement);
    }
    // Mark as read if unread
    if (!announcement.isRead && onMarkAsRead) {
      onMarkAsRead(announcement.id);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-emerald-600" />
            Annonces de l'École
          </CardTitle>
          <CardDescription>
            Annonces et communications de l'école
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-emerald-600" />
            Annonces de l'École
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
            <p className="text-red-600 font-medium mb-2">Erreur lors du chargement des annonces</p>
            <p className="text-gray-600 text-sm">{error.message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (!announcements || announcements.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-emerald-600" />
            Annonces de l'École
          </CardTitle>
          <CardDescription>
            Annonces et communications de l'école
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-6 space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">Filtres</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Select
                value={filters.readStatus || 'all'}
                onValueChange={(value) => handleFilterChange('readStatus', value === 'all' ? undefined : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Statut de lecture" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  <SelectItem value="read">Lu</SelectItem>
                  <SelectItem value="unread">Non lu</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={filters.priorityLevel || 'all'}
                onValueChange={(value) => handleFilterChange('priorityLevel', value === 'all' ? undefined : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Niveau de priorité" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="high">Élevé</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="low">Faible</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="date"
                placeholder="Date de début"
                value={filters.startDate || ''}
                onChange={(e) => handleFilterChange('startDate', e.target.value || undefined)}
              />
              <Input
                type="date"
                placeholder="Date de fin"
                value={filters.endDate || ''}
                onChange={(e) => handleFilterChange('endDate', e.target.value || undefined)}
              />
            </div>
            {(filters.readStatus || filters.priorityLevel || filters.startDate || filters.endDate) && (
              <Button variant="outline" onClick={handleResetFilters} className="mt-2">
                Réinitialiser les filtres
              </Button>
            )}
          </div>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Bell className="h-12 w-12 text-gray-400 mb-4" />
            <p className="text-gray-600 font-medium mb-2">Aucune annonce</p>
            <p className="text-gray-500 text-sm">Il n'y a pas encore d'annonces de l'école</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-emerald-600" />
          Annonces de l'École
        </CardTitle>
        <CardDescription>
          Annonces et communications de l'école
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="mb-6 space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="h-4 w-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Filtres</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Select
              value={filters.readStatus || 'all'}
              onValueChange={(value) => handleFilterChange('readStatus', value === 'all' ? undefined : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Statut de lecture" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="read">Lu</SelectItem>
                <SelectItem value="unread">Non lu</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={filters.priorityLevel || 'all'}
              onValueChange={(value) => handleFilterChange('priorityLevel', value === 'all' ? undefined : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Niveau de priorité" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="high">Élevé</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="low">Faible</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              placeholder="Date de début"
              value={filters.startDate || ''}
              onChange={(e) => handleFilterChange('startDate', e.target.value || undefined)}
            />
            <Input
              type="date"
              placeholder="Date de fin"
              value={filters.endDate || ''}
              onChange={(e) => handleFilterChange('endDate', e.target.value || undefined)}
            />
          </div>
          {(filters.readStatus || filters.priorityLevel || filters.startDate || filters.endDate) && (
            <Button variant="outline" onClick={handleResetFilters} className="mt-2">
              Réinitialiser les filtres
            </Button>
          )}
        </div>

        {/* Announcements List */}
        <div className="space-y-4">
          {announcements.map((announcement) => (
            <div
              key={announcement.id}
              onClick={() => handleAnnouncementClick(announcement)}
              className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                announcement.isRead
                  ? 'bg-white border-gray-200 hover:border-gray-300'
                  : 'bg-blue-50 border-blue-200 hover:border-blue-300'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900">{announcement.title}</h3>
                    {!announcement.isRead && (
                      <Badge className="bg-blue-100 text-blue-800">Nouveau</Badge>
                    )}
                    {getPriorityBadge(announcement.priorityLevel)}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-600 mb-2">
                    <div className="flex items-center gap-1">
                      <User className="h-4 w-4" />
                      <span>{announcement.authorName}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      <span>{formatDate(announcement.postedAt)}</span>
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-gray-700 text-sm">{getContentPreview(announcement.content)}</p>
            </div>
          ))}
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t">
            <div className="text-sm text-gray-600">
              Page {pagination.page} sur {pagination.totalPages} ({pagination.total} annonces)
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPageChange && onPageChange(pagination.page - 1)}
                disabled={pagination.page === 1}
              >
                Précédent
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPageChange && onPageChange(pagination.page + 1)}
                disabled={pagination.page === pagination.totalPages}
              >
                Suivant
              </Button>
            </div>
          </div>
        )}

        {/* Announcement Detail Modal */}
        {selectedAnnouncement && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">{selectedAnnouncement.title}</h2>
                    <div className="flex items-center gap-4 text-sm text-gray-600 mb-4">
                      <div className="flex items-center gap-1">
                        <User className="h-4 w-4" />
                        <span>Par: {selectedAnnouncement.authorName}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        <span>{formatDate(selectedAnnouncement.postedAt)}</span>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedAnnouncement(null)}
                  >
                    ×
                  </Button>
                </div>
                <div className="mb-4">
                  {getPriorityBadge(selectedAnnouncement.priorityLevel)}
                </div>
                <div className="prose max-w-none">
                  <p className="text-gray-700 whitespace-pre-wrap">{selectedAnnouncement.content}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

