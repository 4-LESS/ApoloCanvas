export type MockEnvironment = {
    mockDocument: any;
    mockWindow: any;
};

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

export function createMockEnvironment(): any {
    const listeners = new Map<string, Array<{ listener: Function; options?: any }>>();
    const mockCtx = createMockContext();

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
            setProperty: (k: string, v: string) => { styleObj[k] = v; },
            getPropertyValue: (k: string) => styleObj[k] ?? '',
        };

        const matchesSelector = (node: any, sel: string): boolean => {
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
            if (sel.startsWith('#')) return node.id === sel.slice(1);
            if (sel.startsWith('[') && sel.endsWith(']')) {
                const inner = sel.slice(1, -1);
                const eqIdx = inner.indexOf('=');
                if (eqIdx !== -1) {
                    const attr = inner.slice(0, eqIdx);
                    const val = inner.slice(eqIdx + 1).replace(/^["']|["']$/g, '');
                    return node.getAttribute(attr) === val || node.dataset?.[attr.replace('data-', '')] === val;
                }
                return node.hasAttribute(inner);
            }
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
            scrollWidth: 800,
            scrollHeight: 600,
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
                attributes.set(k, String(v));
                if (k.startsWith('data-')) {
                    const dataKey = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
                    el.dataset[dataKey] = String(v);
                }
            },
            getAttribute: (k: string) => attributes.get(k) ?? null,
            hasAttribute: (k: string) => attributes.has(k),
            removeAttribute: (k: string) => {
                attributes.delete(k);
                if (k.startsWith('data-')) {
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
            closest: (_sel: string): any => null,
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
            getBoundingClientRect: () => ({
                top: 0,
                bottom: 600,
                left: 0,
                right: 800,
                width: 800,
                height: 600,
                x: 0,
                y: 0,
                toJSON: () => {},
            }),
            offsetWidth: 280,
            offsetHeight: 320,
            onclick: null as any,
            onkeydown: null as any,
        };
        return el;
    };

    const mockDocument: any = {
        body: createElement('body'),
        createElement,
        createElementNS: (_ns: string, tag: string) => createElement(tag),
        elementsFromPoint: () => [],
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
    };

    return mockDocument;
}

export function setupMockDom(): { teardown: () => void; mockDoc: any; mockWindow: any } {
    const prevDoc = (globalThis as any).document;
    const prevWindow = (globalThis as any).window;
    const mockDoc = createMockEnvironment();
    const listeners = new Map<string, Array<{ listener: Function; options?: any }>>();
    const mockWindow: any = {
        document: mockDoc,
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
        dispatch: (event: string, evObj: any) => {
            const list = listeners.get(event) || [];
            for (const item of [...list]) {
                item.listener(evObj);
            }
        },
        setTimeout: (fn: Function, ms?: number) => setTimeout(fn, ms ?? 0),
        clearTimeout: (id: any) => clearTimeout(id),
        requestAnimationFrame: (cb: Function) => setTimeout(cb, 16),
        cancelAnimationFrame: (id: any) => clearTimeout(id),
    };

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
