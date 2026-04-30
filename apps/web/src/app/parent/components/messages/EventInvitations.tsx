'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Calendar, Filter, AlertCircle, MapPin, User, Clock, CheckCircle, XCircle, HelpCircle, X } from 'lucide-react';
import { EventInvitation, InvitationFilter, ChildListItem } from '@ecoledigitale/contracts';
import { useRespondToInvitation } from '@/lib/hooks/use-parent-messages';

interface EventInvitationsProps {
  invitations: EventInvitation[] | null;
  isLoading?: boolean;
  error?: Error | null;
  children?: ChildListItem[];
  filters?: InvitationFilter;
  onFiltersChange?: (filters: InvitationFilter) => void;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  onPageChange?: (page: number) => void;
  onInvitationClick?: (invitation: EventInvitation) => void;
}

export function EventInvitations({ 
  invitations, 
  isLoading, 
  error,
  children = [],
  filters = {},
  onFiltersChange,
  pagination,
  onPageChange,
  onInvitationClick
}: EventInvitationsProps) {
  const [selectedInvitation, setSelectedInvitation] = useState<EventInvitation | null>(null);
  const respondToInvitationMutation = useRespondToInvitation();

  // Handle filter change
  const handleFilterChange = (key: keyof InvitationFilter, value: string | undefined) => {
    const newFilters = { ...filters, [key]: value || undefined };
    if (onFiltersChange) {
      onFiltersChange(newFilters);
    }
  };

  // Reset filters
  const handleResetFilters = () => {
    const resetFilters: InvitationFilter = {
      childId: undefined,
      eventType: undefined,
      startDate: undefined,
      endDate: undefined,
      rsvpStatus: undefined,
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

  // Format date only (for deadline)
  const formatDateOnly = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  // Get RSVP status badge
  const getRSVPStatusBadge = (rsvpStatus: string) => {
    switch (rsvpStatus) {
      case 'accepted':
        return <Badge className="bg-green-100 text-green-800 flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Accepté</Badge>;
      case 'declined':
        return <Badge className="bg-red-100 text-red-800 flex items-center gap-1"><XCircle className="h-3 w-3" /> Refusé</Badge>;
      case 'tentative':
        return <Badge className="bg-yellow-100 text-yellow-800 flex items-center gap-1"><HelpCircle className="h-3 w-3" /> Incertain</Badge>;
      case 'pending':
        return <Badge className="bg-gray-100 text-gray-800">En attente</Badge>;
      default:
        return null;
    }
  };

  // Check if RSVP deadline has passed
  const isRSVPDeadlinePassed = (deadline: string | null) => {
    if (!deadline) return false;
    const deadlineDate = new Date(deadline);
    const now = new Date();
    return now > deadlineDate;
  };

  // Handle RSVP response
  const handleRSVPResponse = async (invitationId: string, rsvpStatus: 'accepted' | 'declined' | 'tentative') => {
    try {
      await respondToInvitationMutation.mutateAsync({ invitationId, rsvpStatus });
      // Update selected invitation if it's the one being responded to
      if (selectedInvitation && selectedInvitation.id === invitationId) {
        const updatedInvitation = { ...selectedInvitation, rsvpStatus, rsvpResponseAt: new Date().toISOString() };
        setSelectedInvitation(updatedInvitation);
      }
    } catch (error) {
      console.error('Failed to respond to invitation:', error);
    }
  };

  // Handle invitation click
  const handleInvitationClick = (invitation: EventInvitation) => {
    setSelectedInvitation(invitation);
    if (onInvitationClick) {
      onInvitationClick(invitation);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-600" />
            Invitations d'Événements
          </CardTitle>
          <CardDescription>
            Invitations aux événements scolaires et conférences parent-enseignant
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
            <Calendar className="h-5 w-5 text-emerald-600" />
            Invitations d'Événements
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
            <p className="text-red-600 font-medium mb-2">Erreur lors du chargement des invitations</p>
            <p className="text-gray-600 text-sm">{error.message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (!invitations || invitations.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-600" />
            Invitations d'Événements
          </CardTitle>
          <CardDescription>
            Invitations aux événements scolaires et conférences parent-enseignant
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-6 space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">Filtres</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              {children.length > 0 && (
                <Select
                  value={filters.childId || 'all'}
                  onValueChange={(value) => handleFilterChange('childId', value === 'all' ? undefined : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Enfant" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les enfants</SelectItem>
                    {children.map((child, index) => (
                      <SelectItem key={`event-invitations-child-${index}`} value={child.id}>
                        {child.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Input
                type="text"
                placeholder="Type d'événement"
                value={filters.eventType || ''}
                onChange={(e) => handleFilterChange('eventType', e.target.value || undefined)}
              />
              <Select
                value={filters.rsvpStatus || 'all'}
                onValueChange={(value) => handleFilterChange('rsvpStatus', value === 'all' ? undefined : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Statut RSVP" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  <SelectItem value="pending">En attente</SelectItem>
                  <SelectItem value="accepted">Accepté</SelectItem>
                  <SelectItem value="declined">Refusé</SelectItem>
                  <SelectItem value="tentative">Incertain</SelectItem>
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
            {(filters.childId || filters.eventType || filters.rsvpStatus || filters.startDate || filters.endDate) && (
              <Button variant="outline" onClick={handleResetFilters} className="mt-2">
                Réinitialiser les filtres
              </Button>
            )}
          </div>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Calendar className="h-12 w-12 text-gray-400 mb-4" />
            <p className="text-gray-600 font-medium mb-2">Aucune invitation</p>
            <p className="text-gray-500 text-sm">Vous n'avez pas encore d'invitations d'événements</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-emerald-600" />
          Invitations d'Événements
        </CardTitle>
        <CardDescription>
          Invitations aux événements scolaires et conférences parent-enseignant
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="mb-6 space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="h-4 w-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Filtres</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {children.length > 0 && (
              <Select
                value={filters.childId || 'all'}
                onValueChange={(value) => handleFilterChange('childId', value === 'all' ? undefined : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Enfant" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les enfants</SelectItem>
                  {children.map((child, index) => (
                    <SelectItem key={`event-invitations-child-${index}`} value={child.id}>
                      {child.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Input
              type="text"
              placeholder="Type d'événement"
              value={filters.eventType || ''}
              onChange={(e) => handleFilterChange('eventType', e.target.value || undefined)}
            />
            <Select
              value={filters.rsvpStatus || 'all'}
              onValueChange={(value) => handleFilterChange('rsvpStatus', value === 'all' ? undefined : value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Statut RSVP" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="pending">En attente</SelectItem>
                <SelectItem value="accepted">Accepté</SelectItem>
                <SelectItem value="declined">Refusé</SelectItem>
                <SelectItem value="tentative">Incertain</SelectItem>
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
          {(filters.childId || filters.eventType || filters.rsvpStatus || filters.startDate || filters.endDate) && (
            <Button variant="outline" onClick={handleResetFilters} className="mt-2">
              Réinitialiser les filtres
            </Button>
          )}
        </div>

        {/* Invitations List */}
        <div className="space-y-4">
          {invitations.map((invitation) => (
            <div
              key={invitation.id}
              onClick={() => handleInvitationClick(invitation)}
              className="p-4 border rounded-lg cursor-pointer transition-colors hover:border-emerald-300 bg-white border-gray-200"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900">{invitation.eventName}</h3>
                    {getRSVPStatusBadge(invitation.rsvpStatus)}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-600 mb-2 flex-wrap">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      <span>{formatDate(invitation.eventDate)}</span>
                    </div>
                    {invitation.eventLocation && (
                      <div className="flex items-center gap-1">
                        <MapPin className="h-4 w-4" />
                        <span>{invitation.eventLocation}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <User className="h-4 w-4" />
                      <span>Organisé par {invitation.organizerName}</span>
                    </div>
                    {invitation.childName && (
                      <div className="flex items-center gap-1">
                        <span>Pour: {invitation.childName}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {invitation.eventDescription && (
                <p className="text-gray-700 text-sm mb-2 line-clamp-2">{invitation.eventDescription}</p>
              )}
              {invitation.rsvpDeadline && (
                <div className="flex items-center gap-1 text-sm text-gray-600 mb-2">
                  <Clock className="h-4 w-4" />
                  <span>Date limite de réponse: {formatDateOnly(invitation.rsvpDeadline)}</span>
                  {isRSVPDeadlinePassed(invitation.rsvpDeadline) && (
                    <Badge className="bg-red-100 text-red-800 ml-2">Délai dépassé</Badge>
                  )}
                </div>
              )}
              {invitation.rsvpStatus === 'pending' && !isRSVPDeadlinePassed(invitation.rsvpDeadline) && (
                <div className="flex gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                    onClick={() => handleRSVPResponse(invitation.id, 'accepted')}
                    disabled={respondToInvitationMutation.isPending}
                  >
                    <CheckCircle className="h-4 w-4 mr-1" />
                    Accepter
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-yellow-50 text-yellow-700 border-yellow-200 hover:bg-yellow-100"
                    onClick={() => handleRSVPResponse(invitation.id, 'tentative')}
                    disabled={respondToInvitationMutation.isPending}
                  >
                    <HelpCircle className="h-4 w-4 mr-1" />
                    Incertain
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                    onClick={() => handleRSVPResponse(invitation.id, 'declined')}
                    disabled={respondToInvitationMutation.isPending}
                  >
                    <XCircle className="h-4 w-4 mr-1" />
                    Refuser
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t">
            <div className="text-sm text-gray-600">
              Page {pagination.page} sur {pagination.totalPages} ({pagination.total} invitations)
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

        {/* Invitation Detail Modal */}
        {selectedInvitation && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedInvitation(null)}>
            <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">{selectedInvitation.eventName}</h2>
                    <div className="flex items-center gap-4 text-sm text-gray-600 mb-4 flex-wrap">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        <span>{formatDate(selectedInvitation.eventDate)}</span>
                      </div>
                      {selectedInvitation.eventLocation && (
                        <div className="flex items-center gap-1">
                          <MapPin className="h-4 w-4" />
                          <span>{selectedInvitation.eventLocation}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <User className="h-4 w-4" />
                        <span>Organisé par {selectedInvitation.organizerName}</span>
                      </div>
                      {selectedInvitation.childName && (
                        <div className="flex items-center gap-1">
                          <span>Pour: {selectedInvitation.childName}</span>
                        </div>
                      )}
                    </div>
                    {getRSVPStatusBadge(selectedInvitation.rsvpStatus)}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedInvitation(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {selectedInvitation.eventDescription && (
                  <div className="prose max-w-none mb-4">
                    <p className="text-gray-700 whitespace-pre-wrap">{selectedInvitation.eventDescription}</p>
                  </div>
                )}
                {selectedInvitation.rsvpDeadline && (
                  <div className="flex items-center gap-1 text-sm text-gray-600 mb-4">
                    <Clock className="h-4 w-4" />
                    <span>Date limite de réponse: {formatDateOnly(selectedInvitation.rsvpDeadline)}</span>
                    {isRSVPDeadlinePassed(selectedInvitation.rsvpDeadline) && (
                      <Badge className="bg-red-100 text-red-800 ml-2">Délai dépassé</Badge>
                    )}
                  </div>
                )}
                {selectedInvitation.rsvpResponseAt && (
                  <div className="text-sm text-gray-600 mb-4">
                    Réponse envoyée le: {formatDate(selectedInvitation.rsvpResponseAt)}
                  </div>
                )}
                {selectedInvitation.rsvpStatus === 'pending' && !isRSVPDeadlinePassed(selectedInvitation.rsvpDeadline) && (
                  <div className="flex gap-2 mt-4">
                    <Button
                      className="bg-green-600 hover:bg-green-700"
                      onClick={() => handleRSVPResponse(selectedInvitation.id, 'accepted')}
                      disabled={respondToInvitationMutation.isPending}
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Accepter
                    </Button>
                    <Button
                      variant="outline"
                      className="bg-yellow-50 text-yellow-700 border-yellow-200 hover:bg-yellow-100"
                      onClick={() => handleRSVPResponse(selectedInvitation.id, 'tentative')}
                      disabled={respondToInvitationMutation.isPending}
                    >
                      <HelpCircle className="h-4 w-4 mr-2" />
                      Incertain
                    </Button>
                    <Button
                      variant="outline"
                      className="bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                      onClick={() => handleRSVPResponse(selectedInvitation.id, 'declined')}
                      disabled={respondToInvitationMutation.isPending}
                    >
                      <XCircle className="h-4 w-4 mr-2" />
                      Refuser
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

