"use client";

import { useState } from "react";
import type { Estado } from "@/app/acciones-cuenta";
import { Formulario } from "@/app/formulario";
import { SelectorClienteRapido } from "@/app/selector-cliente-rapido";

type Plantilla = { id: string; nombre: string; institucion: string; dias_estimados: number; pasos: { texto: string; dia: number | null }[] };

// «+ Nuevo trámite» (Prioridad 1.5 del prompt de Patricia): nombre, cliente (o alta rápida), tiempo en días laborables y estado. Al elegir un
// trámite de la lista se llenan su institución, su tiempo y sus pasos; la primera vez que se usa un nombre, queda guardado así.
export function NuevoTramite({ accion, plantillas, clientes, equipo, instituciones, etapas, crearClientes, hoy }: {
  accion: (estado: Estado, fd: FormData) => Promise<Estado>;
  plantillas: Plantilla[]; clientes: { id: string; nombre: string }[]; equipo: { id: string; nombre: string }[];
  instituciones: Record<string, string>; etapas: Record<string, string>; crearClientes: boolean; hoy: string;
}) {
  const [plantilla, setPlantilla] = useState<Plantilla | null>(null);
  const [etapa, setEtapa] = useState("pendiente");
  const pasos = plantilla ? plantilla.pasos.map((p) => (p.dia === null ? p.texto : `${p.texto} | ${p.dia}`)).join("\n") : "";
  return (
    <Formulario accion={accion} boton="Crear el trámite">
      <div className="fila">
        <label style={{ flex: "2 1 260px" }}>Trámite de la lista (opcional)
          <select name="plantilla" value={plantilla?.id ?? ""} onChange={(e) => setPlantilla(plantillas.find((p) => p.id === e.target.value) ?? null)}>
            <option value="">Uno nuevo</option>
            {plantillas.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {p.dias_estimados} días{p.pasos.length ? ` · ${p.pasos.length} pasos` : ""}</option>)}
          </select>
        </label>
        <label style={{ flex: "2 1 260px" }}>Nombre del trámite
          <input key={`n${plantilla?.id}`} name="nombre" defaultValue={plantilla?.nombre ?? ""} required={!plantilla} maxLength={120} placeholder="Ej.: Cambio de correo en la DGII" />
        </label>
      </div>
      <div className="fila">
        <SelectorClienteRapido clientes={clientes} crearClientes={crearClientes} />
      </div>
      <div className="fila">
        <label>Institución
          <select key={`i${plantilla?.id}`} name="institucion" defaultValue={plantilla?.institucion ?? "otra"}>
            {Object.entries(instituciones).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label style={{ width: 170 }}>Tiempo estimado (días laborables)
          <input key={`d${plantilla?.id}`} name="dias" type="number" min={1} max={365} defaultValue={plantilla?.dias_estimados ?? ""} required />
        </label>
        <label>Inicio<input type="date" name="fecha" defaultValue={hoy} /></label>
        <label>Estado
          <select name="etapa" value={etapa} onChange={(e) => setEtapa(e.target.value)}>
            {Object.entries(etapas).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>Responsable
          <select name="responsable" defaultValue="">
            <option value="">Sin asignar</option>
            {equipo.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </label>
      </div>
      {etapa === "en_espera" && (
        <div className="fila">
          <label style={{ flex: "3 1 300px" }}>Motivo de la espera<input name="espera_motivo" required maxLength={300} placeholder="Ej.: esperando la clave de la Oficina Virtual" /></label>
          <label style={{ width: 160 }}>Días de espera (laborables)<input name="espera_dias" type="number" min={1} max={365} required /></label>
        </div>
      )}
      <label>Pasos (uno por línea; si tiene día, después de «|»: el día laborable desde el inicio)
        <textarea key={`p${plantilla?.id}`} name="pasos" rows={4} defaultValue={pasos} placeholder={"Pedir la clave al cliente | 1\nDepositar la solicitud | 3\nRetirar la respuesta | 10"} />
      </label>
    </Formulario>
  );
}
