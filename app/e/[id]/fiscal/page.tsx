import Link from "next/link";
import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { obligacionesDeEmpresa, perfilFiscal } from "@/lib/fiscal";
import { puede, REGIMENES } from "@/lib/permisos";
import { guardarObligaciones, guardarPerfilFiscal } from "../fiscal-acciones";

export default async function PerfilFiscal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { permisos } = await accesoEmpresa(id);
  const { perfil, obligaciones, resumen } = await conEmpresa(id, async (tx) => {
    const perfil = await perfilFiscal(tx);
    const [resumen] = await tx<{ impuestos: number; retenciones: number; rangos: number }[]>`
      SELECT (SELECT count(*)::int FROM impuestos WHERE activo) AS impuestos,
             (SELECT count(*)::int FROM retenciones WHERE activo) AS retenciones,
             (SELECT count(*)::int FROM secuencias_ncf WHERE activa AND vence >= current_date AND siguiente <= hasta) AS rangos`;
    return { perfil, obligaciones: await obligacionesDeEmpresa(tx, perfil), resumen };
  });
  const editable = puede(permisos, "impuestos");
  const sinConfirmar = obligaciones.some((o) => !o.confirmada);

  return (
    <>
      <h1>Perfil fiscal</h1>
      <p className="sub">
        Cómo tributa este cliente. No todas las empresas tienen las mismas obligaciones ni todo lo que venden lleva ITBIS:
        lo que marques aquí guía los cálculos y las declaraciones.
      </p>

      <div className="cifras">
        <Link className="tarjeta cifra" href={`/e/${id}/fiscal/impuestos`}><div className="etiqueta">Impuestos activos</div><div className="valor">{resumen.impuestos}</div></Link>
        <Link className="tarjeta cifra" href={`/e/${id}/fiscal/retenciones`}><div className="etiqueta">Retenciones activas</div><div className="valor">{resumen.retenciones}</div></Link>
        <Link className="tarjeta cifra" href={`/e/${id}/comprobantes`}><div className="etiqueta">Rangos de comprobantes disponibles</div><div className="valor">{resumen.rangos}</div></Link>
      </div>

      <div className="tarjeta">
        <Formulario accion={guardarPerfilFiscal.bind(null, id)} boton={editable ? "Guardar perfil fiscal" : ""} className="">
          <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 14 }}>
            <div className="fila">
              <label>Tipo de contribuyente
                <select name="tipo_persona" defaultValue={perfil.tipo_persona}>
                  <option value="juridica">Persona jurídica (sociedad)</option>
                  <option value="fisica">Persona física</option>
                </select>
              </label>
              <div style={{ flex: "1 1 260px" }}>
                <div className="sub" style={{ margin: 0 }}>Régimen tributario</div>
                <strong>{REGIMENES[perfil.regimen] ?? perfil.regimen}</strong>{" "}
                <Link href={`/e/${id}/empresa`} className="sub">(se cambia en la ficha)</Link>
              </div>
            </div>
            <div className="casillas">
              <label className="casilla"><input type="checkbox" name="contribuye_itbis" defaultChecked={perfil.contribuye_itbis} /> Contribuyente de ITBIS (cobra ITBIS y lo declara en el IT-1)</label>
              <label className="casilla"><input type="checkbox" name="agente_retencion" defaultChecked={perfil.agente_retencion} /> Agente de retención (retiene ITBIS o ISR a sus proveedores)</label>
              <label className="casilla"><input type="checkbox" name="emisor_ecf" defaultChecked={perfil.emisor_ecf} /> Emisor de facturación electrónica (e-CF)</label>
            </div>
            <label style={{ maxWidth: 260 }}>Emite e-CF desde (si aplica)<input type="date" name="ecf_desde" defaultValue={perfil.ecf_desde ?? ""} /></label>
          </fieldset>
        </Formulario>
      </div>

      <h2>Obligaciones ante la DGII</h2>
      <p className="sub">
        Marca las declaraciones que presenta este cliente. Las sugerencias salen del perfil fiscal; tú decides.
        Si la fecha cae en fin de semana o feriado, pasa al siguiente día hábil.
      </p>
      {sinConfirmar && <p className="aviso">Hay obligaciones que todavía son solo una sugerencia. Revísalas y guarda para confirmarlas.</p>}
      <Formulario accion={guardarObligaciones.bind(null, id)} boton={editable ? "Guardar obligaciones" : ""} className="">
        <div className="tabla-envoltura">
          <table>
            <thead><tr><th>Aplica</th><th>Formulario</th><th>Obligación</th><th>Frecuencia</th><th>Vence</th><th>Sugerencia</th></tr></thead>
            <tbody>
              {obligaciones.map((o) => (
                <tr key={o.clave}>
                  <td><input type="checkbox" name={`ob_${o.clave}`} defaultChecked={o.activa} disabled={!editable} aria-label={`Aplica ${o.formulario}`} /></td>
                  <td><strong>{o.formulario}</strong></td>
                  <td>{o.nombre}{!o.confirmada && <span className="etiqueta-rol" style={{ marginLeft: 6 }}>sin confirmar</span>}</td>
                  <td>{o.periodicidad}</td>
                  <td>{o.vence}</td>
                  <td className="sub" style={{ margin: 0 }}>{o.sugeridaAhora ? `Sí (${o.motivo})` : o.motivo.startsWith("Márcala") ? o.motivo : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Formulario>
      <p className="sub" style={{ marginTop: 16 }}>
        Plazos según el calendario tributario de la DGII y la Norma General 07-2018 (formatos 606, 607, 608 y 609).
      </p>
    </>
  );
}
