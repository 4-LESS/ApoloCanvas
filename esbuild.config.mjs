import esbuild from 'esbuild';
import process from 'node:process';
import { builtinModules } from 'node:module';

const production = process.argv[2] === 'production';
const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtinModules],
  format: 'cjs',
  target: 'es2022',
  sourcemap: !production,
  minify: production,
  treeShaking: true,
  outfile: 'main.js',
  logLevel: 'info',
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
