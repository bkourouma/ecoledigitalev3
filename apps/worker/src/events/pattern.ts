/**
 * Routage par motif des types d'événements (`domaine.evenement`, segments séparés par « . »).
 *
 *   finance.payment.completed   type exact
 *   finance.payment.*           « * » = exactement UN segment : finance.payment.completed, mais pas finance.payment.x.y
 *   finance.**                  « ** » en dernier = UN OU PLUSIEURS segments : tout ce qui est sous finance.
 *   **                          tous les événements
 *   /^audit\./                  RegExp : testée sur le type complet
 */
const SEGMENT_RE = /^[a-z][a-z0-9_]*$/;

export type TypeMatcher = (type: string) => boolean;

export function compilePattern(pattern: string | RegExp): TypeMatcher {
  if (pattern instanceof RegExp) {
    // Une RegExp globale/collante garde un état (lastIndex) : on teste sur une copie sans ces drapeaux.
    const re = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
    return (type) => re.test(type);
  }
  if (typeof pattern !== "string" || pattern.trim() === "") {
    throw new Error("Motif d'événement vide.");
  }
  if (pattern === "**") return () => true;

  const segments = pattern.split(".");
  segments.forEach((seg, i) => {
    if (seg === "*") return;
    if (seg === "**") {
      if (i !== segments.length - 1) throw new Error(`Motif "${pattern}" : « ** » n'est permis qu'en dernier segment.`);
      return;
    }
    if (!SEGMENT_RE.test(seg)) throw new Error(`Motif "${pattern}" : segment invalide "${seg}".`);
  });

  const open = segments[segments.length - 1] === "**";
  const fixed = open ? segments.slice(0, -1) : segments;

  return (type) => {
    const parts = type.split(".");
    if (open ? parts.length <= fixed.length : parts.length !== fixed.length) return false;
    return fixed.every((seg, i) => seg === "*" || seg === parts[i]);
  };
}
