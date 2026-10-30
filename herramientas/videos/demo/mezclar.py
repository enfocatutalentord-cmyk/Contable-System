# Une el video grabado con la voz: cada escena suena en el segundo en que empezó (tiempos.json). Sale demo.mp4 (H.264 + AAC).
# Uso: python3 -I mezclar.py <carpeta>
import json, os, subprocess, sys
dir = sys.argv[1]
tiempos = json.load(open(os.path.join(dir, "tiempos.json")))
entradas, filtros = ["-i", os.path.join(dir, "demo.webm")], []
for n, (id, seg) in enumerate(tiempos, start=1):
    entradas += ["-i", os.path.join(dir, "voz", f"{id}.mp3")]
    ms = int((seg + 0.3) * 1000)
    filtros.append(f"[{n}:a]adelay={ms}|{ms},volume=1.6[a{n}]")
mezcla = "".join(f"[a{n}]" for n in range(1, len(tiempos) + 1))
filtros.append(f"{mezcla}amix=inputs={len(tiempos)}:normalize=0,alimiter=limit=0.95[voz]")
subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *entradas, "-filter_complex", ";".join(filtros),
                "-map", "0:v", "-map", "[voz]", "-c:v", "libx264", "-crf", "24", "-preset", "medium", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-shortest", os.path.join(dir, "demo.mp4")],
               check=True, stdin=subprocess.DEVNULL)
print("listo", os.path.getsize(os.path.join(dir, "demo.mp4")))
