"use client";

import { Badge } from "../../badge";

interface Tag {
  nom: string;
  couleur: string;
  icone?: string | null;
}

interface TagBadgeProps {
  tag: Tag;
  variant?: "default" | "secondary" | "outline";
  className?: string;
  onClick?: () => void;
}

export function TagBadge({
  tag,
  variant = "secondary",
  className = "",
  onClick,
}: TagBadgeProps) {
  return (
    <Badge
      variant={variant}
      style={{
        backgroundColor: onClick ? tag.couleur + "20" : tag.couleur + "15",
        color: tag.couleur,
        borderColor: tag.couleur + "40",
      }}
      className={`${onClick ? "cursor-pointer hover:opacity-80" : ""} ${className}`}
      onClick={onClick}
    >
      {tag.icone && <span className="mr-1">{tag.icone}</span>}
      {tag.nom}
    </Badge>
  );
}









