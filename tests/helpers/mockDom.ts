import assert from 'node:assert/strict';
import {
    DEFAULT_WORKSPACE_TOOL_STATE,
    cloneWorkspaceToolState,
    type PageDocument,
    type ShapeElement,
    type WorkspaceToolState,
} from '../../src/core/types.ts';
import { CanvasController, type CanvasControllerOptions } from '../../src/engine/CanvasController.ts';
import {
    applyGeometryToShapeElement,
    shapeElementToGeometry,
    type ConnectorGeometryAdapter,
} from '../../src/engine/shapes/index.ts';
import { PopoverController } from '../../src/ui/kit/index.ts';
import { Toolbar, type ToolbarOptions } from '../../src/ui/Toolbar.ts';
import { ToolEstuche, type ToolEstucheCallbacks, type ToolEstucheState } from '../../src/ui/ToolEstuche.ts';

export type MockEnvironment = {
    mockDocument: any;
    mockWindow: any;
};

export interface MockRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export interface MockEnvironmentOptions {
    defaultRect?: MockRect | 'offset';
    defaultOffset?: { width: number; height: number };
}

export function createMockContext(): any {
    return {
        save: () => {},
        restore: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        quadraticCurveTo: () => {},
        arc: () => {},
        ellipse: () => {},
        roundRect: () => {},
        rect: () => {},
        fillRect: () => {},
        strokeRect: () => {},
        fillText: () => {},
        fill: () => {},
        stroke: () => {},
        clearRect: () => {},
        drawImage: () => {},
        setLineDash: () => {},
        createPattern: () => null,
        translate: () => {},
        scale: () => {},
        transform: () => {},
        setTransform: () => {},
        resetTransform: () => {},
        clip: () => {},
        closePath: () => {},
        lineWidth: 1,
        strokeStyle: '#000',
        fillStyle: '#000',
        globalAlpha: 1,
        lineCap: 'round',
        lineJoin: 'round',
        globalCompositeOperation: 'source-over',
    };
}

