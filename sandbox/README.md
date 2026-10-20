# Arquitectura de Plumas y Lápices — ApoloCanvas Sandbox

Este directorio contiene el banco de pruebas modular (`sandbox/index.html`, `sandbox/server.mjs`), los motores de renderizado (`sandbox/engines/`) y las implementaciones de herramientas de dibujo (`sandbox/pens/`).

---

## 1. Herramientas Seleccionadas Finales

Las 4 herramientas principales de producción aparecen al inicio del selector del Sandbox y comparten el pipeline estandarizado $O(1)$ de [`pencil-common.js`](./pens/pencil-common.js):

| ID / Archivo | Nombre | Modelo Geométrico y Textura | Complejidad a 50k pts |
| :--- | :--- | :--- | :--- |
| [`ball.js`](./pens/ball.js) | **Bolígrafo** | Spline cuadrática continua por puntos medios ($M_i = \frac{P_{i-1}+P_i}{2}$), ancho monolínea constante (`0.9 * w`) y uniones redondeadas. | **$O(1)$** (`~0.01 ms/frame`, 120 FPS) |
| [`fountain-v2.js`](./pens/fountain-v2.js) | **Estilográfica v2 · O(1)** | Spline cuadrática subdividida con respuesta de presión Hermite ($\gamma=0.75$), límite de variación de radio por longitud de arco y **cápsulas tangenciales convexas** (trapecio horario + disco horario en el extremo). Cero grietas y cero costillas en giros de $0^\circ$ a $180^\circ$. | **$O(1)$** (`~0.01 ms/frame`, 120 FPS) |
| [`calli-v2.js`](./pens/calli-v2.js) | **Caligráfica v2 · O(1) (Bisel 2D)** | Plumilla física rectangular 2D de 4 esquinas fijas $(c_0, c_1, c_2, c_3)$ con semiancho de filo $L = 0.85w$ en $\vec{u}$ y semigrosor transversal físico $T = 0.14w$ en $\vec{n}$. Emite la **envolvente convexa hexagonal horaria** de $R(P_1) \cup R(P_2)$. Estable tanto en movimiento perpendicular ($2L$) como paralelo al bisel ($2T$). | **$O(1)$** (`~0.01 ms/frame`, 120 FPS) |
| [`pencil-sketch.js`](./pens/pencil-sketch.js) | **Lápiz 12 · Vector Sketch (Híbrido O(1))** | Campo de altitud toroidal $128\times 128$ rank-normalized con **2 patrones binarios anidados** (`coarse` $\subset$ `core`, alfa `255` o `0`) + cápsulas de winding positivo + filamentos secos discontinuos en ambos bordes. Paridad visual 1:1 entre Canvas y SVG sin filtros `feTurbulence`. | **$O(1)$** (`~0.01 ms/frame`, 120 FPS) |

---

## 2. Optimizaciones Estándar (Motor + Pipeline Compartido `createIncrementalPen`)

Para evitar duplicar lógica de buffers offscreen en cada lápiz —y permitir que futuros lápices personalizados sean minimalistas—, las optimizaciones de rendimiento están centralizadas entre el motor ([`optimized-engine.js`](./engines/optimized-engine.js)) y el núcleo compartido ([`pencil-common.js`](./pens/pencil-common.js)):

### 2.1. Qué hace el Motor (`OptimizedEngine` + `sandbox/index.html`)
1. **Separación Capa Seca (`dryCanvas`) vs. Capa Activa (`drawingCanvas`):**
   Los trazos terminados se empaquetan en sprites recortados a su `boundingBox` en resolución nativa `DPR`. Durante el dibujo de un trazo nuevo, todos los trazos anteriores cuestan un único `ctx.drawImage(this.dryCanvas, 0, 0)`.
2. **Throttling de Puntero a 240 Hz (4 ms) con `requestAnimationFrame` Final:**
   Los puntos de entrada (`getCoalescedEvents()`) se acumulan sin pérdida, pero el redibujado del canvas se limita a un máximo de 240 Hz para que ratones o stylus de 1000 Hz no bloqueen el hilo principal con múltiples redibujados dentro del mismo frame de pantalla.
3. **Diferimiento de Construcción SVG durante `Canvas Live`:**
   Mientras el usuario dibuja en la vista `Canvas Live`, no se reconstruye ni serializa el DOM SVG en cada frame (lo que en trazos de 50.000 puntos bloquearía el hilo ~100 ms por frame). El SVG se construye bajo demanda al cambiar a `Split` / `SVG Companion` y cachea el resultado de cada trazo terminado en `stroke._cachedSvgOut`.

