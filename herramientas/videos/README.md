# Videos tutoriales del sistema contable

Pedido de Joannie (28-oct-2026): un video corto por función, con el sistema real, cursor animado, resaltado dorado y
subtítulos; con **voz femenina en español latinoamericano, suave y ligera**. Se suben a Drive › «Empire Tax’N Legal ·
Sistema contable y web» › «Videos tutoriales» (una subcarpeta por tema; los sube Joannie, pesan mucho para la API).

- `guion.cjs`: utilidades (abrir, entrar, señalar, clic, escribir, elegir, subtítulo, tarjeta, cerrar). Graba con Playwright
  a 1280×720; luego `ffmpeg -i x.webm -c:v libx264 -crf 26 -pix_fmt yuv420p -movflags +faststart x.mp4`.
- `08-crear-factura.cjs`: video de prueba aprobado en estilo (57 s). Uso, con la app en el puerto 3100 y datos de los
  recorridos (`pruebas/navegador/ventas.cjs` crea el usuario `ventas-…@firma.do`, clave `clave-segura-123`; cambiar el correo
  en el guion): `PLAYWRIGHT=/opt/node-tools/node_modules/playwright node herramientas/videos/08-crear-factura.cjs <carpeta>`.
- Numeración: la del manual en PDF. Rehacer los videos y el manual después de la nueva navegación (partes 2 y 3).
- **Voz:** funciona desde el 29-oct-2026 (secreto en el entorno). `voz.py` genera cada frase; muestras con las voces
  Kore, Aoede y Leda (modelo `gemini-3.8-flash-tts`). El plan gratis responde 429 si se piden muchas seguidas: esperar o
  activar la facturación en AI Studio. Antes: Plan: generar el audio de cada subtítulo con la API de Gemini (texto a voz, voz femenina, español
  latinoamericano, tono suave) y mezclarlo con ffmpeg, alargando cada paso a lo que dure su frase. Requiere en el entorno de
  la sesión el dominio `generativelanguage.googleapis.com` permitido y la variable `GEMINI_API_KEY` (la pone Joannie; nunca
  por el chat).
