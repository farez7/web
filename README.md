# Jh Company · Página web

Página web (en inglés) con parallax 3D animado para mostrar las apps de **Jh Company**: QR Generator, Stickers, Wallpapers, Chat, Quiz, Ringtones y Nick Name.

Está hecha solo con **HTML, CSS y JavaScript**. No hay que instalar nada.

## Cómo abrirla

Haz doble clic en `index.html` y se abre en tu navegador. La página funciona sin conexión; solo las fuentes de Google necesitan Internet.

## Qué editar

| Qué quieres cambiar | Dónde |
| --- | --- |
| Enlace de Google Play y tu correo | `js/config.js` |
| Textos de las apps, sobre mí y contacto | `index.html` |
| Porcentajes de las herramientas | `index.html` → atributo `data-level` de cada una |
| Política de privacidad (solo del sitio web) | `privacy.html` |
| Logo y foto | `assets/img/logo.png`, `assets/img/foto.jpg` |
| Colores | `css/style.css` → `:root` |
| Iconos animados (Lottie) | `js/icons.js` |

## Estructura

```
index.html            Página principal
privacy.html          Política de privacidad del sitio web
css/style.css         Estilos
js/config.js          Enlace de Play Store y correo
js/icons.js           Iconos Lottie de cada app
js/main.js            Parallax 3D, órbita, animaciones
js/vendor/            Librería lottie-web (local, sin CDN)
assets/img/           Logo, foto y favicon
assets/stickers/      Stickers animados: Lottie (.json) y Telegram (.tgs), 512×512, 30 fps, 3 s
```

## Publicarla gratis

- **GitHub Pages:** en el repositorio ve a *Settings → Pages*, elige la rama y la carpeta `/ (root)` y guarda. Tu web queda en `https://<usuario>.github.io/<repositorio>/`.
- **Netlify Drop:** arrastra la carpeta del proyecto a <https://app.netlify.com/drop>.