### 2.2. Qué hace el Pipeline Compartido (`createIncrementalPen` + `createCachedSvgRenderer`)
Al construir un lápiz con `createIncrementalPen(spec)`, la herramienta obtiene automáticamente:

1. **Horneado Incremental $O(1)$ por Deltas (`Caso A — isMainCanvasLive`):**
   * En una spline cuadrática de puntos medios, el tramo hasta $M_{n-2}$ es 100% inmutable tan pronto como llega $P_{n-1}$.
   * En cada `pointermove`, `createIncrementalPen` invoca `renderDelta` **únicamente sobre el rango de puntos recién añadidos** `[bakedRawIdx .. freezeIdx]` en un buffer offscreen con `globalAlpha = 1.0`.
   * Como el horneado ocurre con alfa `1.0` (o patrones binarios anidados), la superposición entre tramos es **idempotente ($1.0 \cup 1.0 = 1.0$)**: jamás aparecen costuras oscuras aunque `style.opacity < 1`.
   * Finalmente vuelca el buffer al canvas principal con 1 solo `ctx.drawImage()` aplicando `ctx.globalAlpha = style.opacity` y dibuja únicamente la punta viva (~1 a 4 puntos).
2. **Commit de Sprite Instantáneo en `pointerup` sin Desplazamiento (`Caso B — isSpriteCommit`):**
   * Cuando `OptimizedEngine` suelta el trazo y solicita el sprite (`style.viewport`), `createIncrementalPen` hornea el último punto pendiente sobre el buffer en vivo y lo copia al sprite en **`< 0.2 ms`** respetando la transformación `(-bounds.minX, -bounds.minY)` del contexto del sprite (eliminando re-teselaciones de 50.000 puntos y evitando desplazamientos de coordenadas).
3. **Lotes Acotados (*Batch Flushing*) en Renderizado Frío (`Caso C`):**
   * Si un trazo largo se renderiza de golpe desde cero, los sub-paths se vacían (`ctx.fill('nonzero')` o `ctx.stroke()`) cada **32–128 segmentos**. Esto mantiene acotada la *Active Edge Table* (AET) del teselador 2D del navegador y evita la explosión superlineal $O((E+K)\log E)$ que causaba esperas de `> 1.500 ms` al meter 50.000 círculos y trapecios en un único `fill()`.
4. **Caché SVG con Validación de Longitud (`createCachedSvgRenderer`):**
   * Envuelve `renderSvg(points, style)` con un `WeakMap(points)` que verifica `cached.pointCount === points.length`. Así, aunque el motor mute `activePoints.push(pt)` en vivo sobre la misma referencia de array, el SVG siempre refleja todos los puntos actuales y nunca se queda congelado en el punto inicial de `pointerdown`.

---

## 3. Condiciones para que una Herramienta sea Válida

Cualquier archivo `.js` colocado en `sandbox/pens/` es auto-descubierto en caliente sin necesidad de editar `index.html`. Para ser válido y superar los tests de calidad y rendimiento (`tests/SandboxModular.test.ts`), debe cumplir las siguientes condiciones:

### 3.1. Contrato de Módulo (Exports)
```js
export const id = 'mi-lapiz';          // Identificador único (igual al nombre del archivo sin .js)
export const name = 'Mi Lápiz';        // Nombre visible en la UI del Sandbox
export const description = '...';      // Descripción técnica breve
export const incrementalBake = true;   // Indica soporte de estado incremental O(1)

export function renderCanvas(ctx, points, style) { ... }
export const renderPen = renderCanvas; // Alias de compatibilidad requerido por el motor
export function renderSvg(points, style) { ... } // Retorna { defs: Record<string, string>, body: string }
```
*(Si un archivo en `sandbox/pens/` no exporta `renderCanvas` ni `renderPen` —como `pencil-common.js`—, el cargador lo trata automáticamente como librería auxiliar y no lo añade a la lista de herramientas).*

### 3.2.Las 6 Invariantes Técnicas Obligatorias
1. **Guardia de Entrada Segura (`0` y `1` punto):**
   No debe lanzar errores con `points = []` ni con `points.length === 1` (un toque simple debe dibujar una huella puntual válida tanto en Canvas como en SVG).
