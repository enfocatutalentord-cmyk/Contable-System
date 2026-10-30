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

## Video demo de la plataforma (30-oct-2026, pedido de Joannie)

Recorrido de 2:44 con la voz Aoede: propósito, pantallas reales y «lo que viene» (e-CF, conciliación bancaria, estados
financieros con IR-2, asistente con IA). Todo en `demo/`:

1. `escenas.json`: texto que se lee (voz) y subtítulo de cada escena.
2. Voz: el plan gratis de Gemini permite **10 solicitudes al día por modelo de voz**. Por eso `voces_bloques.py` pide la voz
   en 3 bloques de 5 escenas (`python3 -I voces_bloques.py gemini-3.8-flash-lite-tts Aoede <carpeta>/voz`) y `alinear.py`
   corta cada bloque: un modelo de texto (`MODELO=gemini-3.5-flash`) dice en qué segundo empieza cada escena y el corte se
   ajusta al silencio más cercano (a veces la voz lee parte de la instrucción al principio: se descarta). Revisar las
   duraciones; `voces.sh` hace una solicitud por escena si hay cupo.
3. `preparar.cjs`: crea la firma «Empire Tax’N Legal» con dos clientes ficticios desde la app y carga sus movimientos con
   `datos.mjs` (lógica real; nada de datos reales). Deja `demo.json`.
4. `grabar.cjs`: graba escena por escena; cada una dura lo que su voz. Deja `demo.webm` y `tiempos.json`.
5. `mezclar.py`: pone cada voz en su segundo y saca `demo.mp4` (H.264 + AAC).
6. **Siempre** `revisar.py demo.mp4` antes de entregar: transcribe el video completo y falla si la voz leyó la instrucción.
   En la primera entrega (30-oct) la escena 11 traía 15 s de «Lee en español latinoamericano… pausa larga…»; Joannie lo
   notó. Revisar escena por escena no basta: el modelo transcribe lo que espera oír; hay que pedir la transcripción
   completa con marcas de tiempo.
