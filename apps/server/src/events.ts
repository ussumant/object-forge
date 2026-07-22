import type { GeneratorEvent } from '@img3d/shared';

type Listener = (event: GeneratorEvent) => void;

export class RunEventBus {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly recent = new Map<string, GeneratorEvent[]>();

  publish(event: GeneratorEvent): void {
    const history = this.recent.get(event.runId) ?? [];
    this.recent.set(event.runId, [...history.slice(-39), event]);
    for (const listener of this.listeners.get(event.runId) ?? []) listener(event);
  }

  subscribe(runId: string, listener: Listener): () => void {
    const set = this.listeners.get(runId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(runId, set);
    for (const event of this.recent.get(runId) ?? []) listener(event);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(runId);
    };
  }
}
