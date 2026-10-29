# Genera la voz de una frase con la API de Gemini (texto a voz) y la guarda en MP3.
# Uso: python3 -I voz.py <modelo> <voz> "<texto>" <salida-sin-extension>   (p. ej. gemini-3.8-flash-tts Kore)
# La llave la pone el entorno (secreto del dominio generativelanguage.googleapis.com); nunca en el código.
import json, sys, base64, urllib.request, subprocess, os
modelo, voz, texto, salida = sys.argv[1:5]
cuerpo = {
  "contents": [{"parts": [{"text": "Lee en español latinoamericano neutro, con voz femenina suave, cálida y en tono ligero y amable, a ritmo tranquilo: " + texto}]}],
  "generationConfig": {"responseModalities": ["AUDIO"],
    "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voz}}}},
}
req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent",
  data=json.dumps(cuerpo).encode(), headers={"Content-Type": "application/json"})
r = json.load(urllib.request.urlopen(req, timeout=120))
parte = r["candidates"][0]["content"]["parts"][0]["inlineData"]
pcm = base64.b64decode(parte["data"])
if pcm[:4] == b"RIFF":  # ya viene como WAV
    open(salida + ".wav", "wb").write(pcm)
    entrada = ["-i", salida + ".wav"]
else:  # PCM de 16 bits
    rate = 24000
    for x in parte.get("mimeType", "").split(";"):
        if "rate=" in x: rate = int(x.split("=")[1])
    open(salida + ".wav", "wb").write(pcm)
    entrada = ["-f", "s16le", "-ar", str(rate), "-ac", "1", "-i", salida + ".wav"]
subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *entrada, "-b:a", "96k", salida + ".mp3"], check=True)
os.remove(salida + ".wav")
print(parte.get("mimeType"), len(pcm))
