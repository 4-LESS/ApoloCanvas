import type { ToolType, StrokeStyle, CanvasElement, BoundingBox, ShapeType, PenProfileId } from './types.ts';

export interface EngineEvents {
    'tool:changed': (tool: ToolType, shapeType?: ShapeType) => void;
    'style:changed': (style: Partial<StrokeStyle>, profileId?: PenProfileId) => void;
    'selection:changed': (selected: CanvasElement[], bounds: BoundingBox | null) => void;
    'pen:changed': (penEnabled: boolean) => void;
    'straighten:changed': (enabled: boolean) => void;
    'snap:detected': (shapeType: ShapeType, x: number, y: number) => void;
    'canvas:dirty': (pageId: string) => void;
    'zoom:changed': (zoom: number) => void;
    'history:changed': (canUndo: boolean, canRedo: boolean) => void;
    'favorites:cycle': () => void;
    'save:status': (isSaving: boolean, lastSavedAt: number) => void;
    'toast': (message: string) => void;
}

export class EngineEventBus {
    private listeners = new Map<keyof EngineEvents, Set<(...args: never[]) => void>>();

    on<K extends keyof EngineEvents>(event: K, handler: EngineEvents[K]): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set<(...args: never[]) => void>());
        }
        this.listeners.get(event)!.add(handler as (...args: never[]) => void);
        return () => this.off(event, handler);
    }

    off<K extends keyof EngineEvents>(event: K, handler: EngineEvents[K]): void {
        const set = this.listeners.get(event);
        if (set) {
            set.delete(handler as (...args: never[]) => void);
            if (set.size === 0) {
                this.listeners.delete(event);
            }
        }
    }

    emit<K extends keyof EngineEvents>(event: K, ...args: Parameters<EngineEvents[K]>): void {
        const set = this.listeners.get(event);
        if (set) {
            for (const storedHandler of set) {
                try {
                    const handler = storedHandler as unknown as (...values: Parameters<EngineEvents[K]>) => void;
                    handler(...args);
                } catch (err) {
                    console.error(`[ApoloCanvas] Error in event listener for ${event}:`, err);
                }
            }
        }
    }
}