2. **Devanado Horario Consistente (`+1` Winding en `fill('nonzero')`):**
   Si la herramienta rellena polígonos compuestos (`ctx.fill('nonzero')`), **todos** los sub-paths (trapecios, hexágonos y arcos `ctx.arc(..., false)`) deben emitirse en **sentido horario** en coordenadas de pantalla ($Y$ hacia abajo). Mezclar polígonos antihorarios (`-1`) con círculos horarios (`+1`) provoca cancelación booleana (`-1 + 1 = 0`) y abre huecos blancos en las uniones o auto-intersecciones.
3. **Invarianza Direccional en 360°:**
   La geometría de la punta no debe depender de signos discontinuos (`Math.sign(dot)`) que salten cuando el movimiento es paralelo o perpendicular al ángulo de la pluma.
4. **Idempotencia entre Tramos Horneados:**
   El horneado incremental en `renderDelta` debe realizarse a opacidad interna `1.0` (o con patrones de alfa binario `255`/`0`) para que la unión entre el tramo $k$ y el tramo $k+1$ no acumule manchas de opacidad en las costuras.
5. **Higiene del Contexto Canvas (`ctx`):**
   Si la herramienta modifica `ctx.setLineDash(...)`, `ctx.globalCompositeOperation` o `ctx.shadowBlur`, debe restaurarlos (p. ej. `ctx.setLineDash([])`) antes de terminar su pasada.
6. **Rendimiento $\ge 60\text{ FPS}$ Sostenidos hasta 50.000 Puntos:**
   Debe procesar únicamente el delta de puntos nuevos por frame mediante `createIncrementalPen` y vaciar el path en lotes acotados (`32..128` pasos).

---

## 4. Plantilla Mínima para Crear un Nuevo Lápiz Personalizado

Gracias a `createIncrementalPen` y `createCachedSvgRenderer`, implementar un nuevo lápiz $O(1)$ requiere únicamente definir cómo se dibuja un paso entre dos puntos:

```js
/**
 * sandbox/pens/mi-pluma-custom.js
 */
import { fmt, svgPathD, createIncrementalPen, createCachedSvgRenderer } from './pencil-common.js';

export const id = 'mi-pluma-custom';
export const name = 'Pluma Personalizada · O(1)';
export const description = 'Ejemplo minimalista usando el pipeline incremental estándar';
export const incrementalBake = true;

const { renderCanvas, resetCache } = createIncrementalPen({
    minLivePoints: 6,
    freezeLag: 1,
    minDeltaPoints: 1,
    defaultWidth: 4,
    defaultColor: '#1e1e1e',
    defaultOpacity: 1.0,

    renderSinglePoint(ctx, pt, _style, { baseWidth, color, opacity }) {
        ctx.fillStyle = color;
        ctx.globalAlpha = opacity;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, baseWidth * 0.5, 0, Math.PI * 2, false);
        ctx.fill();
    },

    initState(points) {
        return { lastMidX: points[0].x, lastMidY: points[0].y };
    },

    renderDelta(ctx, points, rawStart, rawEnd, _style, { baseWidth }, state) {
        ctx.lineWidth = baseWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        if (rawStart === 0) {
            state.lastMidX = points[0].x;
            state.lastMidY = points[0].y;
        }
        ctx.moveTo(state.lastMidX, state.lastMidY);

        let batch = 0;
        for (let i = Math.max(1, rawStart); i <= rawEnd; i++) {
            const p0 = points[i - 1];
            const p1 = points[i];
            const mx = (p0.x + p1.x) * 0.5;
            const my = (p0.y + p1.y) * 0.5;
            ctx.quadraticCurveTo(p0.x, p0.y, mx, my);
            state.lastMidX = mx;
            state.lastMidY = my;
            if (++batch >= 64) {
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(mx, my);
                batch = 0;
            }
        }
        if (batch > 0) ctx.stroke();
    },

    renderLiveTip(ctx, lastPt, _style, { baseWidth }, state) {
        ctx.lineWidth = baseWidth;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(state.lastMidX, state.lastMidY);
        ctx.lineTo(lastPt.x, lastPt.y);
        ctx.stroke();
    },
});

export { renderCanvas };
export const renderPen = renderCanvas;
export const resetCustomCache = resetCache;

export const renderSvg = createCachedSvgRenderer((points, style = {}) => {
    const w = Math.max(1, style.width || 4);
    const color = style.color || '#1e1e1e';
    const opacity = style.opacity ?? 1.0;
    const d = svgPathD(points);
    return {
        defs: {},
        body: `<path d="${d}" fill="none" stroke="${color}" stroke-width="${fmt(w)}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${opacity.toFixed(2)}"/>`,
    };
});
```
