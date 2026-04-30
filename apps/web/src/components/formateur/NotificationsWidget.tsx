"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Bell, Loader2 } from "lucide-react";
import Link from "next/link";
import { useFormateurNotifications, useMarkNotificationRead } from "@/lib/hooks/use-formateur-notifications";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Button } from "@ecoledigitale/ui";

export function NotificationsWidget() {
  const { data, isLoading, error } = useFormateurNotifications({
    page: 1,
    limit: 5,
  });
  const markAsRead = useMarkNotificationRead();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-destructive text-sm">
            {error instanceof Error ? error.message : "Erreur lors du chargement"}
          </p>
        </CardContent>
      </Card>
    );
  }

  const notifications = data?.data?.notifications || [];
  const nbNonLues = data?.data?.nb_non_lues || 0;

  const handleMarkAsRead = (notificationId: string) => {
    markAsRead.mutate(notificationId);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notifications
          </div>
          {nbNonLues > 0 && (
            <span className="bg-primary text-primary-foreground text-xs font-bold px-2 py-1 rounded-full">
              {nbNonLues}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {notifications.length === 0 ? (
          <p className="text-muted-foreground text-sm">Aucune notification</p>
        ) : (
          <div className="space-y-3">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`p-3 rounded-lg border ${
                  !notification.lue ? "bg-primary/5 border-primary/20" : "bg-background"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <h4 className="font-medium text-sm">{notification.titre}</h4>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {notification.message}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {format(new Date(notification.created_at), "d MMM yyyy à HH:mm", { locale: fr })}
                    </p>
                  </div>
                  {!notification.lue && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleMarkAsRead(notification.id)}
                      disabled={markAsRead.isPending}
                      className="h-6 w-6 p-0"
                      title="Marquer comme lu"
                    >
                      <span className="h-2 w-2 rounded-full bg-primary" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {notifications.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <Link href="/formateur/notifications">
              <Button variant="outline" size="sm" className="w-full">
                Voir toutes les notifications
              </Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

