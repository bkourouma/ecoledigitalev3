'use client';

import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Megaphone, Plus, Edit, Trash2, Loader2, X } from 'lucide-react';
import { useAdminAnnouncements, useCreateAnnouncement, useUpdateAnnouncement, useDeleteAnnouncement } from '@/lib/hooks/use-admin-announcements';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

export default function AdminAnnouncementsPage() {
  const { data: session, status } = useSession();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<string | null>(null);
  const [deletingAnnouncement, setDeletingAnnouncement] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const limit = 20;

  // Form state
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    priorityLevel: 'normal' as 'low' | 'normal' | 'high' | 'urgent',
  });

  // Fetch announcements
  const { data: announcementsData, isLoading: isLoadingAnnouncements, error: announcementsError } = useAdminAnnouncements({}, page, limit);
  const announcements = announcementsData?.data?.announcements || [];
  const pagination = announcementsData?.data?.pagination || null;

  // Mutations
  const createAnnouncement = useCreateAnnouncement();
  const updateAnnouncement = useUpdateAnnouncement();
  const deleteAnnouncement = useDeleteAnnouncement();

  // Redirect if not authenticated
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!session) {
    redirect('/login');
  }

  // Check if user has admin role
  const roles = (session as any)?.roles ?? [];
  const isAdmin = Array.isArray(roles) && roles.some((r: string) => ['admin', 'super_admin', 'Administrateur'].includes(r));

  if (!isAdmin) {
    redirect('/');
  }

  const handleCreate = async () => {
    try {
      await createAnnouncement.mutateAsync({
        title: formData.title.trim(),
        content: formData.content.trim(),
        priorityLevel: formData.priorityLevel === 'normal' ? undefined : formData.priorityLevel,
      });
      setFormData({ title: '', content: '', priorityLevel: 'normal' });
      setShowCreateForm(false);
    } catch (error) {
      console.error('Error creating announcement:', error);
    }
  };

  const handleEdit = (announcement: any) => {
    setFormData({
      title: announcement.title,
      content: announcement.content,
      priorityLevel: announcement.priorityLevel || 'normal',
    });
    setEditingAnnouncement(announcement.id);
  };

  const handleUpdate = async () => {
    if (!editingAnnouncement) return;

    try {
      await updateAnnouncement.mutateAsync({
        id: editingAnnouncement,
        data: {
          title: formData.title.trim(),
          content: formData.content.trim(),
          priorityLevel: formData.priorityLevel === 'normal' ? undefined : formData.priorityLevel,
        },
      });
      setFormData({ title: '', content: '', priorityLevel: 'normal' });
      setEditingAnnouncement(null);
    } catch (error) {
      console.error('Error updating announcement:', error);
    }
  };

  const handleDelete = async () => {
    if (!deletingAnnouncement) return;

    try {
      await deleteAnnouncement.mutateAsync(deletingAnnouncement);
      setDeletingAnnouncement(null);
    } catch (error) {
      console.error('Error deleting announcement:', error);
    }
  };

  const getPriorityColor = (priority: string | null) => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'high':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'normal':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'low':
        return 'bg-gray-100 text-gray-800 border-gray-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getPriorityLabel = (priority: string | null) => {
    switch (priority) {
      case 'urgent':
        return 'Urgente';
      case 'high':
        return 'Haute';
      case 'normal':
        return 'Normale';
      case 'low':
        return 'Basse';
      default:
        return 'Normale';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold mb-2">Annonces de l'École</h1>
              <p className="text-sm sm:text-base text-blue-100">
                Gérez les annonces publiées pour les parents
              </p>
            </div>
            <div className="hidden md:flex items-center gap-4">
              <div className="bg-white/10 rounded-lg p-4 backdrop-blur-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Megaphone className="h-5 w-5" />
                  <span className="text-sm font-medium">Annonces</span>
                </div>
                <div className="text-2xl font-bold">
                  {pagination?.total || 0}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Create Button */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Liste des Annonces</h2>
            <p className="text-sm text-gray-500 mt-1">
              Créez et gérez les annonces visibles par tous les parents
            </p>
          </div>
          <Button
            onClick={() => {
              setFormData({ title: '', content: '', priorityLevel: 'normal' });
              setShowCreateForm(true);
            }}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Nouvelle Annonce
          </Button>
        </div>

        {/* Announcements List */}
        <Card>
          <CardHeader>
            <CardTitle>Annonces Publiées</CardTitle>
            <CardDescription>
              Liste de toutes les annonces de l'école
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingAnnouncements ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
                <p className="text-sm text-gray-500 mt-4">Chargement des annonces...</p>
              </div>
            ) : announcementsError ? (
              <div className="text-center py-12 text-red-500">
                <p>Erreur lors du chargement des annonces</p>
                <p className="text-sm mt-2">
                  {announcementsError instanceof Error ? announcementsError.message : 'Une erreur est survenue'}
                </p>
              </div>
            ) : announcements.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Megaphone className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <p>Aucune annonce</p>
                <p className="text-sm mt-2">Commencez par créer votre première annonce</p>
              </div>
            ) : (
              <div className="space-y-4">
                {announcements.map((announcement) => (
                  <div
                    key={announcement.id}
                    className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-semibold text-gray-900">{announcement.title}</h3>
                          {announcement.priorityLevel && (
                            <Badge className={getPriorityColor(announcement.priorityLevel)} variant="outline">
                              {getPriorityLabel(announcement.priorityLevel)}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mb-2 line-clamp-2">{announcement.content}</p>
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span>Par: {announcement.authorName}</span>
                          <span>•</span>
                          <span>
                            {new Date(announcement.postedAt).toLocaleDateString('fr-FR', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEdit(announcement)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDeletingAnnouncement(announcement.id)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Pagination */}
                {pagination && pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between pt-4 border-t">
                    <p className="text-sm text-gray-500">
                      Page {pagination.page} sur {pagination.totalPages} ({pagination.total} annonces)
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                      >
                        Précédent
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                        disabled={page === pagination.totalPages}
                      >
                        Suivant
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={showCreateForm || editingAnnouncement !== null} onOpenChange={(open) => {
        if (!open) {
          setShowCreateForm(false);
          setEditingAnnouncement(null);
          setFormData({ title: '', content: '', priorityLevel: 'normal' });
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingAnnouncement ? 'Modifier l\'Annonce' : 'Nouvelle Annonce'}
            </DialogTitle>
            <DialogDescription>
              {editingAnnouncement
                ? 'Modifiez les détails de l\'annonce'
                : 'Créez une nouvelle annonce qui sera visible par tous les parents'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">Titre *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Ex: Réunion parents-professeurs"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Priorité</Label>
              <Select
                value={formData.priorityLevel}
                onValueChange={(value: 'low' | 'normal' | 'high' | 'urgent') =>
                  setFormData({ ...formData, priorityLevel: value })
                }
              >
                <SelectTrigger id="priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Basse</SelectItem>
                  <SelectItem value="normal">Normale</SelectItem>
                  <SelectItem value="high">Haute</SelectItem>
                  <SelectItem value="urgent">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="content">Contenu *</Label>
              <Textarea
                id="content"
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                placeholder="Rédigez le contenu de l'annonce..."
                rows={8}
                required
              />
              <p className="text-sm text-gray-500">
                {formData.content.length} caractères
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCreateForm(false);
                setEditingAnnouncement(null);
                setFormData({ title: '', content: '', priorityLevel: 'normal' });
              }}
            >
              Annuler
            </Button>
            <Button
              onClick={editingAnnouncement ? handleUpdate : handleCreate}
              disabled={
                !formData.title.trim() ||
                !formData.content.trim() ||
                createAnnouncement.isPending ||
                updateAnnouncement.isPending
              }
            >
              {(createAnnouncement.isPending || updateAnnouncement.isPending) ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {editingAnnouncement ? 'Modification...' : 'Création...'}
                </>
              ) : (
                editingAnnouncement ? 'Modifier' : 'Créer'
              )}
            </Button>
          </DialogFooter>
          {(createAnnouncement.isError || updateAnnouncement.isError) && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md">
              <p className="text-sm font-medium">Erreur</p>
              <p className="text-sm mt-1">
                {createAnnouncement.error instanceof Error
                  ? createAnnouncement.error.message
                  : updateAnnouncement.error instanceof Error
                  ? updateAnnouncement.error.message
                  : 'Une erreur est survenue'}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deletingAnnouncement !== null} onOpenChange={(open) => !open && setDeletingAnnouncement(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer l'annonce ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. L'annonce sera définitivement supprimée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
              disabled={deleteAnnouncement.isPending}
            >
              {deleteAnnouncement.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Suppression...
                </>
              ) : (
                'Supprimer'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

