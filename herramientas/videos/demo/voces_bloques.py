# Genera la voz de las escenas en bloques (pocas solicitudes, para no gastar el límite diario de la API) y corta cada
# bloque en las pausas largas entre escenas. Uso: python3 -I voces_bloques.py <modelo> <voz> <carpeta> [escenas por bloque]
import json, sys, base64, urllib.request, subprocess, os, re
modelo, voz, dir = sys.argv[1:4]
por_bloque = int(sys.argv[4]) if len(sys.argv) > 4 else 5
escenas = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "escenas.json")))
os.makedirs(dir, exist_ok=True)

def voz_de(textos, salida):
    guion = "\n\n[pausa larga de tres segundos]\n\n".join(textos)
    instruccion = ("Lee en español latinoamericano neutro, con voz femenina suave, cálida y en tono ligero y amable, a ritmo tranquilo. "
                   "Donde dice [pausa larga de tres segundos], quédate en silencio tres segundos y no lo leas en voz alta:\n\n")
    cuerpo = {"contents": [{"parts": [{"text": instruccion + guion}]}],
              "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voz}}}}}
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent",
                                 data=json.dumps(cuerpo).encode(), headers={"Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=300))
    parte = r["candidates"][0]["content"]["parts"][0]["inlineData"]
    datos = base64.b64decode(parte["data"])
    rate = 24000
    for x in parte.get("mimeType", "").split(";"):
        if "rate=" in x: rate = int(x.split("=")[1])
    crudo = salida + ".raw"
    open(crudo, "wb").write(datos)
    entrada = ["-i", crudo] if datos[:4] == b"RIFF" else ["-f", "s16le", "-ar", str(rate), "-ac", "1", "-i", crudo]
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *entrada, salida + ".wav"], check=True, stdin=subprocess.DEVNULL)
    os.remove(crudo)

def cortar(wav, ids):
    # Silencios de más de 1.4 s: son las pausas entre escenas.
    p = subprocess.run(["ffmpeg", "-hide_banner", "-i", wav, "-af", "silencedetect=noise=-40dB:d=1.4", "-f", "null", "-"],
                       capture_output=True, text=True, stdin=subprocess.DEVNULL)
    inicios = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", p.stderr)]
    fines = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", p.stderr)]
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav],
                               capture_output=True, text=True, stdin=subprocess.DEVNULL).stdout)
    # Solo los silencios internos (no el del principio ni el del final).
    pausas = [(i, f) for i, f in zip(inicios, fines) if i > 0.5 and f < dur - 0.3]
    if len(pausas) != len(ids) - 1:
        print(f"bloque {ids}: se esperaban {len(ids) - 1} pausas y hay {len(pausas)}", file=sys.stderr)
        return False
    cortes = [0.0] + [((i + f) / 2) for i, f in pausas] + [dur]
    for n, id in enumerate(ids):
        a, b = cortes[n], cortes[n + 1]
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-ss", f"{a:.3f}", "-to", f"{b:.3f}",
                        "-af", "silenceremove=start_periods=1:start_threshold=-40dB:stop_periods=-1:stop_duration=0.4:stop_threshold=-40dB",
                        "-b:a", "96k", os.path.join(dir, id + ".mp3")], check=True, stdin=subprocess.DEVNULL)
    return True

for b in range(0, len(escenas), por_bloque):
    grupo = escenas[b:b + por_bloque]
    ids = [e[0] for e in grupo]
    if all(os.path.exists(os.path.join(dir, i + ".mp3")) for i in ids): continue
    wav = os.path.join(dir, f"bloque-{ids[0]}.wav")
    if not os.path.exists(wav): voz_de([e[1] for e in grupo], wav[:-4])
    print("bloque", ids, "cortado" if cortar(wav, ids) else "SIN CORTAR")
