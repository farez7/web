# Jh Company · Página web

Página web con parallax 3D animado para mostrar las apps de **Jh Company**: QR Generator, Stickers, Wallpapers, Chat, Quiz, Ringtones y Nick Name.

Está hecha solo con **HTML, CSS y JavaScript**. No hay que instalar nada.

## Cómo abrirla

Haz doble clic en `index.html` y se abre en tu navegador. La página funciona sin conexión; solo las fuentes de Google necesitan Internet.

## Qué editar

| Qué quieres cambiar | Dónde |
| --- | --- |
| Enlace de Google Play y tu correo | `js/config.js` |
| Textos de las apps, sobre mí y contacto | `index.html` |
| Porcentaje de Android Studio | `index.html` → `data-level="60"` |
| Barra de nivel en otra herramienta | añade `data-level="80"` al `<article class="tool">` |
| Política de privacidad | `privacidad.html` |
| Logo y foto | `assets/img/logo.png`, `assets/img/foto.jpg` |
| Colores | `css/style.css` → `:root` |
| Iconos animados (Lottie) | `js/icons.js` |

> Revisa `privacidad.html` y deja solo los servicios que usan tus apps (por ejemplo, borra AdMob o Firebase si no los usas).

## Estructura

```
index.html            Página principal
privacidad.html       Política de privacidad
css/style.css         Estilos
js/config.js          Enlace de Play Store y correo
js/icons.js           Iconos Lottie de cada app
js/main.js            Parallax 3D, órbita, animaciones
js/vendor/            Librería lottie-web (local, sin CDN)
assets/img/           Logo, foto y favicon
```

## Publicarla gratis

- **GitHub Pages:** en el repositorio ve a *Settings → Pages*, elige la rama y la carpeta `/ (root)` y guarda. Tu web queda en `https://<usuario>.github.io/<repositorio>/`.
- **Netlify Drop:** arrastra la carpeta del proyecto a <https://app.netlify.com/drop>.

La URL de `privacidad.html` sirve como enlace de política de privacidad en Google Play Console.
