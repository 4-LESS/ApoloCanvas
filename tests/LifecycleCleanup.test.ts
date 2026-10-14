import test from 'node:test';
import assert from 'node:assert/strict';

function makeMockDocument() {
    const createElement = (tag: string) => {
        const listeners = new Map<string, Function[]>();
        const props = new Map<string, string>();
        const el: any = {
            tagName: tag.toUpperCase(),
            className: '',
            hidden: false,
            style: {},
            textContent: '',
            children: [],
            parentElement: null,
            offsetHeight: 0,
            classList: {
                add: (...names: string[]) => {
                    const set = new Set((el.className || '').split(/\s+/).filter(Boolean));
                    for (const name of names) set.add(name);
                    el.className = [...set].join(' ');
                },
                remove: (...names: string[]) => {
                    const set = new Set((el.className || '').split(/\s+/).filter(Boolean));
                    for (const name of names) set.delete(name);
                    el.className = [...set].join(' ');
                },
                contains: (name: string) => (el.className || '').split(/\s+/).filter(Boolean).includes(name),
            },
            setAttribute: (name: string, value: string) => props.set(name, String(value)),
            getAttribute: (name: string) => props.get(name) ?? null,
            appendChild: (child: any) => {
                el.children.push(child);
                child.parentElement = el;
                return child;
            },
            remove: () => {
                if (el.parentElement) {
                    const idx = el.parentElement.children.indexOf(el);
                    if (idx >= 0) el.parentElement.children.splice(idx, 1);
                }
            },
        };
        el.addEventListener = (type: string, fn: Function) => {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type)!.push(fn);
        };
        el.dispatchEvent = (ev: any) => {
            const list = listeners.get(ev.type) || [];
            for (const fn of list) fn(ev);
            return true;
        };
        return el;
    };

    return {
        createElement,
    };
}

test('Toast destroys pending hide timers without leaking delayed hide work', async () => {
    const timers = new Map<number, Function>();
    let nextId = 1;

    const fakeWindow: any = {
        setTimeout: (fn: Function) => {
            const id = nextId++;
            timers.set(id, fn);
            return id;
        },
        clearTimeout: (id: number) => {
            timers.delete(id);
        },
    };

    (globalThis as any).window = fakeWindow;
    (globalThis as any).document = makeMockDocument();

    const { Toast } = await import('../src/ui/Toast.ts');
    const toast = new Toast({ appendChild() {} } as any);

    toast.show('Hello');
    toast.hide();
    const pendingIds = [...timers.keys()];
    assert.ok(pendingIds.length >= 1, 'hide should schedule a delayed cleanup timer');

    toast.destroy();
    assert.equal(timers.size, 0, 'destroy should clear outstanding toast timers');
});
