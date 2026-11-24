import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const css = fs.readFileSync(path.join(root, 'src/styles/hud.css'), 'utf8');

// Strip the CSS import from main.ts during IIFE bundling (we inline CSS directly in <style>)
const ignoreCssPlugin = {
  name: 'ignore-css',
  setup(b) {
    b.onResolve({ filter: /\.css$/ }, () => ({ path: 'ignored-css', namespace: 'ignore-css' }));
    b.onLoad({ filter: /.*/, namespace: 'ignore-css' }, () => ({ contents: '', loader: 'js' }));
  },
};

const result = await build({
  entryPoints: [path.join(root, 'src/main.ts')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  plugins: [ignoreCssPlugin],
});

const js = result.outputFiles[0].text;
// Escape </script> defensively so inline script never breaks HTML parsing
const safeJs = js.replace(/<\/script>/gi, '<\\/script>');

const html = `<!DOCTYPE html>
<html lang="tr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <title>DJI Mini 5 Pro — Gerçekçi Uçuş Simülatörü</title>
    <style>${css}</style>
  </head>
  <body>
    <div id="app">
      <canvas id="sim-canvas"></canvas>
      <div id="hud-root"></div>
    </div>
    <script>${safeJs}</script>
  </body>
</html>
`;

const outFile = path.join(root, 'DJI-Mini-5-Pro-Sim.html');
fs.writeFileSync(outFile, html, 'utf8');
console.log(`Standalone HTML generated: ${outFile} (${(html.length / 1024).toFixed(1)} KB)`);
