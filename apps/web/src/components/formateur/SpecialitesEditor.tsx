"use client";

import { useState, KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@ecoledigitale/ui";
import { X } from "lucide-react";
import { Button } from "@ecoledigitale/ui";

interface SpecialitesEditorProps {
  specialites: string[];
  onChange: (specialites: string[]) => void;
  disabled?: boolean;
}

export function SpecialitesEditor({
  specialites,
  onChange,
  disabled = false,
}: SpecialitesEditorProps) {
  const [inputValue, setInputValue] = useState("");

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && inputValue.trim()) {
      e.preventDefault();
      if (!specialites.includes(inputValue.trim())) {
        onChange([...specialites, inputValue.trim()]);
      }
      setInputValue("");
    } else if (e.key === "Backspace" && inputValue === "" && specialites.length > 0) {
      // Remove last tag on backspace
      onChange(specialites.slice(0, -1));
    }
  };

  const handleRemove = (index: number) => {
    onChange(specialites.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 p-3 border rounded-md min-h-[42px]">
        {specialites.map((specialite, index) => (
          <Badge key={index} variant="secondary" className="flex items-center gap-1">
            {specialite}
            {!disabled && (
              <button
                type="button"
                onClick={() => handleRemove(index)}
                className="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </Badge>
        ))}
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ajouter une spécialité..."
          disabled={disabled}
          className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1 min-w-[150px]"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Appuyez sur Entrée pour ajouter une spécialité
      </p>
    </div>
  );
}

