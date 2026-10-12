import zlib from 'node:zlib';

// Synthetic handwriting stroke generator
function generateStrokes(count, boxWidth = 800, boxHeight = 1200) {
    const strokes = [];
    const colors = ['#111827', '#1F4FD8', '#EF4444', '#10B981', '#F5C400'];
    let curX = 0.1;
    let curY = 0.05;

    for (let s = 0; s < count; s++) {
        // Average length: 30 to 70 points (mean 50)
        const numPoints = Math.floor(25 + Math.random() * 45);
        const points = [];
        
        let px = curX;
        let py = curY;
        let p = 0.4 + Math.random() * 0.3;

        for (let pt = 0; pt < numPoints; pt++) {
            // Natural pen movement: smooth walk
            px += (Math.random() - 0.48) * 0.008;
            py += (Math.random() - 0.48) * 0.008;
            p = Math.max(0.1, Math.min(1.0, p + (Math.random() - 0.5) * 0.05));
            const t = pt * 8; // ms
            points.push(px, py, p, t);
        }

        strokes.push({
            id: `s-${s}`,
            type: 'stroke',
            color: colors[s % colors.length],
            width: s % 5 === 0 ? 3.2 : 2.0,
            opacity: 1.0,
            points
        });

        // Advance simulated writing line
        curX += 0.02;
        if (curX > 0.9) {
            curX = 0.1;
            curY += 0.035;
            if (curY > 1.4) curY = 0.05;
        }
    }
    return strokes;
}

