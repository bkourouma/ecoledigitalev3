"use client";

import { Card, CardContent } from "@ecoledigitale/ui";
import { User, Building2 } from "lucide-react";

interface TypeInscriptionSelectorProps {
  value: "individuelle" | "entreprise";
  onChange: (value: "individuelle" | "entreprise") => void;
}

export function TypeInscriptionSelector({ value, onChange }: TypeInscriptionSelectorProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <Card
        className={`cursor-pointer transition-all ${
          value === "individuelle"
            ? "ring-2 ring-primary border-primary"
            : "hover:border-primary/50"
        }`}
        onClick={() => onChange("individuelle")}
      >
        <CardContent className="p-6">
          <div className="flex items-center space-x-4">
            <div className={`p-3 rounded-lg ${value === "individuelle" ? "bg-primary/10" : "bg-muted"}`}>
              <User className={`h-6 w-6 ${value === "individuelle" ? "text-primary" : "text-muted-foreground"}`} />
            </div>
            <div>
              <h3 className="font-semibold">Inscription individuelle</h3>
              <p className="text-sm text-muted-foreground">Pour votre compte personnel</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card
        className={`cursor-pointer transition-all ${
          value === "entreprise"
            ? "ring-2 ring-primary border-primary"
            : "hover:border-primary/50"
        }`}
        onClick={() => onChange("entreprise")}
      >
        <CardContent className="p-6">
          <div className="flex items-center space-x-4">
            <div className={`p-3 rounded-lg ${value === "entreprise" ? "bg-primary/10" : "bg-muted"}`}>
              <Building2 className={`h-6 w-6 ${value === "entreprise" ? "text-primary" : "text-muted-foreground"}`} />
            </div>
            <div>
              <h3 className="font-semibold">Inscription entreprise</h3>
              <p className="text-sm text-muted-foreground">Pour un employé de votre entreprise</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

