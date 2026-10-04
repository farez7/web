#!/usr/bin/env node
/* Uso:
 *   node tools/flork-animator/animate.js personaje.svg [salida.json] [--preview carpeta] [--video]
 *
 * Analiza el SVG, decide qué animar, verifica el resultado y escribe un
 * Lottie JSON de 3 s en bucle, más un informe (.report.json).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const LOTTIE = path.join(__dirname, '..', '..', 'js', 'vendor', 'lottie_light.min.js');
const ANIMATOR = path.join(__dirname, 'animator.js');

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter(a => a.startsWith('--')));
  const pos = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] === '--preview'));
  const input = pos[0];
  if (!input) {
    console.error('Uso: node animate.js personaje.svg [salida.json] [--preview carpeta] [--video]');
    process.exit(1);
  }
  const output = pos[1] || input.replace(/\.svg$/i, '') + '.json';
  const previewDir = flags.has('--preview') ? args[args.indexOf('--preview') + 1] : null;
  const name = path.basename(input, path.extname(input));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setContent('<!doctype html><body style="margin:0"></body>');
  await page.addScriptTag({ path: LOTTIE });
  await page.addScriptTag({ path: ANIMATOR });
  const svgText = fs.readFileSync(input, 'utf8');
  const { json, report } = await page.evaluate(([s, n]) => window.FlorkAnimator.analyze(s, { name: n }), [svgText, name]);
  if (errors.length) report.checks.push({ name: 'Sin errores del reproductor', ok: false, detail: errors.join('; ') });
  else report.checks.push({ name: 'Sin errores del reproductor', ok: true, detail: 'lottie-web cargó y renderizó todos los fotogramas' });

  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(json));
  fs.writeFileSync(output.replace(/\.json$/i, '') + '.report.json', JSON.stringify(report, null, 2));

  console.log(`\n${name} → ${output} (${(fs.statSync(output).size / 1024).toFixed(1)} KB)`);
  for (const t of report.tracks) console.log(`  • ${t.tipo}: ${t.animación}`);
  for (const c of report.corrections) console.log(`  ↻ ${c}`);
  for (const w of report.warnings) console.log(`  · ${w}`);
  for (const c of report.checks) console.log(`  ${c.ok ? '✔' : '✘'} ${c.name} — ${c.detail}`);

  if (previewDir) {
    fs.mkdirSync(previewDir, { recursive: true });
    const lib = fs.readFileSync(LOTTIE, 'utf8');
    const frames = [0, 6, 22, 45, 57, 75];
    const cell = 220, ch = Math.round(cell * json.h / json.w);
    const p = await browser.newPage({ viewport: { width: (frames.length + 1) * (cell + 6), height: ch + 30 } });
    const svgUri = 'data:image/svg+xml;base64,' + Buffer.from(svgText).toString('base64');
    await p.setContent(`<body style="margin:0;display:flex;gap:6px;background:#ddd;font:12px sans-serif">
      <div><div style="width:${cell}px;height:${ch}px;background:#fff;display:flex;align-items:center;justify-content:center"><img src="${svgUri}" style="max-width:100%;max-height:100%"></div>original</div>
      ${frames.map(f => `<div><div id="f${f}" style="width:${cell}px;height:${ch}px;background:#fff"></div>fotograma ${f}</div>`).join('')}
      <script>${lib}</script><script>const d=${JSON.stringify(json)};${JSON.stringify(frames)}.forEach(f=>lottie.loadAnimation({container:document.getElementById('f'+f),renderer:'svg',loop:false,autoplay:false,animationData:JSON.parse(JSON.stringify(d))}).goToAndStop(f,true));</script></body>`);
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(previewDir, name + '-frames.png') });
    await p.close();
    if (flags.has('--video')) {
      const size = { width: 480, height: Math.round(480 * json.h / json.w) };
      const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: previewDir, size } });
      const vp = await ctx.newPage();
      await vp.setContent(`<body style="margin:0;background:#fff"><div id=a style="width:${size.width}px;height:${size.height}px"></div><script>${lib}</script><script>lottie.loadAnimation({container:a,renderer:'svg',loop:true,autoplay:true,animationData:${JSON.stringify(json)}})</script></body>`);
      await vp.waitForTimeout(6200);
      const v = vp.video();
      await ctx.close();
      fs.renameSync(await v.path(), path.join(previewDir, name + '.webm'));
    }
  }
  await browser.close();
  if (report.checks.some(c => !c.ok)) process.exitCode = 2;
}

main().catch(e => { console.error(e); process.exit(1); });
