/**
 * sandbox/server.mjs
 * 
 * Servidor HTTP local ligero y sin dependencias para probar el sandbox con soporte completo
 * de ES Modules, auto-descubrimiento de plumas en `sandbox/pens/*.js` y recarga en vivo (SSE)
 * al añadir, editar o eliminar archivos .js sin necesidad de recargar el navegador ni editar index.html.
 * 
 * Uso:
 *   node sandbox/server.mjs
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PENS_DIR = path.join(__dirname, 'pens');

const PORT = 3000;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
};

// Orden preferido para las plumas base e iteraciones numeradas del lápiz; cualquier nuevo .js aparece automáticamente después
const PREFERRED_ORDER = [
    'ball',
    'fountain',
    'fountain-v2',
    'calli',
    'calli-v2',
    'pencil-simple',
    'pencil-multistrand',
    'pencil-ribbon-jitter',
    'pencil-paper-grain',
    'pencil-svg-turbulence',
    'pencil',
    'pencilv2',
    'pencil-atlas',
    'pencil-atlasv2',
    'pencil-atlasv4',
    'pencil-atlasClaude',
    'pencil-sketch',
];

function listPenFiles() {
    try {
        const entries = fs.readdirSync(PENS_DIR, { withFileTypes: true });
        const files = [];
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
            const id = entry.name.slice(0, -3);
            const fullPath = path.join(PENS_DIR, entry.name);
            let mtime = 0;
            try {
                mtime = Math.floor(fs.statSync(fullPath).mtimeMs);
            } catch {
                mtime = Date.now();
            }
            files.push({ id, file: entry.name, mtime });
        }

        files.sort((a, b) => {
            const idxA = PREFERRED_ORDER.indexOf(a.id);
            const idxB = PREFERRED_ORDER.indexOf(b.id);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.id.localeCompare(b.id);
        });

        return files;
    } catch (err) {
        console.error('[Sandbox] Error leyendo carpeta pens/:', err);
        return [];
    }
}

// Clientes SSE suscritos a cambios en sandbox/pens/
const sseClients = new Set();

function broadcastPensUpdate() {
    const payload = JSON.stringify({ files: listPenFiles() });
    for (const res of sseClients) {
        try {
            res.write(`data: ${payload}\n\n`);
        } catch {
            sseClients.delete(res);
        }
    }
}

// Observar cambios en la carpeta sandbox/pens/ para actualizar sin recargar
let watchDebounce = null;
if (fs.existsSync(PENS_DIR)) {
    try {
        fs.watch(PENS_DIR, () => {
            if (watchDebounce) clearTimeout(watchDebounce);
            watchDebounce = setTimeout(() => {
                broadcastPensUpdate();
            }, 80);
        });
    } catch (err) {
        console.warn('[Sandbox] fs.watch no disponible:', err);
    }
}

const server = http.createServer((req, res) => {
    // Manejo de CORS para desarrollo local
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    let reqPath = req.url.split('?')[0];

    // Endpoint API: lista JSON de archivos .js en sandbox/pens/
    if (reqPath === '/api/pens') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ files: listPenFiles() }));
        return;
    }

    // Endpoint SSE: notificaciones en tiempo real al añadir/editar/borrar .js en sandbox/pens/
    if (reqPath === '/api/pens/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
        });
        res.write(`data: ${JSON.stringify({ files: listPenFiles() })}\n\n`);
        sseClients.add(res);
        req.on('close', () => {
            sseClients.delete(res);
        });
        return;
    }

    // Soporte de listado de directorio /pens/ para compatibilidad con servidores estáticos
    if (reqPath === '/pens' || reqPath === '/pens/') {
        const files = listPenFiles();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(files.map(f => `<a href="${f.file}" data-mtime="${f.mtime}">${f.file}</a>`).join('\n'));
        return;
    }

    if (reqPath === '/' || reqPath === '') {
        reqPath = '/index.html';
    }

    const filePath = path.join(__dirname, reqPath);

    // Evitar salir del directorio sandbox
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Acceso denegado');
        return;
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`404 No encontrado: ${reqPath}`);
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
    });
});

server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`ApoloCanvas Sandbox Servidor Local Activo`);
    console.log(`Abre en tu navegador: http://localhost:${PORT}/index.html`);
    console.log(`Auto-descubrimiento activo en: sandbox/pens/*.js`);
    console.log(`======================================================\n`);
});
