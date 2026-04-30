'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Bell, Calendar, Filter, AlertCircle, Mail, Clock, ExternalLink, X } from 'lucide-react';
import { Notification, NotificationFilter } from '@ecoledigitale/contracts';
import { useMarkNotificationRead } from '@/lib/hooks/use-parent-messages';
import { useRouter } from 'next/navigation';

interface NotificationsProps {
  notifications: Notification[] | null;
  isLoading?: boolean;
  error?: Error | null;
  filters?: NotificationFilter;
  onFiltersChange?: (filters: NotificationFilter) => void;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  onPageChange?: (page: number) => void;
  onNotificationClick?: (notification: Notification) => void;
  onMarkAsRead?: (notificationId: string) => void;
}

export function Notifications({ 
  notifications, 
  isLoading, 
  error,
  filters = {},
  onFiltersChange,
  pagination,
  onPageChange,
  onNotificationClick,
  onMarkAsRead
}: NotificationsProps) {
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
  const router = useRouter();
  const markAsReadMutation = useMarkNotificationRead();

  // Handle filter change
  const handleFilterChange = (key: keyof NotificationFilter, value: string | undefined) => {
    const newFilters = { ...filters, [key]: value || undefined };
    if (onFiltersChange) {
      onFiltersChange(newFilters);
    }
  };

  // Reset filters
  const handleResetFilters = () => {
    const resetFilters: NotificationFilter = {
      notificationType: undefined,
      startDate: undefined,
      endDate: undefined,
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

  // Get notification type badge
  const getNotificationTypeBadge = (notificationType: string) => {
    switch (notificationType) {
      case 'message':
        return <Badge className="bg-blue-100 text-blue-800">Message</Badge>;
      case 'announcement':
        return <Badge className="bg-purple-100 text-purple-800">Annonce</Badge>;
      case 'event':
        return <Badge className="bg-green-100 text-green-800">Événement</Badge>;
      case 'grade':
        return <Badge className="bg-yellow-100 text-yellow-800">Note</Badge>;
      case 'payment':
        return <Badge className="bg-orange-100 text-orange-800">Paiement</Badge>;
      case 'other':
        return <Badge className="bg-gray-100 text-gray-800">Autre</Badge>;
      default:
        return null;
    }
  };

  // Get content preview
  const getContentPreview = (content: string, maxLength: number = 150) => {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  };

  // Handle notification click
  const handleNotificationClick = (notification: Notification) => {
    setSelectedNotification(notification);
    if (onNotificationClick) {
      onNotificationClick(notification);
    }
    // Mark as read if unread
    if (!notification.isRead) {
      if (onMarkAsRead) {
        onMarkAsRead(notification.id);
      } else {
        markAsReadMutation.mutate(notification.id);
      }
    }
  };

  // Handle action link click
  const handleActionLinkClick = (actionLink: string | null) => {
    if (actionLink) {
      router.push(actionLink);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-emerald-600" />
            Notifications
          </CardTitle>
          <CardDescription>
            Notifications importantes et mises à jour
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
            <Bell className="h-5 w-5 text-emerald-600" />
            Notifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
            <p className="text-red-600 font-medium mb-2">Erreur lors du chargement des notifications</p>
            <p className="text-gray-600 text-sm">{error.message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (!notifications || notifications.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-emerald-600" />
            Notifications
          </CardTitle>
          <CardDescription>
            Notifications importantes et mises à jour
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
                value={filters.notificationType || 'all'}
                onValueChange={(value) => handleFilterChange('notificationType', value === 'all' ? undefined : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Type de notification" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  <SelectItem value="message">Message</SelectItem>
                  <SelectItem value="announcement">Annonce</SelectItem>
                  <SelectItem value="event">Événement</SelectItem>
                  <SelectItem value="grade">Note</SelectItem>
                  <SelectItem value="payment">Paiement</SelectItem>
                  <SelectItem value="other">Autre</SelectItem>
                </SelectContent>
              </Select>
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
            {(filters.notificationType || filters.readStatus || filters.startDate || filters.endDate) && (
              <Button variant="outline" onClick={handleResetFilters} className="mt-2">
                Réinitialiser les filtres
              </Button>
            )}
          </div>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Bell className="h-12 w-12 text-gray-400 mb-4" />
            <p className="text-gray-600 font-medium mb-2">Aucune notification</p>
            <p className="text-gray-500 text-sm">Vous n'avez pas encore de notifications</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-emerald-600" />
          Notifications
        </CardTitle>
        <CardDescription>
          Notifications importantes et mises à jour
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
              value={filters.notificationType || 'all'}
              onValueChange={(value) => handleFilterChange('notificationType', value === 'all' ? undefined : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Type de notification" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="message">Message</SelectItem>
                <SelectItem value="announcement">Annonce</SelectItem>
                <SelectItem value="event">Événement</SelectItem>
                <SelectItem value="grade">Note</SelectItem>
                <SelectItem value="payment">Paiement</SelectItem>
                <SelectItem value="other">Autre</SelectItem>
              </SelectContent>
            </Select>
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
          {(filters.notificationType || filters.readStatus || filters.startDate || filters.endDate) && (
            <Button variant="outline" onClick={handleResetFilters} className="mt-2">
              Réinitialiser les filtres
            </Button>
          )}
        </div>

        {/* Notifications List */}
        <div className="space-y-4">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              onClick={() => handleNotificationClick(notification)}
              className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                notification.isRead
                  ? 'bg-white border-gray-200 hover:border-gray-300'
                  : 'bg-blue-50 border-blue-200 hover:border-blue-300'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900">{notification.title}</h3>
                    {!notification.isRead && (
                      <Badge className="bg-blue-100 text-blue-800">Nouveau</Badge>
                    )}
                    {getNotificationTypeBadge(notification.notificationType)}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-600 mb-2">
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      <span>{formatDate(notification.createdAt)}</span>
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-gray-700 text-sm mb-2">{getContentPreview(notification.content)}</p>
              {notification.actionLink && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleActionLinkClick(notification.actionLink);
                  }}
                  className="mt-2"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Voir plus
                </Button>
              )}
            </div>
          ))}
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t">
            <div className="text-sm text-gray-600">
              Page {pagination.page} sur {pagination.totalPages} ({pagination.total} notifications)
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

        {/* Notification Detail Modal */}
        {selectedNotification && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">{selectedNotification.title}</h2>
                    <div className="flex items-center gap-4 text-sm text-gray-600 mb-4">
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        <span>{formatDate(selectedNotification.createdAt)}</span>
                      </div>
                      {getNotificationTypeBadge(selectedNotification.notificationType)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedNotification(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="prose max-w-none mb-4">
                  <p className="text-gray-700 whitespace-pre-wrap">{selectedNotification.content}</p>
                </div>
                {selectedNotification.actionLink && (
                  <Button
                    onClick={() => handleActionLinkClick(selectedNotification.actionLink)}
                    className="mt-4"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Voir le contenu associé
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

