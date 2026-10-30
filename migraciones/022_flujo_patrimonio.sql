-- Fase 7, parte 2 (30-oct-2026): estado de flujos de efectivo por el método indirecto (NIIF para PYMES, Sección 7) y estado
-- de cambios en el patrimonio (Sección 6). Cada cuenta de balance puede llevar su actividad del flujo; si no la tiene, se
-- sugiere por el código (efectivo 1101, inversión 12, financiamiento 2104/22/31, depreciación acumulada como partida que no
-- es efectivo, lo demás de operación).
ALTER TABLE cuentas ADD COLUMN actividad_flujo text
  CHECK (actividad_flujo IN ('efectivo', 'operacion', 'ajuste', 'inversion', 'financiamiento'));
GRANT UPDATE (actividad_flujo) ON cuentas TO contable_app;

-- Asientos de cierre del ejercicio (parte 3): llevan los resultados a patrimonio; el flujo y el resultado del período no
-- los cuentan.
ALTER TABLE asientos DROP CONSTRAINT asientos_origen_check;
ALTER TABLE asientos ADD CONSTRAINT asientos_origen_check
  CHECK (origen IN ('manual', 'factura', 'nota_credito', 'cobro', 'compra', 'nota_credito_compra', 'pago', 'banco', 'cierre'));
