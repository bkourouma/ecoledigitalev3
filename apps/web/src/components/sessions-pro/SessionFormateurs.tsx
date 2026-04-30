"use client";

import { SessionDetail } from "@ecoledigitale/contracts/src/sessions-pro";
import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { User, Award } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";

interface SessionFormateursProps {
  session: SessionDetail;
  className?: string;
}

export function SessionFormateurs({
  session,
  className,
}: SessionFormateursProps) {
  if (!session.formateurs || session.formateurs.length === 0) {
    return null;
  }

  return (
    <Card className={cn("mb-6", className)}>
      <CardHeader>
        <CardTitle>Formateurs</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {session.formateurs.map((formateur) => (
            <div
              key={formateur.id}
              className="flex gap-4 p-4 border border-border rounded-lg hover:border-primary transition-colors"
            >
              {/* Photo */}
              <div className="flex-shrink-0">
                {formateur.photo ? (
                  <Image
                    src={formateur.photo}
                    alt={`${formateur.prenom} ${formateur.nom}`}
                    width={80}
                    height={80}
                    className="rounded-full object-cover"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
                    <User className="w-10 h-10 text-muted-foreground" />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1">
                <h3 className="font-semibold text-lg text-foreground mb-1">
                  {formateur.prenom} {formateur.nom}
                </h3>
                {formateur.bio && (
                  <p className="text-sm text-foreground/80 mb-2 line-clamp-2">
                    {formateur.bio}
                  </p>
                )}
                {formateur.specialites &&
                  formateur.specialites.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {formateur.specialites.map((specialite, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary text-xs rounded-full"
                        >
                          <Award className="w-3 h-3" />
                          {specialite}
                        </span>
                      ))}
                    </div>
                  )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

