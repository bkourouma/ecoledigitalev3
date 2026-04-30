"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@ecoledigitale/ui";
import { Clock } from "lucide-react";

interface ReservationTimerProps {
  expiresAt: Date | string;
  onExpire?: () => void;
}

export function ReservationTimer({ expiresAt, onExpire }: ReservationTimerProps) {
  const [timeRemaining, setTimeRemaining] = useState<number>(0);

  useEffect(() => {
    const expiry = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;

    const updateTimer = () => {
      const now = new Date();
      const diff = expiry.getTime() - now.getTime();
      const seconds = Math.max(0, Math.floor(diff / 1000));

      setTimeRemaining(seconds);

      if (seconds === 0 && onExpire) {
        onExpire();
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;

  if (timeRemaining === 0) {
    return (
      <Card className="border-destructive">
        <CardContent className="p-4">
          <div className="flex items-center space-x-2 text-destructive">
            <Clock className="w-4 h-4" />
            <span className="text-sm font-medium">Réservation expirée</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-warning">
      <CardContent className="p-4">
        <div className="flex items-center space-x-2">
          <Clock className="w-4 h-4 text-warning" />
          <span className="text-sm font-medium">
            Réservation expire dans: {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

