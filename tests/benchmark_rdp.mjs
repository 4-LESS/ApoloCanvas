import zlib from 'node:zlib';

// Ramer-Douglas-Peucker simplification algorithm for normalized strokes
function rdpSimplify(points, epsilon = 0.0012) {
    if (points.length <= 8) return points; // 2 points (x, y, p, t)
    
    const count = points.length / 4;
    
    function findFurthest(startIdx, endIdx) {
        const x1 = points[startIdx * 4];
        const y1 = points[startIdx * 4 + 1];
        const x2 = points[endIdx * 4];
        const y2 = points[endIdx * 4 + 1];

        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;

        let maxDist = 0;
        let index = startIdx;

        for (let i = startIdx + 1; i < endIdx; i++) {
            const x = points[i * 4];
            const y = points[i * 4 + 1];
            let dist = 0;

            if (lenSq === 0) {
                dist = Math.hypot(x - x1, y - y1);
            } else {
                const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lenSq));
                const projX = x1 + t * dx;
                const projY = y1 + t * dy;
                dist = Math.hypot(x - projX, y - projY);
            }

            if (dist > maxDist) {
                maxDist = dist;
                index = i;
            }
        }
        return { index, maxDist };
    }

    const keep = new Uint8Array(count);
    keep[0] = 1;
    keep[count - 1] = 1;

    function recurse(start, end) {
        if (end <= start + 1) return;
        const { index, maxDist } = findFurthest(start, end);
        if (maxDist > epsilon) {
            keep[index] = 1;
            recurse(start, index);
            recurse(index, end);
        }
    }

    recurse(0, count - 1);

    const result = [];
    for (let i = 0; i < count; i++) {
        if (keep[i]) {
            result.push(points[i * 4], points[i * 4 + 1], points[i * 4 + 2], points[i * 4 + 3]);
        }
    }
    return result;
}

// Generate realistic strokes
function generateHandwritingStrokes(count) {
    const strokes = [];
    let curX = 0.1, curY = 0.05;
    for (let s = 0; s < count; s++) {
        const numPts = Math.floor(25 + Math.random() * 45);
        const pts = [];
        let px = curX, py = curY, p = 0.5;
        for (let i = 0; i < numPts; i++) {
            px += (Math.random() - 0.48) * 0.006;
            py += (Math.random() - 0.48) * 0.006;
            p = Math.max(0.1, Math.min(1, p + (Math.random() - 0.5) * 0.04));
            pts.push(px, py, p, i * 8);
        }
        strokes.push({
            id: `s-${s}`,
            points: pts,
            color: '#111827',
            width: 2.0
        });
        curX += 0.02;
        if (curX > 0.9) { curX = 0.1; curY += 0.035; if (curY > 1.4) curY = 0.05; }
    }
    return strokes;
}

console.log('=== BENCHMARK CON SIMPLIFICACIÓN RDP ===\n');

for (const count of [1000, 5000, 8000]) {
    const rawStrokes = generateHandwritingStrokes(count);
    const rawPts = rawStrokes.reduce((acc, s) => acc + s.points.length / 4, 0);

    const t0Rdp = performance.now();
    const simplifiedStrokes = rawStrokes.map(s => ({
        ...s,
        points: rdpSimplify(s.points, 0.0008) // 0.08% de ancho de columna (~0.6px a 800px)
    }));
    const tRdp = (performance.now() - t0Rdp).toFixed(2);
    const simpPts = simplifiedStrokes.reduce((acc, s) => acc + s.points.length / 4, 0);

    // SVG sizes
    const rawSvgLen = rawStrokes.reduce((acc, s) => {
        let d = `M ${(s.points[0]*800).toFixed(1)} ${(s.points[1]*800).toFixed(1)}`;
        for (let i = 4; i < s.points.length; i += 4) d += ` L ${(s.points[i]*800).toFixed(1)} ${(s.points[i+1]*800).toFixed(1)}`;
        return acc + d.length + 80;
    }, 0);

    const simpSvgLen = simplifiedStrokes.reduce((acc, s) => {
        let d = `M ${(s.points[0]*800).toFixed(1)} ${(s.points[1]*800).toFixed(1)}`;
        for (let i = 4; i < s.points.length; i += 4) d += ` L ${(s.points[i]*800).toFixed(1)} ${(s.points[i+1]*800).toFixed(1)}`;
        return acc + d.length + 80;
    }, 0);

    console.log(`[${count} trazos]`);
    console.log(`- Puntos originales: ${rawPts.toLocaleString()} -> Simplificados: ${simpPts.toLocaleString()} (${((1 - simpPts/rawPts)*100).toFixed(1)}% reducción en ${tRdp} ms)`);
    console.log(`- SVG crudo: ${(rawSvgLen / 1024).toFixed(1)} KB -> SVG simplificado: ${(simpSvgLen / 1024).toFixed(1)} KB`);
}