// 1. Plain SVG representation
function toSvg(strokes, width = 800, height = 1200) {
    const paths = strokes.map(s => {
        const pts = s.points;
        if (pts.length < 4) return '';
        let d = `M ${(pts[0] * width).toFixed(1)} ${(pts[1] * width).toFixed(1)}`;
        for (let i = 4; i < pts.length; i += 4) {
            d += ` L ${(pts[i] * width).toFixed(1)} ${(pts[i + 1] * width).toFixed(1)}`;
        }
        return `<path d="${d}" stroke="${s.color}" stroke-width="${s.width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    }).join('\n');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" style="width:100%;height:${height}px;">\n${paths}\n</svg>`;
}

// 2. Binary serialization: Quantization + Delta encoding + Deflate + Base64
function toBinaryCompressed(strokes) {
    // Binary layout:
    // Header: [version: 1 byte, strokeCount: 2 bytes]
    // Per stroke:
    // [colorIdx: 1 byte, width_x10: 1 byte, pointCount: 2 bytes]
    // Point 0: [u0: uint16, v0: uint16, p0: uint8]
    // Points 1..N: delta [du: int16, dv: int16, dp: int8]
    
    // Allocate buffer
    let totalPoints = 0;
    for (const s of strokes) totalPoints += (s.points.length / 4);

    const bufSize = 3 + strokes.length * 4 + strokes.length * 5 + (totalPoints - strokes.length) * 5;
    const buf = Buffer.alloc(bufSize);
    let offset = 0;

    buf.writeUInt8(1, offset++); // version 1
    buf.writeUInt16LE(strokes.length, offset); offset += 2;

    const palette = ['#111827', '#1F4FD8', '#EF4444', '#10B981', '#F5C400'];

    for (const s of strokes) {
        const colorIdx = Math.max(0, palette.indexOf(s.color));
        buf.writeUInt8(colorIdx, offset++);
        buf.writeUInt8(Math.round(s.width * 10), offset++);
        
        const ptCount = s.points.length / 4;
        buf.writeUInt16LE(ptCount, offset); offset += 2;

        // Scale: u in [0, 1] mapped to 0..65535; v in [0, 4] mapped to 0..65535 (16384 units per column width)
        let prevU = Math.max(0, Math.min(65535, Math.round(s.points[0] * 65535)));
        let prevV = Math.max(0, Math.min(65535, Math.round(s.points[1] * 16383)));
        let prevP = Math.max(0, Math.min(255, Math.round(s.points[2] * 255)));

        buf.writeUInt16LE(prevU, offset); offset += 2;
        buf.writeUInt16LE(prevV, offset); offset += 2;
        buf.writeUInt8(prevP, offset++);

        for (let i = 4; i < s.points.length; i += 4) {
            const curU = Math.max(0, Math.min(65535, Math.round(s.points[i] * 65535)));
            const curV = Math.max(0, Math.min(65535, Math.round(s.points[i + 1] * 16383)));
            const curP = Math.max(0, Math.min(255, Math.round(s.points[i + 2] * 255)));

            const du = Math.max(-32768, Math.min(32767, curU - prevU));
            const dv = Math.max(-32768, Math.min(32767, curV - prevV));
            const dp = Math.max(-128, Math.min(127, curP - prevP));

            buf.writeInt16LE(du, offset); offset += 2;
            buf.writeInt16LE(dv, offset); offset += 2;
            buf.writeInt8(dp, offset++);

            prevU = curU;
            prevV = curV;
            prevP = curP;
        }
    }

    const uncompressed = buf.subarray(0, offset);
    const compressed = zlib.deflateRawSync(uncompressed, { level: 9 });
    const b64 = compressed.toString('base64');
    
    // Wrap to 76 chars
    const wrapped = b64.match(/.{1,76}/g)?.join('\n') || b64;
    return {
        rawByteCount: offset,
        compressedByteCount: compressed.length,
        base64ByteCount: wrapped.length,
        wrapped
    };
}

function fromBinaryCompressed(wrappedB64) {
    const rawB64 = wrappedB64.replace(/\s+/g, '');
    const compressedBuf = Buffer.from(rawB64, 'base64');
    const decompressed = zlib.inflateRawSync(compressedBuf);

    let offset = 0;
    const version = decompressed.readUInt8(offset++);
    const strokeCount = decompressed.readUInt16LE(offset); offset += 2;
    const strokes = [];

    const palette = ['#111827', '#1F4FD8', '#EF4444', '#10B981', '#F5C400'];

    for (let s = 0; s < strokeCount; s++) {
        const colorIdx = decompressed.readUInt8(offset++);
        const width = decompressed.readUInt8(offset++) / 10;
        const ptCount = decompressed.readUInt16LE(offset); offset += 2;

        const points = [];
        let curU = decompressed.readUInt16LE(offset); offset += 2;
        let curV = decompressed.readUInt16LE(offset); offset += 2;
        let curP = decompressed.readUInt8(offset++);

        points.push(curU / 65535, curV / 16383, curP / 255, 0);

        for (let i = 1; i < ptCount; i++) {
            const du = decompressed.readInt16LE(offset); offset += 2;
            const dv = decompressed.readInt16LE(offset); offset += 2;
            const dp = decompressed.readInt8(offset++);

            curU += du;
            curV += dv;
            curP += dp;

            points.push(curU / 65535, curV / 16383, curP / 255, i * 8);
        }

        strokes.push({
            id: `s-${s}`,
            type: 'stroke',
            color: palette[colorIdx] || '#111827',
            width,
            points
        });
    }

    return strokes;
}

const counts = [1000, 5000, 8000];

console.log('=== BENCHMARK DE TAMAÑO Y COMPRESIÓN ===\n');

for (const count of counts) {
    console.log(`--- Prueba con ${count} trazos ---`);
    const strokes = generateStrokes(count);
    const totalPts = strokes.reduce((acc, s) => acc + s.points.length / 4, 0);
    console.log(`Puntos totales generados: ${totalPts.toLocaleString()}`);

    // JSON plano
    const jsonStr = JSON.stringify(strokes);
    const jsonKb = (Buffer.byteLength(jsonStr, 'utf8') / 1024).toFixed(1);

    // SVG en línea plano
    const t0Svg = performance.now();
    const svgStr = toSvg(strokes);
    const tSvgGen = (performance.now() - t0Svg).toFixed(2);
    const svgKb = (Buffer.byteLength(svgStr, 'utf8') / 1024).toFixed(1);

    // Binario comprimido
    const t0Comp = performance.now();
    const bin = toBinaryCompressed(strokes);
    const tComp = (performance.now() - t0Comp).toFixed(2);

    // Descompresión
    const t0Decomp = performance.now();
    const recovered = fromBinaryCompressed(bin.wrapped);
    const tDecomp = (performance.now() - t0Decomp).toFixed(2);

    assertPointsClose(strokes[0].points, recovered[0].points);

    console.log(`1. JSON plano:               ${jsonKb} KB`);
    console.log(`2. SVG en línea:             ${svgKb} KB (Generado en ${tSvgGen} ms)`);
    console.log(`3. Binario crudo cuantizado: ${(bin.rawByteCount / 1024).toFixed(1)} KB`);
    console.log(`4. Binario comprimido Deflate: ${(bin.compressedByteCount / 1024).toFixed(1)} KB`);
    console.log(`5. Bloque Base64 (en el .md): ${(bin.base64ByteCount / 1024).toFixed(1)} KB (Compresión: ${tComp} ms, Descompresión: ${tDecomp} ms)`);
    console.log(`6. Total Caja (.md con SVG + Base64): ${(Number(svgKb) + Number((bin.base64ByteCount / 1024).toFixed(1))).toFixed(1)} KB\n`);
}

function assertPointsClose(p1, p2) {
    if (p1.length !== p2.length) throw new Error('Length mismatch');
    for (let i = 0; i < p1.length; i += 4) {
        if (Math.abs(p1[i] - p2[i]) > 0.001 || Math.abs(p1[i + 1] - p2[i + 1]) > 0.001) {
            throw new Error(`Quantization error too high at ${i}: ${p1[i]} vs ${p2[i]}`);
        }
    }
}
