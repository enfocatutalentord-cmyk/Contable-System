import { inflateSync } from "node:zlib";

// Los archivos se aceptan por su firma (los primeros bytes); una imagen dañada hace que el generador de PDF falle sin remedio, así que antes de dibujarla se comprueba
// que se pueda leer: un PNG con sus trozos completos y datos que se descomprimen, y un JPG con su marca de tamaño. Las que no, se nombran en la lista de archivos.
export function imagenLegible(tipo: string, b: Uint8Array): boolean {
  try {
    if (tipo === "image/png") {
      if (b.length < 33 || b[0] !== 0x89 || b[1] !== 0x50) return false;
      const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const idat: Uint8Array[] = [];
      let pos = 8, ihdr = false, fin = false;
      while (pos + 12 <= b.length) {
        const largo = v.getUint32(pos), tipoTrozo = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
        if (pos + 12 + largo > b.length) return false;
        if (tipoTrozo === "IHDR") ihdr = true;
        if (tipoTrozo === "IDAT") idat.push(b.subarray(pos + 8, pos + 8 + largo));
        if (tipoTrozo === "IEND") { fin = true; break; }
        pos += 12 + largo;
      }
      if (!ihdr || !fin || !idat.length) return false;
      inflateSync(Buffer.concat(idat));
      return true;
    }
    if (tipo === "image/jpeg") {
      if (b[0] !== 0xff || b[1] !== 0xd8) return false;
      let pos = 2;
      while (pos + 4 <= b.length) {
        if (b[pos] !== 0xff) return false;
        const marca = b[pos + 1];
        if (marca === 0xd8 || marca === 0x01 || (marca >= 0xd0 && marca <= 0xd7)) { pos += 2; continue; }
        if ((marca >= 0xc0 && marca <= 0xc3) || (marca >= 0xc5 && marca <= 0xc7) || (marca >= 0xc9 && marca <= 0xcb) || (marca >= 0xcd && marca <= 0xcf)) return true; // trae su tamaño
        pos += 2 + ((b[pos + 2] << 8) | b[pos + 3]);
      }
      return false;
    }
  } catch { return false; }
  return false;
}
