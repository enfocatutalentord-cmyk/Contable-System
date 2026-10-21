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
};

export async function listarCuentas(tx: Tx): Promise<Cuenta[]> {
  return tx<Cuenta[]>`SELECT id, codigo, nombre, tipo, nivel, de_detalle, activa FROM cuentas ORDER BY codigo`;
}
