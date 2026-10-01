"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export interface TreeRenderContext {
  depth: number;
  expanded: boolean;
  selected: boolean;
  hasChildren: boolean;
}

export interface TreeEditorProps<N> {
  roots: ReadonlyArray<N>;
  getId: (node: N) => string;
  getChildren: (node: N) => ReadonlyArray<N>;
  renderLabel: (node: N, context: TreeRenderContext) => ReactNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Nom accessible de l'arbre. */
  ariaLabel: string;
  /** Tout déplier à l'ouverture (défaut) ou seulement la racine. */
  defaultExpanded?: "all" | "roots" | "none";
  emptyMessage?: ReactNode;
  className?: string;
}

interface FlatNode<N> {
  node: N;
  id: string;
  depth: number;
  parentId: string | null;
  hasChildren: boolean;
  setSize: number;
  position: number;
}

function collectIds<N>(nodes: ReadonlyArray<N>, getId: (n: N) => string, getChildren: (n: N) => ReadonlyArray<N>, out: string[] = []): string[] {
  for (const n of nodes) {
    const kids = getChildren(n);
    if (kids.length > 0) out.push(getId(n));
    collectIds(kids, getId, getChildren, out);
  }
  return out;
}

/**
 * Arbre accessible (motif ARIA « tree » à plat : `aria-level`, `aria-setsize`, `aria-posinset`), navigable au clavier
 * (↑ ↓ → ← Début Fin, Entrée / Espace pour sélectionner). L'ÉDITION (ajout, déplacement, suppression) se fait dans un
 * panneau relié à la sélection, jamais dans les lignes de l'arbre : les actions restent de vrais boutons accessibles et
 * utilisables au doigt, sans glisser-déposer obligatoire.
 */
export function TreeEditor<N>({ roots, getId, getChildren, renderLabel, selectedId, onSelect, ariaLabel, defaultExpanded = "all", emptyMessage, className }: TreeEditorProps<N>) {
  const t = useTranslations("v2Ui.tree");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    if (defaultExpanded === "all") return new Set(collectIds(roots, getId, getChildren));
    if (defaultExpanded === "roots") return new Set(roots.map(getId));
    return new Set();
  });
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const pendingFocus = useRef<string | null>(null);

  const flat = useMemo(() => {
    const out: Array<FlatNode<N>> = [];
    const walk = (nodes: ReadonlyArray<N>, depth: number, parentId: string | null) => {
      nodes.forEach((node, index) => {
        const id = getId(node);
        const kids = getChildren(node);
        out.push({ node, id, depth, parentId, hasChildren: kids.length > 0, setSize: nodes.length, position: index + 1 });
        if (kids.length > 0 && expandedIds.has(id)) walk(kids, depth + 1, id);
      });
    };
    walk(roots, 1, null);
    return out;
  }, [roots, expandedIds, getId, getChildren]);

  // Un nœud parent apparu après l'ouverture (ajout, rechargement de l'arbre) s'affiche déplié en mode « all ».
  const seenParents = useRef<Set<string>>(new Set(collectIds(roots, getId, getChildren)));
  useEffect(() => {
    if (defaultExpanded !== "all") return;
    const ids = collectIds(roots, getId, getChildren);
    const fresh = ids.filter((id) => !seenParents.current.has(id));
    if (fresh.length === 0) return;
    fresh.forEach((id) => seenParents.current.add(id));
    setExpandedIds((prev) => new Set([...prev, ...fresh]));
  }, [roots, getId, getChildren, defaultExpanded]);

  const tabStopId = (focusedId && flat.some((f) => f.id === focusedId) ? focusedId : null) ?? (selectedId && flat.some((f) => f.id === selectedId) ? selectedId : null) ?? flat[0]?.id ?? null;

  useEffect(() => {
    if (pendingFocus.current) {
      refs.current.get(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    }
  });

  function move(id: string) {
    pendingFocus.current = id;
    setFocusedId(id);
  }

  function toggle(id: string, open?: boolean) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      const shouldOpen = open ?? !next.has(id);
      if (shouldOpen) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>, item: FlatNode<N>, index: number) {
    const expanded = expandedIds.has(item.id);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (flat[index + 1]) move(flat[index + 1]!.id);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (flat[index - 1]) move(flat[index - 1]!.id);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (item.hasChildren && !expanded) toggle(item.id, true);
        else if (item.hasChildren && flat[index + 1]) move(flat[index + 1]!.id);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (item.hasChildren && expanded) toggle(item.id, false);
        else if (item.parentId) move(item.parentId);
        break;
      case "Home":
        e.preventDefault();
        if (flat[0]) move(flat[0].id);
        break;
      case "End":
        e.preventDefault();
        if (flat.length > 0) move(flat[flat.length - 1]!.id);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        onSelect(item.id);
        break;
      default:
    }
  }

  if (flat.length === 0) return <div className={className}>{emptyMessage ?? <p className="text-sm text-muted-foreground">{t("empty")}</p>}</div>;

  return (
    <div role="tree" aria-label={ariaLabel} className={cn("space-y-0.5", className)}>
      {flat.map((item, index) => {
        const expanded = expandedIds.has(item.id);
        const selected = item.id === selectedId;
        return (
          <div
            key={item.id}
            ref={(el) => {
              if (el) refs.current.set(item.id, el);
              else refs.current.delete(item.id);
            }}
            role="treeitem"
            aria-level={item.depth}
            aria-setsize={item.setSize}
            aria-posinset={item.position}
            aria-expanded={item.hasChildren ? expanded : undefined}
            aria-selected={selected}
            tabIndex={item.id === tabStopId ? 0 : -1}
            onFocus={() => setFocusedId(item.id)}
            onKeyDown={(e) => onKeyDown(e, item, index)}
            onClick={() => onSelect(item.id)}
            style={{ paddingLeft: `${(item.depth - 1) * 1.25 + 0.25}rem` }}
            className={cn("flex min-h-[2.75rem] cursor-pointer items-center gap-1 rounded-md pr-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", selected ? "bg-accent text-accent-foreground" : "hover:bg-muted/60")}
          >
            {item.hasChildren ? (
              <button
                type="button"
                tabIndex={-1}
                aria-label={expanded ? t("collapse") : t("expand")}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(item.id);
                }}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-muted"
              >
                {expanded ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
              </button>
            ) : (
              <span className="inline-block h-8 w-8 shrink-0" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">{renderLabel(item.node, { depth: item.depth, expanded, selected, hasChildren: item.hasChildren })}</div>
          </div>
        );
      })}
    </div>
  );
}
