# Chistes Studio

Generador de imágenes de chistes, sin backend ni base de datos.

- **Fuente de verdad:** `data/jokes.json` (versionado en git, se despliega con el sitio).
- **Chrome/Edge:** botón *Vincular archivo* abre `jokes.json` y *Guardar en archivo* (Ctrl+S) lo escribe en disco. Luego haz commit y push.
- **Otros navegadores:** Importar / Exportar copia (mismo formato JSON; también acepta un `.txt`/`.csv` con un chiste por línea).
- Copia local en IndexedDB para no perder cambios entre sesiones.

## Desarrollo

```bash
node serve.mjs   # http://localhost:8080
```

## Despliegue (Cloudflare Pages)

Sin build: directorio de salida `/` (raíz). Excluye `serve.mjs` si lo prefieres.

## Formato de `jokes.json`

`{ version, pages: [{ id, name, bg, fg, accent, watermark, logo, logoPos }], jokes: [{ id, text, pages, score, tags, exported, createdAt }] }`

## Video

Pestaña *Video*: formato 9:16/3:4/1:1, duración 5–30 s (automática según el texto), animación (aparecer por línea, máquina de escribir, todo a la vez), fondo de color, imagen o video, audio (voz en off o música), barra de progreso y línea de tiempo editable. Se exporta grabando el canvas en tiempo real (MediaRecorder): MP4 si el navegador lo soporta (Chrome/Edge recientes), si no WebM. Mantén la pestaña visible mientras graba.

## Móvil

Diseño responsive: barra de pestañas inferior, vista previa primero, controles táctiles de 44 px y filtros plegables. En pantalla táctil el logo solo se arrastra tras pulsar «Mover logo» (así el scroll no se bloquea). La exportación de video graba en tiempo real: mantén la pantalla encendida y la pestaña visible.

## Publicar en GitHub Pages

1. Crea un repositorio en github.com (p. ej. `chistes-studio`) **vacío**, sin README.
2. En esta carpeta:
   ```bash
   git add -A
   git commit -m "Chistes Studio"
   git branch -M main
   git remote add origin https://github.com/<usuario>/chistes-studio.git
   git push -u origin main
   ```
3. En GitHub: *Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save*.
4. Tras ~1 minuto estará en `https://<usuario>.github.io/chistes-studio/`.

Todas las rutas son relativas, así que funciona dentro de la subcarpeta del repositorio.

### Cómo se actualizan los chistes
`data/jokes.json` es la fuente de verdad. Edita en tu PC (pestaña *Archivo → Vincular archivo* en Chrome/Edge, Ctrl+S), luego `git commit` + `git push`; la web se actualiza sola. Los cambios hechos desde otro dispositivo quedan solo en ese navegador (copia local) hasta que los exportes y los subas al repositorio.

> Con el plan gratuito, GitHub Pages exige repositorio **público**: cualquiera podrá ver el sitio y `data/jokes.json`. Para mantenerlo privado, usa Cloudflare Pages (gratis) o GitHub Pro.
