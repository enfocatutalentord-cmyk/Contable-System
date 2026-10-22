# Requerimientos del sistema integral de contabilidad (entregado por Joannie, 22-oct-2026)

Documento rector del proyecto. Donde choque con lo construido antes, manda este documento.

## 1. Objetivo
Sistema profesional de contabilidad, administración fiscal y gestión financiera para **firmas contables que administran
múltiples empresas y clientes**, multiempresa, con información contable, financiera, tributaria y documental independiente
por cliente; principios contables aplicables y requerimientos tributarios configurables de República Dominicana.

## 2. Reglas generales
- Desarrollo **por fases**; cada fase se completa, prueba y aprueba antes de la siguiente.
- **No desarrollar módulos adicionales sin autorización. No modificar funcionalidades aprobadas sin autorización.**
- Todo se integra con lo existente.
- Debe tener: interfaz profesional y moderna; menú lateral; panel principal sencillo; varias empresas; usuarios y permisos;
  base de datos independiente a nivel lógico por empresa; historial de modificaciones; registro de operaciones; reportes
  descargables; **Excel y PDF**; búsquedas y filtros avanzados; validaciones; copias de seguridad y recuperación;
  protección de la información; fecha, hora y usuario responsable de cada operación.

## 3. Multiempresa
Una firma registra y administra clientes. Cada empresa: datos generales, RNC o cédula, **actividad económica, régimen
tributario**, catálogo, períodos fiscales, transacciones, CxC, CxP, bancos, reportes fiscales, estados financieros,
documentos, usuarios autorizados. Nunca mezclar información entre empresas.

## 4. Principios contables
Partida doble; débito = crédito; no contabilizar descuadres; catálogo jerárquico configurable; registros manuales y
automáticos; **control de duplicidades**; cada transacción conserva su documento de origen; nada contabilizado se elimina sin
trazabilidad; correcciones por procedimientos autorizados, incluida la **reversión de asientos**.

## 5. Contabilidad automática
Los módulos operativos generan asientos según configuración fiscal, naturaleza de la operación y cuentas asignadas.
Venta: Dr CxC / Cr ingresos / Cr ITBIS por pagar (si aplica). Compra: Dr gasto, inventario o activo / Dr ITBIS adelantado
(si aplica) / Cr CxP.

## 6. Reportes
Diario, mayor, balance de comprobación, **auxiliares**, estado de situación, estado de resultados, flujo de efectivo,
cambios en el patrimonio, antigüedad de CxC y **CxP**, impuestos, **bancarios**, comparativos, **auditoría**; con filtros
de empresa, período y otros.

## 7. Normativa tributaria (DGII)
ITBIS, retenciones, comprobantes fiscales, facturación electrónica cuando aplique, 606, 607, 608, 609, IT-1, ISR aplicables,
conciliaciones fiscales. **Cálculos y formatos configurables** y alineados con lo vigente. **No asumir que todo está gravado
con ITBIS ni que todas las empresas tienen las mismas obligaciones.**

## 8. Gestión documental
Adjuntos (facturas, recibos, comprobantes, estados bancarios, contratos, soportes) en **PDF, JPG y PNG**, vinculados a la transacción.

## 9. Control y seguridad
Permisos por funciones. Registrar: quién creó, fecha y hora, quién modificó, **cambios realizados**, **fecha de aprobación**,
**estado de la transacción**. Proteger períodos cerrados.

## 10. Metodología por fase
1. Presentar funcionalidades. 2. Desarrollar. 3. Mostrar pantallas. 4. Pruebas funcionales. 5. Verificar cálculos y
registros. 6. Identificar errores. 7. Corregir. 8. Solicitar aprobación. **No continuar sin autorización expresa.**

## 11. Resultado esperado
Plataforma contable profesional, escalable, segura y automatizada para que una firma administre múltiples clientes y
produzca información financiera y fiscal confiable.

**Instrucción final:** antes de desarrollar cualquier módulo, presentar la estructura técnica, las dependencias entre
módulos y el orden de implementación.
