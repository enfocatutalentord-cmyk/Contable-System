"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { Estado } from "@/app/acciones-cuenta";
import { alEnviar } from "@/app/enviar";
import { aCentavos, deCentavos, leerMonto } from "@/lib/montos";
import { leerQr } from "@/lib/validar-fiscal";

// Subir una factura desde el celular (bloque 8b): foto o PDF, el código QR de la factura electrónica (se lee en el teléfono, con la
// foto del código) o los datos escritos. Con la foto basta: si no hay tiempo de escribir, Empire completa los datos al revisarla.
export function SubirFactura({ accion }: { accion: (e: Estado, fd: FormData) => Promise<Estado> }) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  const form = useRef<HTMLFormElement>(null);
  const [tipo, setTipo] = useState<"gasto" | "ingreso">("gasto");
  const [qr, setQr] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [v, setV] = useState({ rnc: "", nombre: "", ncf: "", fecha: "", subtotal: "", itbis: "", total: "" });
  const cambiar = (k: keyof typeof v, x: string) => setV((s) => {
    const n = { ...s, [k]: x };
    if (k === "subtotal" || k === "itbis") {
      const a = leerMonto(n.subtotal || "0"), b = leerMonto(n.itbis || "0");
      if (a !== null && b !== null && (n.subtotal || n.itbis)) n.total = deCentavos(aCentavos(a) + aCentavos(b));
    }
    return n;
  });
  useEffect(() => {
    if (estado.ok) {
      form.current?.reset();
      setQr(""); setAviso(null); setV({ rnc: "", nombre: "", ncf: "", fecha: "", subtotal: "", itbis: "", total: "" });
    }
  }, [estado]);

  // Lee el QR de la foto: se dibuja en un lienzo y jsQR busca el código.
  const leerFoto = async (archivo: File) => {
    setAviso("Leyendo el código…");
    try {
      const { default: jsQR } = await import("jsqr");
      const img = await createImageBitmap(archivo);
      const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
      const lienzo = document.createElement("canvas");
      lienzo.width = Math.round(img.width * escala); lienzo.height = Math.round(img.height * escala);
      const ctx = lienzo.getContext("2d")!;
      ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);
      const datos = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
      const r = jsQR(datos.data, datos.width, datos.height);
      const q = r ? leerQr(r.data) : null;
      if (!q) { setAviso("No se encontró el código QR de una factura electrónica en la foto. Acércate más al código o escribe los datos."); return; }
      setQr(q.url);
      setV((s) => ({
        ...s, ncf: q.ncf ?? s.ncf, fecha: q.fecha ?? s.fecha, total: q.total ?? s.total,
        rnc: (tipo === "gasto" ? q.rncEmisor : q.rncComprador) ?? s.rnc,
      }));
      setAviso("Código leído: revisa los datos y escribe el subtotal y el ITBIS.");
    } catch {
      setAviso("No se pudo leer la foto. Escribe los datos.");
    }
  };

  return (
    <form ref={form} onSubmit={alEnviar(enviar)}>
      <fieldset className="fila" style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
        <legend className="sub" style={{ marginBottom: 6 }}>¿Qué factura es?</legend>
        {(["gasto", "ingreso"] as const).map((t) => (
          <label key={t} style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
            <input type="radio" name="tipo" value={t} checked={tipo === t} onChange={() => setTipo(t)} style={{ minHeight: 0 }} />
            {t === "gasto" ? "Un gasto o compra (me la dio un proveedor)" : "Una venta (la hice yo a un cliente)"}
          </label>
        ))}
      </fieldset>
      <div className="fila">
        <label style={{ flex: "1 1 240px" }}>Foto o PDF de la factura
          <input type="file" name="archivo" accept="image/jpeg,image/png,application/pdf" capture="environment" />
        </label>
        <label style={{ flex: "1 1 240px" }}>¿Es electrónica? Toma una foto del código QR
          <input type="file" accept="image/*" capture="environment" aria-label="Foto del código QR"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void leerFoto(f); }} />
        </label>
      </div>
      <input type="hidden" name="qr" value={qr} />
      {aviso && <p className="sub" role="status">{aviso}</p>}
      <details style={{ marginTop: 8 }} open={!!qr}>
        <summary>Escribir los datos (opcional si subiste la foto)</summary>
        <div className="fila" style={{ marginTop: 8 }}>
          <label style={{ flex: "1 1 160px" }}>{tipo === "gasto" ? "RNC o cédula del proveedor" : "RNC o cédula de tu cliente"}
            <input name="rnc" inputMode="numeric" value={v.rnc} onChange={(e) => cambiar("rnc", e.target.value)} placeholder={tipo === "ingreso" ? "Vacío si fue a consumidor final" : ""} /></label>
          <label style={{ flex: "2 1 220px" }}>Nombre<input name="nombre" maxLength={200} value={v.nombre} onChange={(e) => cambiar("nombre", e.target.value)} /></label>
          <label style={{ flex: "1 1 170px" }}>NCF<input name="ncf" value={v.ncf} onChange={(e) => cambiar("ncf", e.target.value)} placeholder="B0100000001" autoCapitalize="characters" /></label>
          <label>Fecha<input type="date" name="fecha" value={v.fecha} onChange={(e) => cambiar("fecha", e.target.value)} /></label>
        </div>
        <div className="fila">
          <label style={{ width: 150 }}>Subtotal<input name="subtotal" inputMode="decimal" value={v.subtotal} onChange={(e) => cambiar("subtotal", e.target.value)} /></label>
          <label style={{ width: 150 }}>ITBIS<input name="itbis" inputMode="decimal" value={v.itbis} onChange={(e) => cambiar("itbis", e.target.value)} /></label>
          <label style={{ width: 150 }}>Total<input name="total" inputMode="decimal" value={v.total} onChange={(e) => cambiar("total", e.target.value)} /></label>
        </div>
      </details>
      <div style={{ marginTop: 12 }}><button className="primario" disabled={enviando}>{enviando ? "Enviando…" : "Enviar factura"}</button></div>
      {estado.error && <p className="error" role="alert">{estado.error}</p>}
      {estado.ok && <p className="exito" role="status">{estado.ok}</p>}
    </form>
  );
}
