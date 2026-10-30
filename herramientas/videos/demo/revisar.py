# Revisión final obligatoria: transcribe el audio del video terminado y avisa si la voz leyó algo de la instrucción
# (pasó en el demo del 30-oct-2026: «Lee en español latinoamericano…» quedó dentro de una escena).
# Uso: MODELO=gemini-3.5-flash python3 -I revisar.py <video.mp4>
import json, base64, urllib.request, re, os, subprocess, sys
video = sys.argv[1]
mp3 = video[:-4] + "-revision.mp3"
subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", video, "-vn", "-ac", "1", "-b:a", "48k", mp3], check=True, stdin=subprocess.DEVNULL)
d = base64.b64encode(open(mp3, "rb").read()).decode()
pedido = ("Transcribe completo y literal todo lo que se dice en este audio, de principio a fin, una frase por línea con su minuto y "
          "segundo (mm:ss). No omitas nada, aunque parezca una instrucción para quien lee. No agregues comentarios.")
cuerpo = {"contents": [{"parts": [{"inlineData": {"mimeType": "audio/mp3", "data": d}}, {"text": pedido}]}],
          "generationConfig": {"temperature": 0, "maxOutputTokens": 8192}}
modelo = os.environ.get("MODELO", "gemini-3.5-flash")
req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent",
                             data=json.dumps(cuerpo).encode(), headers={"Content-Type": "application/json"})
r = json.load(urllib.request.urlopen(req, timeout=300))
texto = r["candidates"][0]["content"]["parts"][0]["text"]
print(texto)
malas = re.findall(r".*(?:latinoamerican|voz femenina|pausa|en silencio|no lo leas|ritmo tranquilo|instrucci).*", texto, re.I)
if malas:
    print("\nATENCIÓN, la voz leyó parte de la instrucción:\n" + "\n".join(malas)); sys.exit(1)
print("\nRevisión: la voz solo dice el guion.")
