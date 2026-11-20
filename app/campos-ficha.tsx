import { CampoRnc } from "./campo-rnc";
import { MESES, REGIMENES, TIPOS_IDENTIFICACION } from "@/lib/permisos";

export type DatosFicha = {
  nombre?: string; nombre_comercial?: string | null; tipo_identificacion?: string; rnc?: string | null;
  actividad_economica?: string | null; regimen?: string; direccion?: string | null; telefono?: string | null;
  correo?: string | null; mes_cierre?: number; inicio_operaciones?: string | null; requiere_aprobacion?: boolean; activa?: boolean;
};

// Campos de la ficha de una empresa cliente (alta y edición). La casilla de aprobación de asientos solo va en la empresa propia: a los
// clientes no se les hacen asientos (rediseño R3, n.º 14).
export function CamposFicha({ d = {}, edicion = false, deshabilitado = false }: { d?: DatosFicha; edicion?: boolean; deshabilitado?: boolean }) {
  return (
    <fieldset disabled={deshabilitado} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 14 }}>
      {!edicion && (
        <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="checkbox" name="en_constitucion" style={{ minHeight: 0 }} />
          Empresa en constitución: nombre provisional y sin RNC todavía (se actualiza cuando ONAPI y la DGII aprueben)
        </label>
      )}
      <div className="fila">
        <label style={{ flex: "2 1 280px" }}>Razón social o nombre<input name="nombre" defaultValue={d.nombre} required /></label>
        <label style={{ flex: "1 1 220px" }}>Nombre comercial<input name="nombre_comercial" defaultValue={d.nombre_comercial ?? ""} /></label>
      </div>
      <div className="fila" style={{ alignItems: "flex-start" }}>
        <label>Identificación
          <select name="tipo_identificacion" defaultValue={d.tipo_identificacion ?? "rnc"}>
            {Object.entries(TIPOS_IDENTIFICACION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <CampoRnc etiqueta="Número" name="rnc" defaultValue={d.rnc ?? ""} placeholder="9 dígitos (RNC) u 11 (cédula)" llena={{ nombre: "nombre", nombre_comercial: "nombre_comercial", actividad: "actividad_economica", fecha_inicio: "inicio_operaciones" }} estilo={{ flex: "1 1 220px" }} />
        <label style={{ flex: "2 1 260px" }}>Régimen tributario
          <select name="regimen" defaultValue={d.regimen ?? "ordinario"}>
            {Object.entries(REGIMENES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      <label>Actividad económica<input name="actividad_economica" defaultValue={d.actividad_economica ?? ""} placeholder="Ej.: Servicios de contabilidad y asesoría fiscal" /></label>
      <div className="fila">
        <label style={{ flex: "2 1 300px" }}>Dirección<input name="direccion" defaultValue={d.direccion ?? ""} /></label>
        <label style={{ flex: "1 1 150px" }}>Teléfono<input name="telefono" defaultValue={d.telefono ?? ""} /></label>
        <label style={{ flex: "1 1 200px" }}>Correo<input name="correo" type="email" defaultValue={d.correo ?? ""} /></label>
      </div>
      <div className="fila">
        <label>Cierre del ejercicio fiscal
          <select name="mes_cierre" defaultValue={String(d.mes_cierre ?? 12)}>
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </label>
        <label>Inicio de operaciones<input name="inicio_operaciones" type="date" defaultValue={d.inicio_operaciones ?? ""} /></label>
        <label>Moneda<input value="Peso dominicano (DOP)" disabled /></label>
      </div>
      {edicion && (
        <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="hidden" name="activa_presente" value="1" />
          <input type="checkbox" name="activa" defaultChecked={d.activa ?? true} style={{ minHeight: 0 }} /> Cliente activo
        </label>
      )}
    </fieldset>
  );
}
