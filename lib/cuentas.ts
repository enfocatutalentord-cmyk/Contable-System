import type { TipoCuenta } from "./catalogo-rd";
import type { Tx } from "./db";

export type Cuenta = {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  nivel: number;
  de_detalle: boolean;
  activa: boolean;
  actividad_flujo: string | null;
  casilla_ir2: string | null;
};

export async function listarCuentas(tx: Tx): Promise<Cuenta[]> {
  return tx<Cuenta[]>`SELECT id, codigo, nombre, tipo, nivel, de_detalle, activa, actividad_flujo, casilla_ir2 FROM cuentas ORDER BY codigo`;
}
