import { Formulario } from "../../formulario";
import { LogoCompleto } from "../../marca";
import { CAPITAL_MINIMO, formularioPorToken, PRIORIDADES, serviciosDeLaFirma, TIPOS_FORMULARIO } from "@/lib/formularios";
import { GRUPOS_SERVICIO } from "@/lib/precios";
import { verMonto } from "@/lib/montos";
import { conEmpresa } from "@/lib/db";
import { CamposLevantamiento } from "./levantamiento";
import { enviarFormularioPublico } from "../acciones";

export const metadata = { title: "Formulario · Empire Tax’N Legal", robots: { index: false } };

const Campo = ({ n, t, tipo = "text", req, ph, ancho }: { n: string; t: string; tipo?: string; req?: boolean; ph?: string; ancho?: number }) => (
  <label style={ancho ? { flex: `1 1 ${ancho}px` } : undefined}>{t}<input name={n} type={tipo} required={req} placeholder={ph} maxLength={200} /></label>
);
const SiNo = ({ n, t }: { n: string; t: string }) => (
  <label>{t}<select name={n} defaultValue=""><option value="">—</option><option value="si">Sí</option><option value="no">No</option></select></label>
);

function Socios({ titulo, filas = 5 }: { titulo: string; filas?: number }) {
  return (
    <fieldset className="tarjeta">
      <legend><strong>{titulo}</strong></legend>
      <p className="sub" style={{ marginTop: 0 }}>Los porcentajes deben sumar 100 %.</p>
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="fila">
          <Campo n={`s${i}_nombre`} t={`Nombre ${i + 1}`} ancho={200} />
          <Campo n={`s${i}_cedula`} t="Cédula" ancho={140} />
          <Campo n={`s${i}_telefono`} t="Teléfono" tipo="tel" ancho={130} />
          <Campo n={`s${i}_porcentaje`} t="% de cuotas" ancho={90} />
        </div>
      ))}
    </fieldset>
  );
}

function Contacto({ rol, titulo, cargo }: { rol: string; titulo: string; cargo?: boolean }) {
  return (
    <fieldset className="tarjeta">
      <legend><strong>{titulo}</strong></legend>
      <div className="fila">
        <Campo n={`c_${rol}_nombre`} t="Nombre" ancho={220} />
        <Campo n={`c_${rol}_cedula`} t="Cédula" ancho={140} />
        {cargo && <Campo n={`c_${rol}_cargo`} t="Cargo" ancho={140} />}
        <Campo n={`c_${rol}_whatsapp`} t="WhatsApp" tipo="tel" ancho={140} />
        <Campo n={`c_${rol}_correo`} t="Correo" tipo="email" ancho={200} />
        <Campo n={`c_${rol}_nacimiento`} t="Fecha de nacimiento" tipo="date" />
      </div>
    </fieldset>
  );
}

const Adjuntos = ({ texto }: { texto: string }) => (
  <fieldset className="tarjeta">
    <legend><strong>Documentos</strong></legend>
    <label>{texto} (fotos o PDF; hasta 10 y 4 MB en total)
      <input type="file" name="archivos" multiple accept="application/pdf,image/jpeg,image/png" />
    </label>
  </fieldset>
);

