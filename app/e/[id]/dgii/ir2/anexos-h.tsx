import { Formulario } from "@/app/formulario";
import { accesoEmpresa } from "@/lib/acceso";
import { conEmpresa } from "@/lib/db";
import { CONTACTO, datosSociedad, revisarSociedad, TABLAS_H } from "@/lib/ir2-sociedad";
import { puede } from "@/lib/permisos";
import { guardarSociedad } from "../../dgii-acciones";

const FILAS_EXTRA = 3;
const fechaHora = (d: Date) => d.toLocaleString("es-DO", { timeZone: "America/Santo_Domingo", dateStyle: "short", timeStyle: "short" });

// Anexos H-1 y H-2 del IR-2: datos de la sociedad que se guardan una vez y se reusan cada año. Cada tabla muestra lo
// guardado y tres filas vacías más (hasta el máximo del formulario oficial).
export async function AnexosH({ id }: { id: string }) {
  const { permisos } = await accesoEmpresa(id);
  const { datos, guardado, deLaFicha } = await conEmpresa(id, datosSociedad);
  const editar = puede(permisos, "impuestos");
  const avisos = revisarSociedad(datos);
  const errores = avisos.filter((a) => a.nivel === "error");
  const entrada = (nombre: string, valor: string | undefined, etiqueta: string, tipo?: string) =>
    editar ? <input name={nombre} defaultValue={valor ?? ""} aria-label={etiqueta} type={tipo === "fecha" ? "date" : tipo === "correo" ? "email" : "text"}
      inputMode={tipo === "porcentaje" ? "decimal" : undefined} /> : <span>{valor ?? ""}</span>;

  return (
    <>
      <div className="entre" style={{ marginBottom: 12 }}>
        <p className="sub" style={{ margin: 0 }}>
          Identificación del beneficiario final y actualización de datos. Se guardan una vez por cliente y sirven para todos los años.
          {deLaFicha && " Lo que ya estaba en la ficha del cliente viene lleno."}
        </p>
        <span className={`estado-envio ${errores.length ? "con-errores" : "listo"}`}>{errores.length ? `${errores.length} por corregir` : "Completo"}</span>
      </div>
      {errores.length > 0 && <ul className="avisos-dgii">{errores.map((a, i) => <li key={i} className="error">{a.texto}</li>)}</ul>}
      {avisos.length > errores.length && <ul className="avisos-dgii">{avisos.filter((a) => a.nivel === "aviso").map((a, i) => <li key={i} className="aviso-texto">{a.texto}</li>)}</ul>}
      {guardado && <p className="sub">Última edición: {fechaHora(guardado.en)} por {guardado.quien ?? "—"}. Tiene cédulas y domicilios: cada cambio queda en el historial.</p>}

      <Formulario accion={guardarSociedad.bind(null, id)} boton={editar ? "Guardar los anexos H-1 y H-2" : ""} className="it1">
        <section className="tarjeta formato-dgii">
          <h2 style={{ marginTop: 0 }}>Anexo H-1 · A. Datos de contacto de la sociedad o entidad</h2>
          <div className="tabla-envoltura">
            <table className="estado-financiero">
              <tbody>
                {CONTACTO.map((c) => (
                  <tr key={c.k} className="fila-cuenta"><td>{c.texto}</td><td>{entrada(`A_${c.k}`, datos.contacto[c.k], c.texto, c.tipo)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        {(["H-1", "H-2"] as const).map((anexo) => (
          <section key={anexo} className="tarjeta formato-dgii">
            <h2 style={{ marginTop: 0 }}>Anexo {anexo}</h2>
            {TABLAS_H.filter((t) => t.anexo === anexo).map((t) => {
              const filas = datos[t.clave];
              const cuantas = Math.min(t.max, editar ? filas.length + FILAS_EXTRA : filas.length);
              return (
                <div key={t.clave} className="tabla-envoltura">
                  <h3>{t.titulo}</h3>
                  {t.nota && <p className="sub">{t.nota}</p>}
                  <table className="estado-financiero">
                    <thead><tr><th style={{ width: 40 }}>N.º</th>{t.campos.map((c) => <th key={c.k}>{c.texto}</th>)}</tr></thead>
                    <tbody>
                      {Array.from({ length: cuantas }, (_, r) => (
                        <tr key={r} className="fila-cuenta">
                          <td>{r + 1}</td>
                          {t.campos.map((c) => <td key={c.k}>{entrada(`${t.clave}${r}_${c.k}`, filas[r]?.[c.k], `${t.clave} ${r + 1} ${c.texto}`, c.tipo)}</td>)}
                        </tr>
                      ))}
                      {cuantas === 0 && <tr><td colSpan={t.campos.length + 1} className="sub">Sin datos.</td></tr>}
                    </tbody>
                  </table>
                  {editar && filas.length + FILAS_EXTRA > t.max && <p className="sub">Hasta {t.max} filas, como el formulario oficial.</p>}
                  {editar && filas.length + FILAS_EXTRA <= t.max && <p className="sub">Al guardar aparecen más filas vacías (hasta {t.max}).</p>}
                </div>
              );
            })}
          </section>
        ))}
        <section className="tarjeta formato-dgii">
          <h2 style={{ marginTop: 0 }}>Actualización de datos sin cambios</h2>
          <p className="sub">Si la sociedad no tuvo ninguno de estos cambios en el año desde su última declaración, indica la declaración que se reitera.</p>
          <div className="fila">
            <label>Se reitera información de la declaración jurada n.º {entrada("S_declaracion", datos.sinCambios.declaracion, "Número de la declaración")}</label>
            <label>de fecha {entrada("S_fecha", datos.sinCambios.fecha, "Fecha de la declaración", "fecha")}</label>
          </div>
        </section>
      </Formulario>
    </>
  );
}
