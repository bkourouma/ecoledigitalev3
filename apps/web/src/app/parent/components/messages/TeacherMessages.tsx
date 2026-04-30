'use client';

import React, { useState, memo, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { MessageSquare, Calendar, User, Filter, AlertCircle, Mail, Clock, RefreshCw } from 'lucide-react';
import { TeacherMessage, MessageFilter } from '@ecoledigitale/contracts';
import { MessageListSkeleton } from './MessageListSkeleton';
import { useQueryClient } from '@tanstack/react-query';

interface TeacherMessagesProps {
  messages: TeacherMessage[] | null;
  isLoading?: boolean;
  error?: Error | null;
  children?: Array<{ id: string; name: string }>;
  teachers?: Array<{ id: string; name: string }>;
  filters?: MessageFilter;
  onFiltersChange?: (filters: MessageFilter) => void;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  onPageChange?: (page: number) => void;
  onMessageClick?: (message: TeacherMessage) => void;
  onMarkAsRead?: (messageId: string) => void;
}

export const TeacherMessages = memo(function TeacherMessages({ 
  messages, 
  isLoading, 
  error,
  children,
  teachers,
  filters = {},
  onFiltersChange,
  pagination,
  onPageChange,
  onMessageClick,
  onMarkAsRead
}: TeacherMessagesProps) {
  const [selectedMessage, setSelectedMessage] = useState<TeacherMessage | null>(null);
  const queryClient = useQueryClient();

  // Retry function
  const handleRetry = () => {
    queryClient?.invalidateQueries({ queryKey: ['parent-teacher-messages'] });
  };

  // Handle filter change
  const handleFilterChange = (key: keyof MessageFilter, value: string | undefined) => {
    const newFilters = { ...filters, [key]: value || undefined };
    if (onFiltersChange) {
      onFiltersChange(newFilters);
    }
  };

  // Reset filters
  const handleResetFilters = () => {
    const resetFilters: MessageFilter = {
      childId: undefined,
      teacherId: undefined,
      startDate: undefined,
      endDate: undefined,
      readStatus: undefined,
      priorityLevel: undefined,
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
  const getContentPreview = (content: string, maxLength: number = 100) => {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  };

  // Handle message click
  const handleMessageClick = (message: TeacherMessage) => {
    setSelectedMessage(message);
    if (onMessageClick) {
      onMessageClick(message);
    }
    // Mark as read if unread
    if (!message.isRead && onMarkAsRead) {
      onMarkAsRead(message.id);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <MessageListSkeleton
        title="Messages des Enseignants"
        description="Messages reçus des enseignants pour vos enfants"
        itemCount={3}
      />
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2" id="error-title">
            <MessageSquare className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            Messages des Enseignants
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center" role="alert" aria-labelledby="error-title">
            <AlertCircle className="h-12 w-12 text-red-500 mb-4" aria-hidden="true" />
            <p className="text-red-600 font-medium mb-2">Erreur lors du chargement des messages</p>
            <p className="text-gray-600 text-sm mb-4">{error.message}</p>
            <Button onClick={handleRetry} variant="outline" className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Réessayer
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (!messages || messages.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-emerald-600" />
            Messages des Enseignants
          </CardTitle>
          <CardDescription>
            Messages reçus des enseignants pour vos enfants
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
              {children && children.length > 0 && (
                <Select
                  value={filters.childId || 'all'}
                  onValueChange={(value) => handleFilterChange('childId', value === 'all' ? undefined : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Tous les enfants" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les enfants</SelectItem>
                    {children.map((child, index) => (
                      <SelectItem key={`teacher-messages-child-${index}`} value={child.id}>
                        {child.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
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
            {(filters.childId || filters.readStatus || filters.startDate || filters.endDate) && (
              <Button variant="outline" onClick={handleResetFilters} className="mt-2">
                Réinitialiser les filtres
              </Button>
            )}
          </div>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Mail className="h-12 w-12 text-gray-400 mb-4" />
            <p className="text-gray-600 font-medium mb-2">Aucun message</p>
            <p className="text-gray-500 text-sm">Vous n'avez pas encore reçu de messages des enseignants</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2" id="messages-title">
          <MessageSquare className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          Messages des Enseignants
        </CardTitle>
        <CardDescription>
          Messages reçus des enseignants pour vos enfants
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="mb-6 space-y-4" role="search" aria-label="Filtres des messages">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="h-4 w-4 text-gray-500" aria-hidden="true" />
            <span className="text-sm font-medium text-gray-700">Filtres</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {children && children.length > 0 && (
              <Select
                value={filters.childId || 'all'}
                onValueChange={(value) => handleFilterChange('childId', value === 'all' ? undefined : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Tous les enfants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les enfants</SelectItem>
                  {children.map((child, index) => (
                    <SelectItem key={`teacher-messages-child-${index}`} value={child.id}>
                      {child.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
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
          {(filters.childId || filters.readStatus || filters.startDate || filters.endDate) && (
            <Button variant="outline" onClick={handleResetFilters} className="mt-2">
              Réinitialiser les filtres
            </Button>
          )}
        </div>

        {/* Messages List */}
        <div className="space-y-4" role="list" aria-label="Liste des messages">
          {messages.map((message) => (
            <div
              key={message.id}
              onClick={() => handleMessageClick(message)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleMessageClick(message);
                }
              }}
              tabIndex={0}
              role="listitem"
              aria-label={`Message de ${message.teacherName} pour ${message.childName}`}
              className={`p-4 border rounded-lg cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 ${
                message.isRead
                  ? 'bg-white border-gray-200 hover:border-gray-300'
                  : 'bg-blue-50 border-blue-200 hover:border-blue-300'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900">{message.subject}</h3>
                    {!message.isRead && (
                      <Badge className="bg-blue-100 text-blue-800">Nouveau</Badge>
                    )}
                    {getPriorityBadge(message.priorityLevel)}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-600 mb-2">
                    <div className="flex items-center gap-1">
                      <User className="h-4 w-4" />
                      <span>{message.teacherName}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <User className="h-4 w-4" />
                      <span>{message.childName}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      <span>{formatDate(message.sentAt)}</span>
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-gray-700 text-sm">{getContentPreview(message.content)}</p>
            </div>
          ))}
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t">
            <div className="text-sm text-gray-600">
              Page {pagination.page} sur {pagination.totalPages} ({pagination.total} messages)
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

        {/* Message Detail Modal */}
        {selectedMessage && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">{selectedMessage.subject}</h2>
                    <div className="flex items-center gap-4 text-sm text-gray-600 mb-4">
                      <div className="flex items-center gap-1">
                        <User className="h-4 w-4" />
                        <span>De: {selectedMessage.teacherName}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <User className="h-4 w-4" />
                        <span>Pour: {selectedMessage.childName}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        <span>{formatDate(selectedMessage.sentAt)}</span>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedMessage(null)}
                  >
                    ×
                  </Button>
                </div>
                <div className="mb-4">
                  {getPriorityBadge(selectedMessage.priorityLevel)}
                </div>
                <div className="prose max-w-none">
                  <p className="text-gray-700 whitespace-pre-wrap">{selectedMessage.content}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

