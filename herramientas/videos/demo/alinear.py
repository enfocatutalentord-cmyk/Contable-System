# Corta cada bloque de voz en sus escenas: pide a Gemini (modelo de texto, que escucha el audio) el segundo en que empieza
# cada párrafo y ajusta cada corte al silencio más cercano. Uso: python3 -I alinear.py <carpeta> [escenas por bloque]
import json, sys, base64, urllib.request, subprocess, os, re
dir = sys.argv[1]
por_bloque = int(sys.argv[2]) if len(sys.argv) > 2 else 5
escenas = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "escenas.json")))

def silencios(wav):
    p = subprocess.run(["ffmpeg", "-hide_banner", "-i", wav, "-af", "silencedetect=noise=-40dB:d=0.25", "-f", "null", "-"],
                       capture_output=True, text=True, stdin=subprocess.DEVNULL)
    ini = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", p.stderr)]
    fin = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", p.stderr)]
    return [((a + b) / 2, b - a) for a, b in zip(ini, fin)]

def inicios(wav, textos):
    # Se envía en MP3 (mucho más liviano que el WAV).
    mp3 = wav[:-4] + "-envio.mp3"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-ac", "1", "-b:a", "48k", mp3], check=True, stdin=subprocess.DEVNULL)
    datos = base64.b64encode(open(mp3, "rb").read()).decode()
    lista = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(textos))
    pedido = ("Este audio lee, en orden, estos párrafos:\n" + lista +
              "\n\nResponde solo un JSON con la lista de los segundos (con decimales) en que empieza a leerse cada párrafo, por ejemplo [0.0, 12.4, ...].")
    cuerpo = {"contents": [{"parts": [{"inlineData": {"mimeType": "audio/mp3", "data": datos}}, {"text": pedido}]}],
              "generationConfig": {"responseMimeType": "application/json", "temperature": 0}}
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{os.environ.get('MODELO', 'gemini-flash-latest')}:generateContent",
                                 data=json.dumps(cuerpo).encode(), headers={"Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=300))
    return json.loads(r["candidates"][0]["content"]["parts"][0]["text"])

for b in range(0, len(escenas), por_bloque):
    grupo = escenas[b:b + por_bloque]
    if len(sys.argv) > 3 and grupo[0][0] not in sys.argv[3].split(","): continue
    wav = os.path.join(dir, f"bloque-{grupo[0][0]}.wav")
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav],
                               capture_output=True, text=True, stdin=subprocess.DEVNULL).stdout)
    t = inicios(wav, [e[1] for e in grupo])
    sil = silencios(wav)
    # Cada corte: el silencio más cercano (a menos de 2.5 s) al inicio que dio Gemini; si no hay, el punto de Gemini.
    # Antes del primer párrafo el modelo de voz a veces lee parte de la instrucción: se descarta.
    cortes = [0.0 if t[0] < 1 else min([s for s in sil if abs(s[0] - t[0]) < 2.5] or [(t[0], 0)], key=lambda s: abs(s[0] - t[0]) - s[1])[0]]
    for x in t[1:]:
        cerca = [s for s in sil if abs(s[0] - x) < 2.5]
        cortes.append(min(cerca, key=lambda s: abs(s[0] - x) - s[1])[0] if cerca else x)
    cortes.append(dur)
    print(grupo[0][0], "gemini:", [round(x, 1) for x in t], "cortes:", [round(x, 2) for x in cortes])
    for n, e in enumerate(grupo):
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-ss", f"{cortes[n]:.3f}", "-to", f"{cortes[n + 1]:.3f}",
                        "-af", "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse",
                        "-b:a", "96k", os.path.join(dir, e[0] + ".mp3")], check=True, stdin=subprocess.DEVNULL)
