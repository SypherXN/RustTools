import type { RustPlusEvent, RustPlusEventType } from "@rusttools/shared";

type EventHandler<T extends RustPlusEvent = RustPlusEvent> = (event: T) => void;

export class EventBus {
  private handlers = new Map<RustPlusEventType, Set<EventHandler>>();

  on<T extends RustPlusEventType>(
    type: T,
    handler: EventHandler<Extract<RustPlusEvent, { type: T }>>,
  ): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    const set = this.handlers.get(type)!;
    set.add(handler as EventHandler);
    return () => set.delete(handler as EventHandler);
  }

  emit(event: RustPlusEvent): void {
    const handlers = this.handlers.get(event.type);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        void Promise.resolve(handler(event)).catch((err) => {
          console.error(`[EventBus] Handler for "${event.type}" failed:`, err);
        });
      } catch (err) {
        console.error(`[EventBus] Handler for "${event.type}" failed:`, err);
      }
    }
  }
}
