#!/bin/bash
# Genera la voz (Aoede) de cada escena de escenas.json en <carpeta>/<id>.mp3, reintentando si la API responde 429.
set -e
dir="$1"; mkdir -p "$dir"
aqui="$(cd "$(dirname "$0")" && pwd)"
python3 -I -c 'import json,sys; [print(e[0]+"\t"+e[1]) for e in json.load(open(sys.argv[1]))]' "$aqui/escenas.json" | while IFS=$'\t' read -r id texto; do
  [ -s "$dir/$id.mp3" ] && continue
  for intento in 1 2 3 4 5; do
    if python3 -I "$aqui/../voz.py" gemini-3.8-flash-tts Aoede "$texto" "$dir/$id" </dev/null >/dev/null 2>&1; then break; fi
    sleep $((intento * 20))
  done
  echo "$id $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$dir/$id.mp3" </dev/null)"
done