export function createMockEnvironment(options: MockEnvironmentOptions = {}): any {
    const listeners = new Map<string, Array<{ listener: Function; options?: any }>>();
    const mockCtx = createMockContext();
    let matchesSelector: (node: any, sel: string) => boolean = () => false;

    const createElement = (tag: string) => {
        const children: any[] = [];
        const classes = new Set<string>();
        const attributes = new Map<string, string>();
        const elementListeners = new Map<string, Array<{ fn: Function; options?: any }>>();
        const styleObj: any = {
            display: '',
            zIndex: '',
            position: '',
            top: '',
            left: '',
            right: '',
            bottom: '',
            transform: '',
            touchAction: '',
            overflow: '',
            overflowX: '',
            overflowY: '',
            setProperty: (k: string, v: string) => { styleObj[k] = v; },
            getPropertyValue: (k: string) => styleObj[k] ?? '',
        };

        matchesSelector = (node: any, sel: string): boolean => {
            if (!node || typeof node !== 'object') return false;
            if (sel.includes(',')) {
                return sel.split(',').some(s => matchesSelector(node, s.trim()));
            }
            const notMatch = sel.match(/^([a-zA-Z0-9_.-]+)?:not\((.+)\)$/);
            if (notMatch) {
                const baseSel = notMatch[1];
                const negatedSel = notMatch[2];
                if (baseSel && !matchesSelector(node, baseSel)) return false;
                return !matchesSelector(node, negatedSel);
            }
            if (/^[a-zA-Z0-9]+(\.[a-zA-Z0-9_-]+)+$/.test(sel)) {
                const [tagPart, ...classParts] = sel.split('.');
                if (tagPart.toLowerCase() !== node.tagName?.toLowerCase()) return false;
                return classParts.every(cls => Boolean(node.classList?.contains(cls) || node.className?.split(/\s+/).includes(cls)));
            }
            if (sel.startsWith('.')) {
                const targetClasses = sel.slice(1).split('.');
                return targetClasses.every(cls => Boolean(node.classList?.contains(cls) || node.className?.split(/\s+/).includes(cls)));
            }
            const tagAttrMatch = sel.match(/^([a-zA-Z0-9_-]+)?\[([^\]]+)\]$/);
            if (tagAttrMatch) {
                const tagPart = tagAttrMatch[1];
                if (tagPart && tagPart.toLowerCase() !== node.tagName?.toLowerCase()) return false;
                const inner = tagAttrMatch[2];
                const prefixIdx = inner.indexOf('^=');
                if (prefixIdx !== -1) {
                    const attr = inner.slice(0, prefixIdx).trim();
                    const prefix = inner.slice(prefixIdx + 2).replace(/^["']|["']$/g, '');
                    const val = node.getAttribute(attr);
                    return typeof val === 'string' && val.startsWith(prefix);
                }
                const eqIdx = inner.indexOf('=');
                if (eqIdx !== -1) {
                    const attr = inner.slice(0, eqIdx).trim();
                    const val = inner.slice(eqIdx + 1).replace(/^["']|["']$/g, '');
                    return node.getAttribute(attr) === val || node.dataset?.[attr.replace('data-', '')] === val;
                }
                return node.hasAttribute(inner);
            }
            if (sel.startsWith('#')) return node.id === sel.slice(1);
            if (sel.toLowerCase() === node.tagName?.toLowerCase()) return true;
            return false;
        };

        const el: any = {
            tagName: tag.toUpperCase(),
            style: styleObj,
            dataset: {},
            hidden: false,
            get className(): string {
                return [...classes].join(' ');
            },
            set className(v: string) {
                classes.clear();
                for (const c of String(v).split(/\s+/).filter(Boolean)) classes.add(c);
            },
            children,
            title: '',
            type: '',
            value: '',
            disabled: false,
            maxLength: 24,
            placeholder: '',
            width: 800,
            height: 600,
            clientWidth: 800,
            clientHeight: 600,
            scrollWidth: options.defaultRect === 'offset' ? 0 : 800,
            scrollHeight: options.defaultRect === 'offset' ? 0 : 600,
            scrollLeft: 0,
            scrollTop: 0,
            isConnected: true,
            getContext: () => mockCtx,
            toDataURL: () => 'data:image/png;base64,',
            focus: () => {},
            blur: () => {},
            get textContent(): string {
                return children.map(c => typeof c === 'string' ? c : (c?.textContent ?? '')).join('');
            },
            set textContent(v: string) {
                children.length = 0;
                if (v !== '') children.push(String(v));
            },
            get firstChild(): any {
                return children[0] ?? null;
            },
            classList: {
                add: (...cs: string[]) => {
                    for (const c of cs) {
                        for (const item of c.split(/\s+/).filter(Boolean)) classes.add(item);
                    }
                },
                remove: (...cs: string[]) => {
                    for (const c of cs) {
                        for (const item of c.split(/\s+/).filter(Boolean)) classes.delete(item);
                    }
                },
                contains: (c: string) => classes.has(c),
                toggle: (c: string, force?: boolean) => {
                    const next = force !== undefined ? force : !classes.has(c);
                    if (next) classes.add(c); else classes.delete(c);
                    return next;
                },
            },
            setAttribute: (k: string, v: string) => {
                const val = String(v);
                attributes.set(k, val);
                if (k === 'class') {
                    el.className = val;
                } else if (k.startsWith('data-')) {
                    const dataKey = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
                    el.dataset[dataKey] = val;
                }
            },
            getAttribute: (k: string) => attributes.get(k) ?? null,
            hasAttribute: (k: string) => attributes.has(k),
            removeAttribute: (k: string) => {
                attributes.delete(k);
                if (k === 'class') {
                    el.className = '';
                } else if (k.startsWith('data-')) {
                    const dataKey = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
                    delete el.dataset[dataKey];
                }
            },
            appendChild: (child: any) => {
                if (child !== null && child !== undefined) {
                    children.push(child);
                    if (typeof child === 'object') child.parentElement = el;
                }
                return child;
            },
            append: (...args: any[]) => {
                for (const c of args) {
                    if (c !== null && c !== undefined) {
                        children.push(c);
                        if (typeof c === 'object') c.parentElement = el;
                    }
                }
            },
            replaceChildren: (...args: any[]) => {
                children.length = 0;
                for (const c of args) {
                    if (c !== null && c !== undefined) {
                        children.push(c);
                        if (typeof c === 'object') c.parentElement = el;
                    }
                }
            },
            empty: () => {
                el.replaceChildren();
            },
            remove: () => {
                if (el.parentElement?.children) {
                    const idx = el.parentElement.children.indexOf(el);
                    if (idx !== -1) el.parentElement.children.splice(idx, 1);
                }
            },
            contains: (target: any) => target === el || children.some(c => c === target || c?.contains?.(target)),
            querySelector: (sel: string): any => {
                const findIn = (node: any): any => {
                    if (!node || typeof node !== 'object') return null;
                    if (matchesSelector(node, sel)) return node;
                    for (const child of node.children || []) {
                        const res = findIn(child);
                        if (res) return res;
                    }
                    return null;
                };
                for (const child of children) {
                    const res = findIn(child);
                    if (res) return res;
                }
                return null;
            },
            querySelectorAll: (sel: string): any[] => {
                const results: any[] = [];
                const collect = (node: any) => {
                    if (!node || typeof node !== 'object') return;
                    if (matchesSelector(node, sel)) results.push(node);
                    for (const child of node.children || []) collect(child);
                };
                for (const child of children) collect(child);
                return results;
            },
            closest: (sel: string): any => {
                let cur: any = el;
                while (cur) {
                    if (matchesSelector(cur, sel)) return cur;
                    cur = cur.parentElement;
                }
                return null;
            },
            addEventListener: (type: string, fn: Function, options?: any) => {
                if (!elementListeners.has(type)) elementListeners.set(type, []);
                elementListeners.get(type)!.push({ fn, options });
            },
            removeEventListener: (type: string, fn: Function) => {
                const list = elementListeners.get(type);
                if (list) {
                    const idx = list.findIndex(item => item.fn === fn);
                    if (idx !== -1) list.splice(idx, 1);
                }
            },
            dispatch: (ev: any) => el.dispatchEvent(ev),
            dispatchEvent: (evObj: any) => {
                let stoppedImmediate = false;
                const origStopImmediate = evObj.stopImmediatePropagation;
                evObj.stopImmediatePropagation = () => {
                    stoppedImmediate = true;
                    if (origStopImmediate) origStopImmediate();
                };
                const list = elementListeners.get(evObj.type) || [];
                for (const item of [...list]) {
                    if (stoppedImmediate) break;
                    item.fn(evObj);
                }
                return !evObj.defaultPrevented;
            },
            dispatchPointerEvent: (type: string, eventInit: { clientX: number; clientY: number }) => {
                const listeners = elementListeners.get(type) || [];
                const event = {
                    ...eventInit,
                    target: el,
                    currentTarget: el,
                    stopPropagation: () => {},
                    preventDefault: () => {},
                };
                for (const listener of listeners) {
                    listener.fn(event);
                }
            },
            click: () => {
                const ev = {
                    type: 'click',
                    target: el,
                    currentTarget: el,
                    defaultPrevented: false,
                    preventDefault: () => { ev.defaultPrevented = true; },
                    stopPropagation: () => {},
                    stopImmediatePropagation: () => {},
                };
                if (typeof el.onclick === 'function') el.onclick(ev);
                el.dispatchEvent(ev);
            },
            getBoundingClientRect: () => {
                if (options.defaultRect === 'offset') {
                    return {
                        left: 0,
                        top: 0,
                        right: 0,
                        bottom: 0,
                        width: el.offsetWidth || 0,
                        height: el.offsetHeight || 0,
                        x: 0,
                        y: 0,
                        toJSON: () => {},
                    };
                }
                const rect = options.defaultRect ?? {
                    top: 0,
                    bottom: 600,
                    left: 0,
                    right: 800,
                    width: 800,
                    height: 600,
                };
                return {
                    ...rect,
                    x: rect.left,
                    y: rect.top,
                    toJSON: () => {},
                };
            },
            offsetWidth: options.defaultRect === 'offset' ? (options.defaultOffset?.width ?? 0) : (options.defaultOffset?.width ?? 280),
            offsetHeight: options.defaultRect === 'offset' ? (options.defaultOffset?.height ?? 0) : (options.defaultOffset?.height ?? 320),
            onclick: null as any,
            onkeydown: null as any,
        };
        return el;
    };

    const body = createElement('body');
    const mockDocument: any = {
        documentElement: createElement('html'),
        body,
        createElement,
        createElementNS: (_ns: string, tag: string) => createElement(tag),
        elementsFromPoint: () => [],
        querySelector: (sel: string) => body.querySelector(sel),
        querySelectorAll: (sel: string) => body.querySelectorAll(sel),
        addEventListener: (event: string, listener: Function, options?: any) => {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event)!.push({ listener, options });
        },
        removeEventListener: (event: string, listener: Function) => {
            const list = listeners.get(event);
            if (list) {
                const idx = list.findIndex(item => item.listener === listener);
                if (idx !== -1) list.splice(idx, 1);
            }
        },
        dispatchEvent: (evObj: any) => {
            const list = listeners.get(evObj?.type) || [];
            for (const item of [...list]) {
                item.listener(evObj);
            }
            return !evObj?.defaultPrevented;
        },
    };
    mockDocument.dispatch = (event: string, evObj: any) => mockDocument.dispatchEvent({ type: event, ...evObj });

    return mockDocument;
}

export function createMockWindow(mockDocument?: any): any {
    const listeners = new Map<string, Array<{ listener: Function; options?: any }>>();
    const dispatch = (event: string, evObj: any = {}) => {
        const list = listeners.get(event) || [];
        for (const item of [...list]) {
            item.listener(evObj);
        }
    };
    return {
        document: mockDocument,
        innerWidth: 1024,
        innerHeight: 768,
        visualViewport: null,
        devicePixelRatio: 1,
        addEventListener: (event: string, listener: Function, options?: any) => {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event)!.push({ listener, options });
        },
        removeEventListener: (event: string, listener: Function) => {
            const list = listeners.get(event);
            if (list) {
                const idx = list.findIndex(item => item.listener === listener);
                if (idx !== -1) list.splice(idx, 1);
            }
        },
        dispatch,
        dispatchEvent: (evObj: any) => {
            dispatch(evObj?.type ?? '', evObj);
            return !evObj?.defaultPrevented;
        },
        setTimeout: (fn: Function, ms?: number) => setTimeout(fn, ms ?? 0),
        clearTimeout: (id: any) => clearTimeout(id),
        requestAnimationFrame: (cb: Function) => setTimeout(cb, 16),
        cancelAnimationFrame: (id: any) => clearTimeout(id),
    };
}

export function createMockWindowAndDoc(options: MockEnvironmentOptions = {}): { mockWindow: any; mockDocument: any; mockCtx: any } {
    const mockDocument = createMockEnvironment(options);
    const mockWindow = createMockWindow(mockDocument);
    return { mockWindow, mockDocument, mockCtx: mockDocument.createElement('canvas').getContext('2d') };
}

export function installDom(options: MockEnvironmentOptions = {}): any {
    const { mockWindow, mockDocument } = createMockWindowAndDoc(options);
    (globalThis as any).document = mockDocument;
    (globalThis as any).window = mockWindow;
    return mockDocument;
}

export function setupMockDom(options: MockEnvironmentOptions = {}): {
    teardown: () => void;
    mockDoc: any;
    mockWindow: any;
    env: MockEnvironment;
} {
    const prevDoc = (globalThis as any).document;
    const prevWindow = (globalThis as any).window;
    const { mockDocument: mockDoc, mockWindow } = createMockWindowAndDoc(options);

    const prevRAF = (globalThis as any).requestAnimationFrame;
    const prevCAF = (globalThis as any).cancelAnimationFrame;
    const prevComputedStyle = (globalThis as any).getComputedStyle;
    const prevResizeObserver = (globalThis as any).ResizeObserver;

    (globalThis as any).document = mockDoc;
    (globalThis as any).window = mockWindow;
    (globalThis as any).requestAnimationFrame = (cb: Function) => setTimeout(cb, 16);
    (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
    (globalThis as any).getComputedStyle = () => ({ position: 'relative', overflow: 'auto', userSelect: 'none' });
    (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

    return {
        mockDoc,
        mockWindow,
        env: {
            mockDocument: mockDoc,
            mockWindow,
        },
        teardown: () => {
            (globalThis as any).document = prevDoc;
            (globalThis as any).window = prevWindow;
            (globalThis as any).requestAnimationFrame = prevRAF;
            (globalThis as any).cancelAnimationFrame = prevCAF;
            (globalThis as any).getComputedStyle = prevComputedStyle;
            (globalThis as any).ResizeObserver = prevResizeObserver;
        },
    };
}

/** Shared layout constants and test helpers for shapes, canvas controllers, and UI tests. */
export const CONTENT_LEFT = 100;
export const CONTENT_WIDTH = 800;

export const identityAdapter: ConnectorGeometryAdapter = {
    getGeometry: (el) => shapeElementToGeometry(el, 0, 0, 1),
    setGeometry: (el, geom) => applyGeometryToShapeElement(el, geom, 0, 0, 1),
};

export function makeShape(
    id: string,
    shapeType: string,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    extra: Partial<ShapeElement> = {},
): ShapeElement {
    return {
        id,
        type: 'shape',
        shapeType,
        timestamp: 0,
        zIndex: 0,
        blockId: 'line:0',
        startX: x0,
        startY: y0,
        endX: x1,
        endY: y1,
        style: { color: '#111111', width: 2, pattern: 'solid', opacity: 1 },
        bounds: {
            minX: Math.min(x0, x1),
            minY: Math.min(y0, y1),
            maxX: Math.max(x0, x1),
            maxY: Math.max(y0, y1),
        },
        ...extra,
    };
}

export function createMockCanvasCtx() {
    const strokes: Array<{ style: unknown; alpha: number }> = [];
    const fills: Array<{ style: unknown; alpha: number }> = [];
    const arcs: unknown[][] = [];
    const texts: unknown[][] = [];
    const ops: Array<{ op: string; args: unknown[] }> = [];
    let closedCount = 0;
    let clippedCount = 0;
    const record = (op: string, args: unknown[]) => {
        ops.push({ op, args });
    };
    const ctx: any = {
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 1,
        lineCap: 'butt',
        lineJoin: 'miter',
        globalAlpha: 1,
        save() { record('save', []); },
        restore() { record('restore', []); },
        beginPath() { record('beginPath', []); },
        moveTo(...a: unknown[]) { record('moveTo', a); },
        lineTo(...a: unknown[]) { record('lineTo', a); },
        bezierCurveTo(...a: unknown[]) { record('bezierCurveTo', a); },
        quadraticCurveTo(...a: unknown[]) { record('quadraticCurveTo', a); },
        arc(...a: unknown[]) { arcs.push(a); record('arc', a); },
        ellipse(...a: unknown[]) { record('ellipse', a); },
        rect(...a: unknown[]) { record('rect', a); },
        fillRect(...a: unknown[]) { fills.push({ style: this.fillStyle, alpha: this.globalAlpha }); record('fillRect', a); },
        fillText(...a: unknown[]) { texts.push(a); record('fillText', a); },
        clip() { clippedCount++; record('clip', []); },
        closePath() { closedCount++; record('closePath', []); },
        translate(...a: unknown[]) { record('translate', a); },
        rotate(...a: unknown[]) { record('rotate', a); },
        scale(...a: unknown[]) { record('scale', a); },
        setLineDash(...a: unknown[]) { record('setLineDash', a); },
        createPattern: () => null,
        stroke() { strokes.push({ style: this.strokeStyle, alpha: this.globalAlpha }); record('stroke', []); },
        fill() { fills.push({ style: this.fillStyle, alpha: this.globalAlpha }); record('fill', []); },
    };
    return {
        ctx,
        ops,
        strokes,
        fills,
        arcs,
        texts,
        state: ctx,
        get closedCount() { return closedCount; },
        get clippedCount() { return clippedCount; },
    };
}

export function assertNear(actual: number, expected: number, eps = 1e-6, label = ''): void {
    const prefix = label ? `${label}: ` : '';
    assert.ok(Math.abs(actual - expected) <= eps, `${prefix}Expected ${actual} to be within ${eps} of ${expected}`);
}

export function createControllerOptions(overrides: Partial<CanvasControllerOptions> = {}): CanvasControllerOptions {
    return {
        palmRejectionCooldownMs: 400,
        autoSaveDebounceMs: 500,
        defaultPenColor: '#1F4FD8',
        defaultPenWidth: 3,
        enabled: true,
        enableMouseDrawing: false,
        shapeRecognition: false,
        straightenLines: false,
        app: {
            metadataCache: { getFileCache: () => null },
            vault: { cachedRead: async () => '', process: async () => {} },
        } as any,
        ...overrides,
    };
}

export function createTestController(
    configure: (state: WorkspaceToolState) => void = () => {},
    extraOptions: Partial<CanvasControllerOptions> & { docModel?: PageDocument; notePath?: string } = {},
) {
    const mockDocument = installDom();
    const scroller = mockDocument.createElement('div');
    scroller.getBoundingClientRect = () => ({ top: 0, left: 0, width: 1000, height: 1000, bottom: 1000, right: 1000 });
    const contentEl = mockDocument.createElement('div');
    contentEl.className = 'cm-content';
    contentEl.offsetWidth = CONTENT_WIDTH;
    contentEl.getBoundingClientRect = () => ({
        top: 0,
        left: CONTENT_LEFT,
        width: CONTENT_WIDTH,
        height: 2000,
        bottom: 2000,
        right: CONTENT_LEFT + CONTENT_WIDTH,
    });
    scroller.appendChild(contentEl);

    const { docModel: customDoc, notePath = 'suite.md', ...controllerExtra } = extraOptions;
    const docModel: PageDocument = customDoc ?? {
        schemaVersion: 1,
        version: 1,
        id: 'suite-page',
        notePath,
        elements: [],
        createdAt: 1000,
        updatedAt: 1000,
    };
    const persistence = { flush: async () => {}, enqueue: () => {}, loadDocumentForNote: async () => docModel } as any;
    const toolState = cloneWorkspaceToolState(DEFAULT_WORKSPACE_TOOL_STATE);
    configure(toolState);

    const controller = new CanvasController(
        scroller as any,
        undefined,
        docModel,
        { path: notePath, basename: notePath.replace(/\.md$/, '') } as any,
        notePath,
        persistence,
        { ...createControllerOptions(), toolState, enableMouseDrawing: true, ...controllerExtra } as any,
    );
    return { controller, canvas: (controller as any).canvas, internals: controller as any, docModel, scroller, contentEl, mockDocument };
}

let gestureClock = 10_000;

export function pointer(
    canvas: any,
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    x: number,
    y: number,
    extra: number | Record<string, any> = (gestureClock += 16),
): void {
    const timeStamp = typeof extra === 'number' ? extra : (gestureClock += 16);
    const overrides = typeof extra === 'object' ? extra : {};
    canvas.dispatchEvent({
        type,
        pointerId: 1,
        pointerType: 'pen',
        clientX: x,
        clientY: y,
        buttons: type === 'pointerup' ? 0 : 1,
        button: 0,
        pressure: type === 'pointerup' ? 0 : 0.5,
        shiftKey: false,
        timeStamp,
        preventDefault: () => {},
        stopPropagation: () => {},
        ...overrides,
    });
}

export function dragGesture(canvas: any, from: [number, number], to: [number, number], steps = 4): void {
    pointer(canvas, 'pointerdown', from[0], from[1]);
    for (let i = 1; i <= steps; i++) {
        pointer(canvas, 'pointermove', from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
    }
    pointer(canvas, 'pointerup', to[0], to[1]);
}

export function tapGesture(canvas: any, at: [number, number]): void {
    pointer(canvas, 'pointerdown', at[0], at[1]);
    pointer(canvas, 'pointerup', at[0], at[1]);
}

export function createTestEstuche(
    stateOverrides: Partial<ToolEstucheState> = {},
    callbackOverrides: Partial<ToolEstucheCallbacks> = {},
    root: HTMLElement = (globalThis as any).document.createElement('div'),
    popoverController?: PopoverController,
): { estuche: ToolEstuche; root: HTMLElement; state: ToolEstucheState; callbacks: ToolEstucheCallbacks } {
    const state: ToolEstucheState = {
        tool: 'pen',
        slot: 'tc',
        color: '#1F4FD8',
        width: 3,
        profileId: 'fountain',
        smoothing: 0.6,
        pressureSensitivity: 0.5,
        opacity: 1,
        lineStyle: 'solid',
        pattern: 'solid',
        straightenLines: false,
        favorites: [],
        eraserMode: 'whole',
        eraserRadius: 20,
        scribbleToErase: false,
        lassoMode: 'freeform',
        shapeType: 'rect',
        snapGrid: false,
        isCurrentFavorite: false,
        showingFavorites: false,
        ...stateOverrides,
    };
    const callbacks: ToolEstucheCallbacks = {
        onSelectProfile: () => {},
        onChangeColor: () => {},
        onChangeWidth: () => {},
        onChangeSmoothing: () => {},
        onChangePressure: () => {},
        onChangeLineStyle: () => {},
        onUseFavorite: () => {},
        onSaveFavorite: () => {},
        onSelectEraserMode: () => {},
        onChangeEraserRadius: () => {},
        onToggleScribble: () => {},
        onSelectLassoMode: () => {},
        onSelectShapeType: () => {},
        onToggleSnapGrid: () => {},
        onToggleStraighten: () => {},
        onClose: () => {},
        ...callbackOverrides,
    };
    const estuche = new ToolEstuche(state, callbacks, root, popoverController);
    return { estuche, root, state, callbacks };
}

export function createToolbarOptions(overrides: Partial<ToolbarOptions> = {}): ToolbarOptions {
    return {
        slot: 'tc',
        penEnabled: true,
        activeTool: 'pen',
        activeShape: 'rect',
        activeColor: '#000000',
        activeWidth: 3,
        activeProfileId: 'fountain',
        activeFavoriteIndex: 0,
        favorites: [
            { color: '#000000', width: 2, profileId: 'fountain' },
            { color: '#e03131', width: 3, profileId: 'ball' },
            { color: '#2f9e44', width: 4, profileId: 'fountain' },
            { color: '#1971c2', width: 5, profileId: 'calli' },
        ],
        snapGrid: false,
        canUndo: false,
        canRedo: false,
        eraserRadius: 16,
        eraserMode: 'whole',
        onSlotChange: () => {},
        onToggleKeyboardMode: () => {},
        onSelectTool: () => {},
        onToggleEstuche: () => {},
        onUndo: () => {},
        onRedo: () => {},
        onSelectFavorite: () => {},
        onSelectThickness: () => {},
        onToggleSnapGrid: () => {},
        onToggleMoreMenu: () => {},
        onInsertCanvas: () => {},
        ...overrides,
    };
}

export function createTestToolbar(
    overrides: Partial<ToolbarOptions> = {},
    parent: HTMLElement = (globalThis as any).document.body,
): { toolbar: Toolbar; options: ToolbarOptions } {
    const options = createToolbarOptions(overrides);
    const toolbar = new Toolbar(options, parent);
    return { toolbar, options };
}
