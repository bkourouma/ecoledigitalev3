import { Suspense } from "react";
import { UnsubscribeScreen } from "../_components/UnsubscribeScreen";

/** `?t=` est lu côté client (`useSearchParams`) : l'écran n'écrit rien tant que la personne n'a pas confirmé. */
export default function UnsubscribePage() {
  return (
    <Suspense fallback={null}>
      <UnsubscribeScreen />
    </Suspense>
  );
}
