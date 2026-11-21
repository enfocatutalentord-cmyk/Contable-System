import { CAMPOS_HALLAZGO, RIESGOS } from "@/lib/auditorias";

type Persona = { id: string; nombre: string };

// Campos del plan de una auditoría (se usan al crear y al corregir). Sin «use client»: son campos sueltos dentro de un <Formulario>.
export function CamposPlan({ equipo, valores }: {
  equipo: Persona[];
  valores?: { nombre: string; objetivo: string; alcance: string; periodo_desde: string | null; periodo_hasta: string | null; fecha_inicio: string | null; fecha_fin: string | null; responsable_id: string | null; equipo: string[] };
}) {
  const v = valores;
  return (
    <>
      <label>Nombre de la auditoría<input name="nombre" required minLength={3} maxLength={150} defaultValue={v?.nombre ?? ""} placeholder="Ej.: Revisión de inventario y compras 2026" /></label>
      <label>Objetivo<textarea name="objetivo" rows={3} maxLength={2000} defaultValue={v?.objetivo ?? ""} placeholder="Qué se quiere comprobar y para qué." /></label>
      <label>Alcance<textarea name="alcance" rows={3} maxLength={2000} defaultValue={v?.alcance ?? ""} placeholder="Qué áreas, documentos y períodos se revisan, y qué queda fuera. Si se sigue una norma o estándar, escríbelo aquí." /></label>
      <div className="fila">
        <label>Período auditado, desde<input type="date" name="periodo_desde" defaultValue={v?.periodo_desde ?? ""} /></label>
        <label>Hasta<input type="date" name="periodo_hasta" defaultValue={v?.periodo_hasta ?? ""} /></label>
        <label>Inicio del trabajo<input type="date" name="inicio" defaultValue={v?.fecha_inicio ?? ""} /></label>
        <label>Fin del trabajo<input type="date" name="fin" defaultValue={v?.fecha_fin ?? ""} /></label>
      </div>
      <div className="fila">
        <label>Responsable
          <select name="responsable" defaultValue={v?.responsable_id ?? ""}>
            <option value="">Sin asignar</option>
            {equipo.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </label>
      </div>
      <fieldset style={{ border: "1px solid var(--borde)", borderRadius: 8, padding: "8px 12px" }}>
        <legend>Equipo</legend>
        <div className="fila" style={{ gap: 14 }}>
          {equipo.map((u) => (
            <label key={u.id} style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
              <input type="checkbox" name="equipo" value={u.id} style={{ minHeight: 0 }} defaultChecked={v?.equipo.includes(u.id)} />{u.nombre}
            </label>
          ))}
          {equipo.length === 0 && <span className="sub">La firma no tiene equipo cargado.</span>}
        </div>
      </fieldset>
    </>
  );
}

// Campos de un hallazgo: título, riesgo, paso del plan y los cinco campos (situación, criterio, causa, efecto y recomendación).
export function CamposHallazgo({ pasos, valores, conArchivos = true }: {
  pasos: { id: string; descripcion: string }[];
  valores?: { titulo: string; riesgo: string; paso_id: string | null; situacion: string; criterio: string; causa: string; efecto: string; recomendacion: string };
  conArchivos?: boolean;
}) {
  const v = valores;
  return (
    <>
      <div className="fila">
        <label style={{ flex: "3 1 280px" }}>Título del hallazgo<input name="titulo" required minLength={3} maxLength={150} defaultValue={v?.titulo ?? ""} placeholder="Ej.: Facturas de compra sin comprobante fiscal" /></label>
        <label>Riesgo
          <select name="riesgo" defaultValue={v?.riesgo ?? "medio"}>
            {Object.entries(RIESGOS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
        </label>
        <label style={{ flex: "2 1 220px" }}>Paso del plan (opcional)
          <select name="paso" defaultValue={v?.paso_id ?? ""}>
            <option value="">Ninguno</option>
            {pasos.map((p) => <option key={p.id} value={p.id}>{p.descripcion.slice(0, 70)}</option>)}
          </select>
        </label>
      </div>
      {CAMPOS_HALLAZGO.map((c) => (
        <label key={c.clave}>{c.nombre} <span className="sub">· {c.ayuda}</span>
          <textarea name={c.clave} rows={3} maxLength={3000} defaultValue={v?.[c.clave] ?? ""} />
        </label>
      ))}
      {conArchivos && <label>Fotos o archivos de prueba (opcional, hasta 5 y 4 MB en total: foto, PDF, Word o Excel)<input type="file" name="archivo" multiple accept="image/*,.pdf,.docx,.xlsx" /></label>}
    </>
  );
}
