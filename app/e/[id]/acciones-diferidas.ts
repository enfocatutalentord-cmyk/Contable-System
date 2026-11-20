import type { Estado } from "../../acciones-cuenta";
import { fijarBloqueo } from "./acciones";
import { cerrarElEjercicio } from "./cierre-ejercicio-acciones";
import { anularLaCompra } from "./compras-acciones";
import { marcarEnviado, presentarDeclaracion } from "./dgii-acciones";
import { revisarReporte } from "./reporte-acciones";
import { anularSalidaAccion, registrarSalidaAccion } from "./socia-acciones";
import { anularComprobante, crearNotaCredito } from "./ventas-acciones";

// Prioridad 2.1 (P2a, parte 2): las acciones que pueden quedar esperando aprobación, por nombre. Al aprobar, se ejecutan con los mismos datos
// que tenía quien las pidió, pero con la sesión de quien aprueba (que debe tener el permiso completo). Módulo normal: no es «use server».

type Accion = (empresaId: string, args: string[], fd: FormData) => Promise<Estado | undefined | void>;

export const ACCIONES_DIFERIDAS: Record<string, Accion> = {
  registrarSalida: (e, _a, fd) => registrarSalidaAccion(e, {}, fd),
  anularSalida: (e, a, fd) => anularSalidaAccion(e, a[0], {}, fd),
  notaCredito: (e, a, fd) => crearNotaCredito(e, a[0], {}, fd),
  anularComprobante: (e, a, fd) => anularComprobante(e, a[0], {}, fd),
  anularCompra: (e, a, fd) => anularLaCompra(e, a[0], {}, fd),
  revisarReporte: (e, a) => revisarReporte(e, a[0]),
  marcarEnviado: (e, a, fd) => marcarEnviado(e, a[0], a[1], {}, fd),
  presentarDeclaracion: (e, a, fd) => presentarDeclaracion(e, a[0], a[1], {}, fd),
  fijarBloqueo: (e, _a, fd) => fijarBloqueo(e, {}, fd),
  cerrarEjercicio: (e, a, fd) => cerrarElEjercicio(e, a[0], {}, fd),
};
