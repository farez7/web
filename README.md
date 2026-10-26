# Jh Company · Página web

Página web (en inglés) para mostrar las apps de **Jh Company**: QR Generator, Stickers, Wallpapers, Chat, Quiz, Ringtones y Nick Name.

- **Una pantalla por sección**, sin desplazamiento: Home, Apps, About, Portfolio y Contact.
- **Parallax 3D**: al cambiar de pantalla las capas se mueven a distinta velocidad, y siguen al mouse (o al giroscopio del celular).
- **Música de fondo** de YouTube en bucle, con botón flotante para pausar o silenciar.

Está hecha solo con **HTML, CSS y JavaScript**. No hay que instalar nada.

## Cómo moverse entre pantallas

- Menú superior o puntos de la derecha (computadora)
- Barra inferior (celular)
- Rueda del mouse, flechas ↑ ↓ del teclado o deslizando el dedo
- Enlace directo a una pantalla: `index.html#apps`, `#about`, `#portfolio`, `#contact`

## Música

Se configura en `js/config.js` → `music`:

| Ajuste | Qué hace |
| --- | --- |
| `youtubeId` | Código del video (lo que va después de `watch?v=`) |
| `start` / `end` | Inicio y final del fragmento en segundos (80 = 1:20, 135 = 2:15) |
| `volume` | Volumen de 0 a 100 |
| `fade` | Segundos del fundido al volver al inicio |
| `intro` | `true` muestra la pantalla de bienvenida con el botón **Enter** |

Para que el bucle no se escuche cortado, la página usa dos reproductores ocultos que se turnan con un fundido cruzado.

Ten en cuenta:

- Ningún navegador deja que una página suene antes de que el visitante haga clic, toque o presione una tecla. Por eso la página abre con una pantalla de bienvenida: el clic en **Enter** da ese permiso y la música empieza en ese momento. También hay un enlace "Enter without music".
- Si pones `intro: false`, no hay bienvenida y la música empieza con el primer clic, toque o tecla en cualquier parte de la página (mover la rueda del mouse no cuenta).
- En iPhone y iPad no se puede cambiar el volumen desde una página web, así que ahí el bucle salta al inicio sin fundido.
- Prueba la música con la página publicada (GitHub Pages). Abierta con doble clic, YouTube puede negarse a reproducir; en ese caso el botón de música no aparece.
- Si el video tiene anuncios, YouTube puede ponerlos antes de la música.

## Qué editar

| Qué quieres cambiar | Dónde |
| --- | --- |
| Enlace de Google Play, correo y música | `js/config.js` |
| Textos de las apps, sobre mí y contacto | `index.html` |
| Porcentajes de las herramientas | `index.html` → atributo `data-level` de cada una |
| Política de privacidad (solo del sitio web) | `privacy.html` |
| Logo y foto | `assets/img/logo.png`, `assets/img/foto.jpg` |
| Colores | `css/style.css` → `:root` |
| Iconos animados (Lottie) | `js/icons.js` |

## Estructura

```
index.html            Página principal (5 pantallas)
privacy.html          Política de privacidad del sitio web
css/style.css         Estilos
js/config.js          Play Store, correo y música
js/main.js            Pantallas, parallax 3D y animaciones
js/music.js           Música de fondo de YouTube
js/icons.js           Iconos Lottie de cada app
js/vendor/            Librería lottie-web (local, sin CDN)
assets/img/           Logo, foto y favicon
```

## Subirla a tu hosting (aaPanel u otro)

1. Sube **todo** el contenido del ZIP a la carpeta raíz del sitio y acepta reemplazar los archivos (`index.html`, `privacy.html` y las carpetas `css`, `js`, `assets`).
2. Abre tu web y presiona **Ctrl + F5** (en celular, recarga la página).

Tu servidor le dice al navegador que guarde los archivos `.css` y `.js` durante 12 horas. Por eso cada enlace lleva un número de versión, por ejemplo `css/style.css?v=20261026b`. **Si cambias un archivo CSS o JS, cambia ese número** en `index.html` y `privacy.html`, así los visitantes reciben la versión nueva al momento.

## Publicarla gratis

- **GitHub Pages:** en el repositorio ve a *Settings → Pages*, elige la rama y la carpeta `/ (root)` y guarda. Tu web queda en `https://<usuario>.github.io/<repositorio>/`.
- **Netlify Drop:** arrastra la carpeta del proyecto a <https://app.netlify.com/drop>.
