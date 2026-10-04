# Flork Animator · SVG → Lottie automático

Convierte cualquier personaje en SVG en una animación **Lottie JSON de 3 segundos exactos (90 fotogramas a 30 fps) en bucle perfecto**, sin definir animaciones a mano.

```bash
cd tools/flork-animator && npm install && npx playwright install chromium   # solo la primera vez
node tools/flork-animator/animate.js personaje.svg salida.json --preview vista --video
```

Genera `salida.json` (el Lottie), `salida.report.json` (qué se animó, qué se corrigió, qué se verificó) y, con `--preview`, una tira de fotogramas y un video.

## Qué decide automáticamente

| Detecta | Cómo lo reconoce | Animación |
| --- | --- | --- |
| Cuerpo | El grupo de elementos conectados más grande | Respiración suave (+1,4 % de alto), anclada abajo para no despegarse del borde |
| Ojos | Par de formas oscuras y redondeadas, del mismo tamaño y a la misma altura, en la parte de arriba (o con `id`/`class` *eye*/*ojo*). Incluye el brillo y el blanco del ojo | Parpadeo de 0,3 s |
| Boca | Forma rellena centrada bajo los ojos, más ancha que alta y con cierta altura (o *mouth*/*boca*) | Se abre y cierra levemente, anclada arriba |
| Mejillas | Manchas rosadas sin contorno junto a los ojos (y sus rayitas) | Sonrojo que pulsa (opacidad 100 → 70 %) |
| Corazones | Forma roja/rosada con contorno propio, con **una** muesca y una punta aguda enfrente (análisis geométrico del trazado; funciona girado) | Late: dos latidos dobles por ciclo |
| Otros acentos rojos/rosados | Flores, medallones, caramelos… con contorno propio | Pulso suave |
| Partes salientes: cola, brazos, manos, tridentes, vendas… | Grupos que sobresalen del contorno del cuerpo; se les suman los elementos dibujados encima (texto de un cartel, corazones…) | Balanceo desde el punto exacto donde se unen al cuerpo |
| Elementos sueltos: corazones, murciélagos, caramelos, estrellas | Grupos que no tocan al personaje | Flotan ±1,2 % y giran ±3°, alternando la fase |
| Textos | `<text>` | Quietos (acompañan la respiración si tocan el cuerpo) |

Todos los movimientos son ondas seno con curvas de aceleración suaves: el primer y el último fotograma son idénticos y la velocidad es continua en el punto de unión del bucle.

## Detección y corrección de problemas

Antes de entregar el JSON, la herramienta verifica y corrige sola:

1. **Fidelidad:** renderiza el SVG original y el Lottie, y los compara píxel a píxel al doble de resolución. Un elemento que no coincide (degradado elíptico, filtro, máscara, texto…) se incrusta como imagen PNG ×3 en vez de dibujarse mal.
2. **Uniones:** calcula cuánto se separaría cada parte de su unión al girar (o cada acento al latir). La amplitud se limita para que no se separe más de 0,3 % del tamaño. Si ni con 1° (o 2 % de escala) es seguro, se deja fijo.
3. **Lienzo:** renderiza 18 fotogramas sin recorte. Si algo se sale, amplía el lienzo justo lo necesario (por abajo nunca, si el cuerpo está cortado ahí a propósito).
4. **Bucle:** cada propiedad animada empieza y termina igual, y el último instante se compara contra el primero.
5. **Fotograma 0 = diseño original:** se compara contra el SVG.
6. **Reproducción:** carga y renderiza con lottie-web sin errores.

Si alguna comprobación falla, el comando termina con código 2 y el informe dice cuál.

## Compatibilidad

Soporta `path` (incluidos arcos), `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `use`, transformaciones anidadas, clases CSS, opacidades, degradados lineales y radiales, trazos discontinuos, `clip-path` (como máscaras Lottie) y `viewBox` con cualquier origen. Las animaciones CSS que ya tenga el SVG se ignoran.