// Formulario en línea (bloque 6a): lo abre el cliente desde el enlace que le llegó por WhatsApp, sin cuenta y desde el celular.
export default async function FormularioEnLinea({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const f = await formularioPorToken(token);
  const def = f ? TIPOS_FORMULARIO[f.tipo] : null;
  const servicios = f?.tipo === "solicitud" ? await serviciosDeLaFirma(f.propia) : [];
  const grupos = [...new Set(servicios.map((s) => s.grupo))];
  // El levantamiento viene lleno con lo que ya está en la ficha; el cliente solo lo confirma.
  const iniciales = f?.tipo === "levantamiento" && f.estado === "pendiente" ? await conEmpresa(f.empresa_id, async (tx) => {
    const [e] = await tx<Record<string, string | null>[]>`
      SELECT e.nombre, e.nombre_comercial, e.rnc, to_char(e.fecha_constitucion, 'YYYY-MM-DD') AS fecha_constitucion, e.direccion, e.municipio, e.provincia, e.telefono, e.correo,
             c.nombre AS contacto, c.cargo FROM empresas e LEFT JOIN contactos_empresa c ON c.empresa_id = e.id AND c.rol = 'principal' WHERE e.id = ${f.empresa_id}`;
    return Object.fromEntries(Object.entries(e ?? {}).filter(([, v]) => v)) as Record<string, string>;
  }) : {};

  return (
    <main className="formulario-publico">
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "16px" }}>
        <LogoCompleto />
        {!f || !def ? (
          <div className="tarjeta"><h1>Enlace no disponible</h1><p>El enlace venció o ya no está disponible. Pida uno nuevo a la firma.</p></div>
        ) : f.estado !== "pendiente" ? (
          <div className="tarjeta"><h1>{def.nombre}</h1><p>Ya recibimos este formulario. ¡Gracias! Si necesita cambiar algo, escríbale a la firma.</p></div>
        ) : (
          <>
            <h1 style={{ marginBottom: 4 }}>{def.nombre}</h1>
            <p className="sub">{f.empresa} · {f.firma} · {def.codigo}. Llénelo desde aquí; al enviarlo, la firma lo revisa antes de guardarlo.</p>
            <Formulario accion={enviarFormularioPublico.bind(null, token)} boton="Enviar" className="formulario formulario-cliente">
              {f.tipo === "ficha" && (
                <>
                  <fieldset className="tarjeta">
                    <legend><strong>La empresa</strong></legend>
                    <div className="fila">
                      <Campo n="nombre" t="Razón social" req ancho={260} />
                      <Campo n="nombre_comercial" t="Nombre comercial" ancho={200} />
                      <Campo n="rnc" t="RNC" ancho={130} />
                      <Campo n="tipo_sociedad" t="Tipo de sociedad (SRL, SA, EIRL…)" ancho={200} />
                      <Campo n="fecha_constitucion" t="Fecha de constitución" tipo="date" />
                      <Campo n="direccion" t="Dirección" ancho={320} />
                      <Campo n="municipio" t="Municipio" ancho={160} />
                      <Campo n="provincia" t="Provincia" ancho={160} />
                      <Campo n="telefono" t="Teléfono" tipo="tel" ancho={140} />
                      <Campo n="correo" t="Correo" tipo="email" ancho={220} />
                      <Campo n="capital_social" t="Capital social (RD$)" ancho={150} />
                    </div>
                  </fieldset>
                  <Socios titulo="Socios" />
                  <Contacto rol="representante" titulo="Representante legal (firma las cartas)" cargo />
                  <Contacto rol="principal" titulo="Contacto principal para la firma" />
                  <Contacto rol="alterno" titulo="Contacto alterno" />
                  <fieldset className="tarjeta">
                    <legend><strong>Operaciones</strong></legend>
                    <div className="fila">
                      <Campo n="ventas_mes" t="Ventas al mes (RD$, aproximado)" ancho={180} />
                      <Campo n="facturas_mes" t="Facturas al mes (compras y ventas)" ancho={180} />
                      <Campo n="empleados_mes" t="Empleados" ancho={110} />
                      <SiNo n="tiene_tss" t="¿Está registrada en la TSS?" />
                      <SiNo n="emite_ecf" t="¿Emite factura electrónica?" />
                      <Campo n="sistema_usa" t="Sistema que usa para facturar" ancho={200} />
                      <Campo n="grupo_whatsapp" t="Nombre del grupo de WhatsApp de contabilidad" ancho={260} />
                    </div>
                  </fieldset>
                  <Adjuntos texto="RNC, registro mercantil, estatutos, cédulas de los socios, certificado de ONAPI, logo" />
                </>
              )}
              {f.tipo === "constitucion" && (
                <>
                  <fieldset className="tarjeta">
                    <legend><strong>La empresa que se va a constituir</strong></legend>
                    <div className="fila">
                      <Campo n="n1" t="Nombre propuesto 1" req ancho={220} />
                      <Campo n="n2" t="Nombre propuesto 2" ancho={220} />
                      <Campo n="n3" t="Nombre propuesto 3" ancho={220} />
                      <Campo n="actividad" t="¿A qué se va a dedicar?" ancho={320} />
                      <Campo n="direccion" t="Domicilio de la empresa" ancho={320} />
                      <Campo n="capital_social" t={`Capital social (RD$; mínimo ${verMonto((CAPITAL_MINIMO / 100n).toString())})`} req ancho={200} />
                      <SiNo n="tiene_tss" t="¿Tendrá empleados (TSS)?" />
                    </div>
                  </fieldset>
                  <Socios titulo="Accionistas" />
                  <Contacto rol="gerente" titulo="Gerente o representante" cargo />
                  <fieldset className="tarjeta">
                    <legend><strong>Notas</strong></legend>
                    <label>Algo más que debamos saber<textarea name="notas" rows={3} maxLength={500} /></label>
                  </fieldset>
                  <Adjuntos texto="Cédulas de los accionistas (ambos lados), certificado de ONAPI y recibo del impuesto sobre el capital si ya los tiene" />
                </>
              )}
              {f.tipo === "levantamiento" && <CamposLevantamiento clave={token.slice(0, 12)} iniciales={iniciales} />}
              {f.tipo === "solicitud" && (
                <>
                  <fieldset className="tarjeta">
                    <legend><strong>¿Qué necesita?</strong></legend>
                    {servicios.length > 0 && (
                      <label>Servicio
                        <select name="servicio_id" defaultValue="">
                          <option value="">Otro (lo describo abajo)</option>
                          {grupos.map((g) => (
                            <optgroup key={g ?? "otros"} label={g ? GRUPOS_SERVICIO[g] ?? g : "Otros"}>
                              {servicios.filter((s) => s.grupo === g).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                            </optgroup>
                          ))}
                        </select>
                      </label>
                    )}
                    <label>Describa lo que necesita<textarea name="descripcion" rows={4} required maxLength={2000} /></label>
                    <label>¿Para qué lo necesita?<input name="para_que" maxLength={1000} /></label>
                    <div className="fila">
                      <Campo n="fecha_requerida" t="¿Para cuándo?" tipo="date" />
                      <label>Prioridad<select name="prioridad" defaultValue="media">{Object.entries(PRIORIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                    </div>
                  </fieldset>
                  <Adjuntos texto="Documentos que ayuden a entender lo que necesita" />
                </>
              )}
            </Formulario>
          </>
        )}
      </div>
    </main>
  );
}
