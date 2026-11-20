"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { Estado } from "@/app/acciones-cuenta";
import { alEnviar } from "@/app/enviar";
import { SelectorUnidad, type UnidadOpcion } from "@/app/unidad";
import { aCentavos, leerMonto, verMonto } from "@/lib/montos";

type Opcion = { id: string; codigo: string; nombre: string };
type MetaOpcion = { id: string; nombre: string; cuentaId: string | null };
type DeudaOpcion = { id: string; acreedor: string; deNegocio: boolean; prestamo: string | null; interes: string | null };
type Tipo = "oficina" | "personal" | "deuda" | "ahorro" | "traspaso";

// Registrar una salida: se elige el tipo y el sistema arma el asiento con la cuenta que le toca; se ve antes de guardarlo.
export function FormularioSalida({ accion, tipos, efectivo, gastos, socias, unidades, categorias, categoriasOficina, metas, deudas, hoy, minimo }: {
  accion: (e: Estado, fd: FormData) => Promise<Estado>;
  tipos: [Tipo, { nombre: string; efecto: string }][];
  efectivo: Opcion[]; gastos: Opcion[]; socias: Opcion[]; unidades: UnidadOpcion[]; categorias: string[]; categoriasOficina: string[]; metas: MetaOpcion[]; deudas: DeudaOpcion[]; hoy: string; minimo?: string;
}) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  const form = useRef<HTMLFormElement>(null);
  const [tipo, setTipo] = useState<Tipo>("personal");
  const ahorro = efectivo.find((c) => c.codigo === "110104")?.id ?? "";
  // Sugerido: el primer banco que no sea de ahorro (las salidas casi siempre son por transferencia o cheque).
  const banco = efectivo.find((c) => /banco|popular|banreservas|bhd/i.test(c.nombre) && !/ahorro/i.test(c.nombre))?.id ?? efectivo[0]?.id ?? "";
  const [origen, setOrigen] = useState(banco);
  const [destino, setDestino] = useState(socias[0]?.id ?? "");
  const [monto, setMonto] = useState("");
  const [categoria, setCategoria] = useState("");
  const [acreedor, setAcreedor] = useState("");
  const [unidad, setUnidad] = useState("");
  const [meta, setMeta] = useState("");
  const [deuda, setDeuda] = useState("");
  const [interes, setInteres] = useState("");

  const destinos = tipo === "oficina" ? gastos : tipo === "personal" || tipo === "deuda" ? socias : efectivo.filter((c) => c.id !== origen);
  const cambiarTipo = (t: Tipo) => {
    setTipo(t);
    const lista = t === "oficina" ? gastos : t === "personal" || t === "deuda" ? socias : efectivo.filter((c) => c.id !== origen);
    setDestino(t === "ahorro" && ahorro && ahorro !== origen ? ahorro : t === "oficina" ? "" : lista[0]?.id ?? "");
  };
  useEffect(() => {
    if (estado.ok) {
      // Solo se limpia lo de esta salida; el tipo, el banco y la cuenta quedan para la siguiente.
      setMonto(""); setCategoria(""); setAcreedor(""); setInteres("");
      for (const n of ["descripcion", "referencia"]) {
        const el = form.current?.elements.namedItem(n);
        if (el instanceof HTMLInputElement) el.value = "";
      }
    }
  }, [estado]);

  const nombre = (id: string) => [...efectivo, ...gastos, ...socias].find((c) => c.id === id);
  const centavos = aCentavos(leerMonto(monto) ?? "0");
  const d = nombre(destino), o = nombre(origen);
  const deudaElegida = tipo === "deuda" ? deudas.find((x) => x.id === deuda) : undefined;
  const prestamo = !!deudaElegida?.deNegocio;
  const interesC = tipo === "deuda" ? aCentavos(leerMonto(interes) ?? "0") : 0n;
  const cambiarMeta = (id: string) => {
    setMeta(id);
    const m = metas.find((x) => x.id === id);
    if (m?.cuentaId) setDestino(m.cuentaId);
  };
  const efecto = tipos.find(([k]) => k === tipo)?.[1].efecto;

  return (
    <form ref={form} onSubmit={alEnviar(enviar)}>
      <fieldset className="fila" style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
        <legend className="sub" style={{ marginBottom: 6 }}>¿Qué es?</legend>
        {tipos.map(([k, t]) => (
          <label key={k} style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
            <input type="radio" name="tipo" value={k} checked={tipo === k} onChange={() => cambiarTipo(k)} style={{ minHeight: 0 }} /> {t.nombre}
          </label>
        ))}
      </fieldset>
      {efecto && <p className="sub" style={{ marginTop: 0 }}>{efecto}</p>}
      <div className="fila">
        <label>Fecha<input type="date" name="fecha" defaultValue={hoy} min={minimo} required /></label>
        <label style={{ width: 150 }}>Monto (RD$)<input name="monto" inputMode="decimal" required value={monto} onChange={(e) => setMonto(e.target.value)} /></label>
        <label style={{ flex: "1 1 220px" }}>Sale de
          <select name="origen" value={origen} onChange={(e) => setOrigen(e.target.value)} required>
            {efectivo.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
          </select>
        </label>
        {!prestamo && <label style={{ flex: "1 1 260px" }}>
          {tipo === "oficina" ? "Cuenta de gasto" : tipo === "personal" || tipo === "deuda" ? "Cuenta corriente de la socia" : "Va a"}
          <select name="destino" value={destino} onChange={(e) => setDestino(e.target.value)} required>
            <option value="">Elige…</option>
            {destinos.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
          </select>
        </label>}
      </div>
      <div className="fila" style={{ marginTop: 8 }}>
        {tipo === "personal" && (
          <label style={{ flex: "1 1 220px" }}>Categoría
            <input name="categoria" list="categorias-personales" required value={categoria} onChange={(e) => setCategoria(e.target.value)} maxLength={80} placeholder="Ej.: Alimentación" />
            <datalist id="categorias-personales">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
        )}
        {tipo === "oficina" && (
          <label style={{ flex: "1 1 220px" }}>Categoría del presupuesto
            <input name="categoria" list="categorias-oficina" value={categoria} onChange={(e) => setCategoria(e.target.value)} maxLength={80} placeholder="Ej.: Electricidad oficina" />
            <datalist id="categorias-oficina">{categoriasOficina.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
        )}
        {tipo === "ahorro" && metas.length > 0 && (
          <label style={{ flex: "1 1 220px" }}>Meta de ahorro
            <select name="meta" value={meta} onChange={(e) => cambiarMeta(e.target.value)}>
              <option value="">Sin meta</option>
              {metas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
            </select>
          </label>
        )}
        {tipo === "deuda" && deudas.length > 0 && (
          <label style={{ flex: "1 1 220px" }}>Deuda del presupuesto
            <select name="deuda" value={deuda} onChange={(e) => setDeuda(e.target.value)}>
              <option value="">Otra (escribir quién)</option>
              {deudas.map((x) => <option key={x.id} value={x.id}>{x.acreedor}{x.deNegocio ? " · préstamo del negocio" : ""}</option>)}
            </select>
          </label>
        )}
        {tipo === "deuda" && !deudaElegida && (
          <label style={{ flex: "1 1 220px" }}>A quién se paga<input name="acreedor" required value={acreedor} onChange={(e) => setAcreedor(e.target.value)} maxLength={120} placeholder="Ej.: Tarjeta BHD" /></label>
        )}
        {tipo === "deuda" && (
          <label style={{ width: 160 }}>De ese pago, intereses (RD$)<input name="interes" inputMode="decimal" value={interes} onChange={(e) => setInteres(e.target.value)} placeholder="0.00" /></label>
        )}
        {tipo === "oficina" && unidades.length > 0 && (
          <label>Unidad de negocio<SelectorUnidad unidades={unidades} valor={unidad} cambiar={setUnidad} etiqueta="Unidad de negocio" /><input type="hidden" name="unidad" value={unidad} /></label>
        )}
        <label style={{ flex: "2 1 260px" }}>Descripción<input name="descripcion" maxLength={300} placeholder={tipo === "oficina" ? "Ej.: Luz de octubre" : "Opcional"} /></label>
        <label style={{ width: 160 }}>Referencia<input name="referencia" maxLength={80} placeholder="Transferencia, cheque…" /></label>
      </div>
      {tipo === "oficina" && <p className="sub">Si el gasto tiene factura con comprobante fiscal, regístralo en Compras y gastos para que vaya al 606.</p>}

      <div className="tabla-envoltura" style={{ marginTop: 12 }}>
        <table>
          <caption style={{ textAlign: "left", fontWeight: 600, paddingBottom: 6 }}>Asiento que se va a registrar</caption>
          <thead><tr><th>Cuenta</th><th>Categoría</th><th className="num">Debe</th><th className="num">Haber</th></tr></thead>
          <tbody>
            {prestamo ? (
              <>
                {centavos - interesC > 0n && <tr><td>{deudaElegida?.prestamo ?? "—"}</td><td>Capital</td><td className="num">{verMonto(centavos - interesC)}</td><td /></tr>}
                {interesC > 0n && <tr><td>{deudaElegida?.interes ?? "—"}</td><td>Intereses</td><td className="num">{verMonto(interesC)}</td><td /></tr>}
              </>
            ) : (
              <tr><td>{d ? `${d.codigo} · ${d.nombre}` : "—"}</td><td>{tipo === "personal" ? categoria : tipo === "deuda" ? "Pago de deuda" : ""}</td><td className="num">{verMonto(centavos)}</td><td /></tr>
            )}
            <tr><td>{o ? `${o.codigo} · ${o.nombre}` : "—"}</td><td /><td /><td className="num">{verMonto(centavos)}</td></tr>
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 12 }}><button className="primario" disabled={enviando || centavos <= 0n || (!destino && !prestamo)}>{enviando ? "Guardando…" : "Registrar salida"}</button></div>
      {estado.error && <p className="error" role="alert">{estado.error}</p>}
      {estado.ok && <p className="exito" role="status">{estado.ok}</p>}
    </form>
  );
}
