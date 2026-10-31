-- IR-2 2026, parte 1 (31-oct-2026, «sí» de Joannie a la estructura): cada cuenta de detalle puede llevar su casilla del
-- anexo A-1 (balance) o B-1 (estado de resultados), como «A1:1.1» o «B1:6.1». Vacío = la sugerida por el código.
ALTER TABLE cuentas ADD COLUMN casilla_ir2 text CHECK (casilla_ir2 ~ '^(A1|B1):\d+(\.\d+)?$');
GRANT UPDATE (casilla_ir2) ON cuentas TO contable_app;
