import { PgOutboxWriter, type Tx } from "@ecoledigitale/database";
import type { DomainEvent } from "@ecoledigitale/kernel";

/** Écrit les événements dans l'outbox, dans la transaction de la donnée (ADR-004). */
export async function publishEvents(tx: Tx, events: readonly DomainEvent[]): Promise<void> {
  if (events.length === 0) return;
  await new PgOutboxWriter(tx).append(events);
}
