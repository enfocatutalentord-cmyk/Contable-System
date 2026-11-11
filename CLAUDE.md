# Contable-System: estado del proyecto y forma de trabajo

Este archivo es el punto de partida para seguir el trabajo desde cualquier sesión o plataforma.
Actualízalo al terminar cada bloque de trabajo (qué se hizo, qué quedó pendiente, qué decidió Joannie).

Última actualización: 8-nov-2026 (bloque 6 completo en producción: lista de precios, levantamiento, estado inicial y diagnóstico; antes, entrega B · Normas y tasas; antes, rediseño completo en producción: R1–R6 y n.º 9); antes 4-nov-2026 (desde hoy aprueba **Patricia**; se trabaja con los documentos «Sistema Empire» en 8 bloques; bloque 1 en estructura; e-CF para después; respaldos sin activar).

## Con quién y cómo

- Se trabaja con **Joannie** (Enfoca Tu Talento). Responder siempre en **español**, con tono humano, claro y sin tecnicismos
  innecesarios. Explicar los pasos en el panel (Vercel, GitHub, midominio.do) uno por uno, con lo que hay que hacer clic.
- La cuenta de la app en producción la abrió **Manaury Enrique Gómez Guerrero**, con la empresa **Goemhy Services** (RNC 132151119).
- **Desde el 4-nov-2026 el «sí» de cada bloque lo da Patricia** (Patricia Paulino, CEO de Empire Tax’N Legal; la cuenta
  patriciapm2312@gmail.com), por decisión de esa fecha. Lo anterior lo aprobó Joannie.
- **Nunca pasar nada a `main` sin el «sí» de Patricia.** Se trabaja en la rama `claude/gallant-bell-4ejogr` y se pasa a `main`
  (fast-forward) solo cuando ella lo aprueba. `main` publica solo en producción.
- Todo lo que se proponga debe basarse en lo que hoy usan las plataformas líderes y mejor valoradas (G2, Capterra, casos
  publicados), citando la fuente. Referentes elegidos: **Xero** (G2 4.4, fechas de bloqueo, conciliación con reglas),
  **QuickBooks Online** (G2 4.0, centro de reportes, antigüedad de saldos, portal del contador) y **Alegra** (referente en RD,
  606/607/608 y e-CF).
- No inventar datos, montos ni resultados. Antes de decir que algo funciona, probarlo.

## Documento rector

**Desde el 4-nov-2026 mandan los documentos «Sistema Empire»** (subidos ese día; copias en `Downloads`):
`Sistema_Empire_Documento_Maestro_Fase1.pdf` (2-nov-2026, 22 págs.: Módulo 1 contabilidad de Empire con unidades de negocio,
cuenta de la socia y presupuesto, igualas y lista de precios EMP-P01; Módulo 2 ficha y expediente del cliente, formularios en
línea, biblioteca de documentos, bitácora y reporte mensual, alertas, WhatsApp, roles) y
`Sistema_Empire_Fase2_Aplicacion_e_Impuestos.pdf` (3-nov-2026, 7 págs.: aplicación del cliente, carga de facturas, solicitudes,
impuestos de clientes, inventario, trámites DGII). Análisis y orden en https://claude.ai/artifact/FQLM162XxtLcFmSURKeJD1:
1) ficha única y módulos, 2) igualas y facturación de Empire, 3) operación diaria (bitácora, cronograma, WhatsApp),
4) reporte mensual e impuestos de clientes, 5) expediente y biblioteca, 6) formularios en línea y diagnóstico,
7) presupuesto y cuenta de la socia, 8) aplicación del cliente; después e-CF, inventario, auditoría. La contabilidad propia de
Empire se lleva **como un cliente más** dentro de la firma (Empire Tax’N Legal SRL, RNC 133-09734-6), decidido el 4-nov.


**`docs/requerimientos-sistema.md`** (22-oct-2026) manda sobre todo lo anterior: sistema para **firmas contables** con
varios clientes, por fases con aprobación expresa, sin módulos ni cambios no autorizados. Antes de desarrollar se presenta
la estructura técnica, dependencias y orden (aprobada por Joannie el 22-oct-2026 con el orden de fases de abajo).

## Línea gráfica

Desde el 22-oct-2026 (pedido de Joannie) el sistema lleva la identidad de **Empire Tax’N Legal** según
`docs/Empire_Brandbook.pdf`: verde institucional `#003D19`, dorado `#B88A40`, marfil `#F6F3EC`; tipografía Source Sans 3
(la misma de la web de Empire). Logos maestros en `public/marca/` (copiados de `empire-web/public/assets`; `simbolo-inverso.svg`
es el símbolo con la columna en blanco para el fondo verde). Componentes en `app/marca.tsx`; colores en `app/globals.css`;
encabezados verdes con línea dorada en Excel y PDF (`lib/exportar.ts`). No redibujar ni recolorear el logo; mínimos: logo
220 px, símbolo 64 px. Las facturas impresas de los clientes no llevan la marca de Empire (son documentos del cliente).

## Qué es

Software contable para empresas en República Dominicana, **pensado para venderse** a otras empresas (decisión de Joannie,
21-oct-2026). Primera versión con: contabilidad base, facturación y CxC, compras/CxP/bancos e impuestos DGII.

## Dónde vive

| Qué | Dónde |
|---|---|
| Código | GitHub `enfocatutalentord-cmyk/Contable-System` (cuenta personal, no organización; privado) |
| Rama de trabajo | `claude/gallant-bell-4ejogr` |
| Publicación | Vercel, proyecto `contable-system` (cuenta Hobby de enfocatutalentord) → https://contable-system.vercel.app |
| Base de datos | Neon (Postgres) conectada desde Vercel → Storage. Variable `DATABASE_URL` (se creó con el prefijo `DATABASE`). Vistas previas con rama de base propia. |
| Migraciones | `migraciones/*.sql`, se aplican solas en cada publicación de **producción** (`npm run vercel-build`). Las vistas previas no las aplican. |

Notas de infraestructura que costaron tiempo:
- El proyecto de Vercel se importó cuando el repo solo tenía el README y quedó como «Other». Por eso existe `vercel.json`
  con `"framework": "nextjs"` y `buildCommand: npm run vercel-build`. No quitarlo.
- Desde las sesiones en la nube de Claude no se llega a Vercel ni a sitios externos (la red lo bloquea): Joannie hace
  los pasos en Vercel y manda capturas.
- La app de Claude en GitHub no puede crear repositorios; Joannie los crea y les da acceso en
  https://github.com/apps/claude/installations/select_target.

## Arquitectura

- Next.js 16 (App Router, server actions) + TypeScript + Postgres con la librería `postgres`.
- **Aislamiento por empresa en la base (Row Level Security).** Toda operación contable pasa por `conEmpresa(empresaId, fn)`
  (`lib/db.ts`), que fija `app.empresa_id` y hace `SET LOCAL ROLE contable_app`. Ese rol no tiene BYPASSRLS (el dueño en Neon
  sí lo tiene; por eso existe el rol). `db()` a secas solo para lo que no es de una empresa (registro, sesiones, «mis empresas»).
- **Reglas contables en la base** (`migraciones/001_base.sql`): el asiento cuadra y tiene 2+ líneas (trigger diferido),
  solo cuentas de detalle activas de la misma empresa, nada se crea/cambia/anula en período cerrado (`empresas.fecha_bloqueo`,
  como las «lock dates» de Xero), los asientos no se borran (se anulan).
- Montos como texto `numeric(18,2)` y sumas en centavos con `bigint` (`lib/montos.ts`, `lib/calculos.ts`). Nunca floats.
- Asientos automáticos: `lib/asientos.ts` (`insertarAsiento`). Los asientos con `origen` distinto de `manual` solo se anulan
  anulando su documento.
- Sesiones: cookie httpOnly con token cuyo hash se guarda en `sesiones`; contraseñas con scrypt (`lib/auth.ts`).
- **Acceso por correo** (`migraciones/008_acceso_por_correo.sql`, `lib/enlaces.ts`, `lib/correo.ts`): ya no se muestran
  contraseñas temporales. Al agregar a alguien nuevo (Equipo o Usuarios del cliente) se le envía por Gmail un enlace de un
  solo uso (`enlaces_acceso`, token con hash, 72 h) que verifica el correo (`usuarios.correo_verificado`) y le pide crear su
  contraseña antes de entrar (`/acceso/[token]`). «¿Olvidaste tu contraseña?» (`/recuperar`, 1 h, máx. 3 por hora, misma
  respuesta exista o no la cuenta) y «Reenviar invitación / Enviar enlace para nueva contraseña» en Equipo. Mirar la página
  no gasta el enlace; un enlace nuevo anula los anteriores. Sin `GMAIL_CLAVE_APP` en Vercel el correo no sale y quien da el
  acceso ve el enlace para pasarlo a mano. Recorrido: `pruebas/navegador/acceso.cjs`.
- **Marco único** (28-oct-2026, pedido de Joannie: «está dividido, no se entiende»): `app/marco.tsx` con el mismo menú
  en toda la firma (`app/e/[id]/menu.tsx`, pestañas en `lib/pestanas.ts`) y arriba el selector «Viendo: Todos los clientes /
  un cliente» (`app/selector-cliente.tsx`, cambia de cliente quedándose en la pestaña). Con «Todos» se ven las pantallas de la
  firma (`app/firma/[fid]/…`): **Inicio de la firma** (cifras, clientes con responsable y pendientes, actividad), **Actividad**
  (frases a partir de `auditoria`, `lib/firma.ts`), **Clientes de la firma** (responsable `empresas.responsable_id`,
  migración 009; nombre y RNC de la firma), Personas y accesos, Roles y permisos; una pestaña de cliente pide elegirlo
  (`/firma/[fid]/elegir`). `/empresas` redirige a la firma si hay una sola. Recorrido: `pruebas/navegador/firma.cjs`.
- **Roles con pestañas** (29-oct-2026, migración 010): cada rol (`perfiles`) guarda `pestanas` (rutas de `lib/pestanas.ts`;
  NULL = todas) y `para_clientes`. El menú muestra solo las del rol y `accesoEmpresa` lo revisa en el servidor con la
  dirección que pasa `proxy.ts` (encabezado `x-ruta`; también las descargas `/exportar/<reporte>`); si no la ve, lleva a la
  primera que sí con «sin_pestana». Roles base nuevos: «Cliente · Consulta» y «Cliente · Sube documentos». Quien solo tiene
  roles para clientes no ve las pantallas de la firma ni «Todos los clientes» (`soloCliente`). «Roles y permisos» tiene la
  matriz pestaña × rol y casillas por rol; «Personas y accesos» separa equipo y usuarios de clientes y permite elegir cliente
  y rol al agregar. Recorrido: `pruebas/navegador/roles.cjs`.
  Roles base definidos (migración 011, «sí» de Joannie del 29-oct): Administrador (todo), Contador (aprueba, corrige, cierra,
  configura; sin reabrir ni accesos ni Usuarios), Auxiliar (prepara borradores; sin emitir, contabilizar, anular, cerrar,
  impuestos ni configuración), **Facturación** (facturas, cobros, clientes, productos, CxC), Solo lectura (todo + historial),
  Cliente · Consulta, Cliente · Sube documentos (solo resumen hasta la parte 3). Cada server action exige además su pestaña
  (`exigirPermiso(id, permiso, pestana)`), y registrar cobros exige «contabilizar». Menú reordenado: Firma (Inicio,
  Actividad) → Ventas, Compras, Contabilidad → Reportes → Impuestos → Configuración del cliente → Administración de la firma;
  el estado de cuenta se abre desde Cuentas por cobrar/pagar.
- **Documentos recibidos** (parte 3, migración 012): tabla `recepciones` (bandeja por empresa, RLS, auditada; PDF/JPG/PNG
  ≤ 4 MB, sin repetir el mismo archivo; categoría, nota, estado nuevo/en proceso/procesado/descartado, respuesta, compra).
  Pestaña `/recepcion` («Documentos del cliente»; para usuarios de clientes «Mis documentos»): subir varios archivos desde el
  celular (permiso «adjuntar») y procesar (permiso «registrar»): «Registrar compra con este documento» abre
  `/compras/nueva?recepcion=` y al guardar el archivo pasa a soporte de la compra y el documento a Procesado
  (`guardarCompraConDocumento`). Aviso por correo al responsable del cliente. Firma: «Documentos recibidos»
  (`/firma/[fid]/documentos`, todos los clientes), cifra «Documentos por procesar» en el Inicio y frases en Actividad.
  Recorrido: `pruebas/navegador/documentos.cjs`.
- **Excel/PDF en todas las listas** (29-oct-2026): facturas, cobros, compras, pagos y catálogo se descargan con los mismos
  filtros de la pantalla (`lib/listas.ts` tiene las consultas que usan la lista y la descarga; botones `app/descargar.tsx`;
  reportes en `app/e/[id]/exportar/[reporte]/route.ts`, mapeados a su pestaña en `REPORTES` de `lib/pestanas.ts`).
  Facturas y compras llevan subtotal, ITBIS y otros impuestos por separado; totales en centavos de lo vigente en DOP.
- **Verificación en dos pasos** (29-oct-2026, migración 013, `lib/dos-pasos.ts`, `lib/cuenta-dos-pasos.ts`): código TOTP
  (RFC 6238) de Google/Microsoft Authenticator o Authy, como exige Xero; guía OWASP MFA y NIST SP 800-63B. Se configura en
  Mi cuenta con QR (paquete `qrcode`) y da 10 códigos de recuperación de un solo uso (hash). Al entrar, la contraseña correcta
  solo da un paso pendiente de 10 min (`entradas_pendientes`, cookie en /entrar) y 5 códigos errados lo anulan; el mismo
  código no sirve dos veces (`dos_pasos_ultimo`). Recuperar la contraseña por correo no se la salta. Desactivar pide
  contraseña y código. La firma puede exigirla (`firmas.exigir_dos_pasos`, en Clientes de la firma › Datos de la firma;
  quien no la tiene va a /cuenta antes de ver nada). Un administrador la quita a quien perdió el celular (Personas y accesos;
  cierra sus sesiones). Cada cambio avisa por correo. Recorrido: `pruebas/navegador/dos-pasos.cjs`.
- **Reportes DGII 606/607/608** (Fase 6 parte 1, 29-oct-2026, migración 014, `lib/formatos-dgii.ts`, pestaña `/dgii` en
  Impuestos; la ven Administrador, Contador y Solo lectura): campos, orden, códigos y límites de los instructivos oficiales que
  Joannie subió (606 feb-2026, 607 dic-2025, 608 mar-2026). 606: compras registradas
  del mes (servicios/bienes por línea, ITBIS al costo, ISC/propina/otros por tipo de impuesto, fecha y forma del último pago,
  retenciones del pago repartidas por lo aplicado) y **reenvío** con fecha original de compras de meses anteriores pagadas con
  retención en el mes; B17 con el RNC de la empresa. 607: facturas emitidas no anuladas (sin e-CF), `facturas.tipo_ingreso`
  (01–06, habitual en `clientes.tipo_ingreso`), formas de cobro hasta el cierre y el resto «venta a crédito»; B02 menores de
  RD$250,000 (Norma 10-18) van al «Resumen General de Facturas de Consumo». 608: facturas y comprobantes propios de compras
  (B11/B13/B17, `compras.motivo_608`) anulados en el mes. Revisión con errores (enlace para corregir) y avisos; Excel/PDF
  `DGII_F_6xx_<RNC>_<AAAAMM>` con las columnas del instructivo; «Marcar como enviado» (permiso «impuestos», sin errores) en
  `envios_dgii` con referencia y huella: si cambia algo del mes avisa «Cambió después del envío». Pruebas
  `pruebas/formatos-dgii.test.mjs`; recorrido `pruebas/navegador/dgii.cjs` (con `node --experimental-strip-types`).
  Falta confirmar con la contadora: notas de crédito B04 en «Venta a Crédito», reenvío del 607 por retenciones, umbral de 250,000 sobre
  el total con impuestos.
- **TXT de la DGII** (29-oct-2026): `aTxt` en `lib/formatos-dgii.ts` copia la macro «Generar Archivo» de las herramientas
  oficiales que subió Joannie (606 v2025, 607 v2023.1.1, 608 v2018.2.1; leídas sin ejecutar): encabezado `606|RNC|AAAAMM|n`,
  campos con «|», CRLF y sin salto final; códigos de dos dígitos salvo el tipo de ingreso del 607 (un dígito); montos sin
  ceros de más; opcionales en cero vacíos; B13 y B17 con el RNC de la empresa. Botón «Archivo TXT» solo sin errores.
- **IT-1** (Fase 6 parte 2, 29-oct-2026, migración 015, `lib/it1.ts`, pantalla `/dgii/it1`): formulario IT-1 2020 y Anexo A
  con las casillas, nombres y fórmulas del Excel oficial y su instructivo. Sugiere desde lo registrado (ventas por NCF, forma
  de venta y tipo de ingreso; gravado por tasa y exento; retenciones sufridas, B15 → 31 y demás → 29; ITBIS de compras de
  bienes/servicios deducible o al costo; retenciones hechas: B11 → 47/39, 30 % → 43, 100 % → 39/42; notas de crédito de más
  de 30 días → casillas 9 y 43); lo demás se escribe y se guarda en `declaraciones.manuales` (antes `declaraciones_itbis`, migrada en la 016). Valida como la Oficina
  Virtual (11 a 15 = 10; 56 ≤ ITBIS por adelantar del 606; 60 ≥ retenido del 606; coeficiente 54). «Marcar como presentado»
  guarda las casillas en `envios_dgii.casillas`; la 34 pasa a la 29 del mes siguiente. Excel/PDF `IT-1_<RNC>_<AAAAMM>`.
- **IR-17** (Fase 6 parte 3, 30-oct-2026, migración 016, `lib/ir17.ts`, pantalla `/dgii/ir17`): formulario oficial «IR-17-2026,
  desde julio 2026 en adelante» (subido por Joannie; sin instructivo): 24 conceptos con su código y tasa de la Ley 30-26
  (`CONCEPTOS_IR17` en `lib/fiscal.ts`: alquileres 15 %, honorarios 15 %, otras rentas 15 %, etc.), 25–37 con sus fórmulas y
  anexo IR-6 por beneficiario desde los pagos con retención de ISR (sujeto = retenido ÷ tasa). Cada retención de ISR tiene
  `retenciones.codigo_ir17` (se llena solo desde el 606 cuando no hay duda: 1→1, 2→2, 7→12, 8→13, 9→21; trigger
  `retenciones_ir17`); sin concepto, error. Los borradores de IT-1 e IR-17 están en la tabla común `declaraciones`
  (formulario, período, manuales); `lib/declaraciones.ts` define ambos formularios y la pantalla común es
  `app/e/[id]/dgii/declaracion.tsx`. Excel/PDF `IR-17_<RNC>_<AAAAMM>` e `IR-6_<RNC>_<AAAAMM>`.
- **Bancos** (Fase 5, «sí» de Joannie a la estructura el 30-oct-2026, en 3 partes; referentes Xero «Import a Statement» y
  QuickBooks «Upload from file»; sin conexión directa con los bancos). **Parte 1** (migración 018, `lib/archivos-banco.ts`,
  `lib/bancos.ts`, pestaña `/bancos` en Contabilidad; la ven Administrador, Contador, Auxiliar y Solo lectura): `cuentas_bancarias`
  ligadas a una cuenta de activo de detalle del catálogo, con saldo inicial del banco y fecha desde la que se concilia (lo anterior
  no se importa). Importar Excel (.xlsx), CSV u OFX (tipo por contenido; .xls y PDF se rechazan con indicación): el archivo queda
  en `importaciones_banco` (borrador → importada/deshecha/descartada) con vista previa; se adivinan encabezado y columnas
  (débito/crédito o monto con signo, saldo, orden de la fecha) y el formato queda guardado en la cuenta. `movimientos_banco`
  (monto > 0 entra, < 0 sale) con huella fecha+monto+descripción+referencia y número de ocurrencia: un archivo encima de otro
  no repite nada. Avisa si el saldo del banco no cuadra fila a fila. Deshacer una importación (sin conciliados, fuera de período
  cerrado). Los estados bancarios de «Documentos del cliente» aceptan Excel/CSV/OFX y se importan desde ahí («Importar a Bancos»;
  el documento pasa a Procesado). Permisos: alta de cuentas «catálogo»; importar/deshacer «registrar». Pruebas
  `pruebas/bancos-archivos.test.mjs` y `pruebas/bancos.test.mjs`; recorrido `pruebas/navegador/bancos.cjs`. **Parte 2**
  (migración 019, `lib/conciliacion.ts`): cada movimiento se concilia con líneas de asiento de la cuenta contable del banco
  (`conciliaciones_banco`, monto en la moneda de la cuenta, una línea una sola vez; en cuenta USD solo cobros/pagos en USD).
  Sugerencias (`sugerir`): mismo monto (la referencia manda, luego la fecha más cercana), sin repetir líneas, combinaciones de 2
  a 4 registros que suman el monto (±10 días) y, si no hay nada, la primera regla. Nada se concilia solo: «Confirmar» (permiso
  «contabilizar»). Pantalla por movimiento (`/bancos/[cid]/m/[mid]`): buscar y combinar con suma en vivo, registrar el cobro o
  pago desde el movimiento (formularios con fecha, cuenta y referencia prellenadas; si el monto coincide queda conciliado,
  `lib/conciliar-documento.ts`), registrar contra otra cuenta (asiento `origen = 'banco'`; comisiones, impuestos, transferencias
  entre cuentas propias; tasa en USD) o excluir con motivo. Desconciliar (permiso «revertir») anula el asiento hecho desde el
  banco. Un asiento conciliado no se anula (trigger `asiento_conciliado`); nada se concilia ni desconcilia en período cerrado.
  Reglas (`reglas_banco`, `/bancos/reglas`, permiso «catálogo»): textos separados por coma, dirección, rango de monto, cuenta y
  concepto; «Agregar reglas sugeridas»: comisiones (620101) e impuesto a cheques y transferencias (620104; 0.20 % desde el
  3-jul-2026, Ley 30-26; en el catálogo nuevo la 620104 ya no dice «0.15 %»). Pruebas `pruebas/conciliacion.test.mjs`;
  recorrido `pruebas/navegador/conciliacion.cjs` (con `--experimental-strip-types`, datos en `datos-conciliacion.mjs`).
  **Parte 3** (migración 020, `lib/reporte-conciliacion.ts`, `/bancos/[cid]/conciliacion?mes=AAAAMM`): reporte con la forma de
  QuickBooks/Xero: saldo del banco al cierre (+ depósitos y − pagos en libros aún no en el banco = banco ajustado) contra saldo en
  libros (± lo del banco que libros no tiene al cierre: por conciliar, excluidos o registrados después; ± diferencia de apertura
  entre libros y el saldo inicial del banco) = libros ajustado; diferencia en verde si es 0. Una línea conciliada con un movimiento
  posterior al cierre sigue en tránsito. Excel/PDF (`/exportar/conciliacion-banco?cuenta=&mes=`). «Cerrar la conciliación» (permiso
  «cerrar»; sin pendientes hasta el cierre, diferencia 0, cuenta en DOP) guarda saldos, resumen y huella en `cierres_conciliacion`;
  si algo cambia avisa «Cambió después del cierre»; «Quitar el cierre» pide «reabrir». No bloquea asientos (eso es el cierre del
  mes). Inicio de la firma: cifra y pendiente «movimientos del banco por conciliar». Pruebas `pruebas/reporte-conciliacion.test.mjs`
  (y el recorrido `conciliacion.cjs` llega hasta el cierre). Vercel ya está en plan **Pro** (captura del 30-oct). **Pendiente:** Joannie aún no tiene estados de cuenta reales de los bancos de los
  clientes (30-oct); cuando los mande, probar que cada formato se lea bien (hasta ahora solo con archivos de ejemplo).
- **Estados financieros** (Fase 7, «sí» de Joannie el 30-oct-2026 a la estructura en 3 partes, al flujo por método indirecto y a
  la línea de firmas; NIIF para PYMES adoptada por el ICPARD). **Parte 1** (migración 021, `lib/estados.ts`, `lib/estados-pantalla.ts`,
  pestaña `/estados` en Reportes; la ven Administrador, Contador, Auxiliar y Solo lectura): estado de resultados (ingresos
  operacionales 41, costo 5, utilidad bruta, gastos operacionales 61, utilidad en operaciones, otros ingresos 4x, gastos financieros
  62, otros gastos, utilidad antes de ISR, ISR 63, utilidad neta; % de ingresos con una columna) y estado de situación financiera
  (activos corrientes 11 / no corrientes, pasivos corrientes 21 / no corrientes, patrimonio + «resultados de ejercicios anteriores
  sin cerrar» + «resultado del ejercicio en curso» según `empresas.mes_cierre`; avisa si no cuadra). Comparar: período anterior,
  mismo período del año pasado o mes por mes (hasta 12 + total); variación en monto y % con dos columnas; detalle por cuenta o
  por subgrupo de 4 dígitos; cada cuenta abre su libro mayor. Excel/PDF (`/exportar/estado-financiero`) con filas en negrita y
  firmas «Preparado por» (contador, N.º ICPARD) y «Aprobado por» (cargo) de `empresas.firma_*` (permiso «empresa»; `Tabla.firmas`
  y `Tabla.negritas` en `lib/exportar.ts`). Pruebas `pruebas/estados.test.mjs`; recorrido `pruebas/navegador/estados.cjs` (con
  `--experimental-strip-types`, datos en `datos-estados.mjs`). **Parte 2** (migración 022, `lib/estados-flujo.ts`; mismas pestaña y
  descarga): estado de flujos de efectivo por el método indirecto (utilidad neta + partidas que no son efectivo + cambios en capital
  de trabajo; inversión; financiamiento; efectivo inicial y final, avisa si no coincide con las cuentas de efectivo) con los mismos
  comparativos; `cuentas.actividad_flujo` (efectivo, operación, «no es efectivo», inversión, financiamiento; vacío = sugerida por
  `actividadSugerida`: 1101 efectivo, depreciación/amortización acumulada no es efectivo, 12 inversión, 2104/22/3 financiamiento, lo
  demás operación), se cambia en Catálogo › Editar y se ve en una columna. Estado de cambios en el patrimonio: columnas por subgrupo
  del patrimonio + «Resultados sin cerrar» + total; filas saldo inicial, resultado del período, traspaso por cierre, otros
  movimientos y saldo final (= total patrimonio del balance). Los asientos `origen = 'cierre'` (nuevo en la 022) no cuentan como
  movimientos del período. **Parte 3** (migración 023, `lib/cierre-ejercicio.ts`, en `/cierres`): «Cierre del ejercicio» por año
  fiscal (`empresas.mes_cierre`; `finEjercicio`): asiento propuesto que deja ingresos, costos y gastos en cero contra «Resultado del
  ejercicio» (310302 por defecto, elegible), `origen = 'cierre'`, fecha = fin del ejercicio; exige año terminado, sin borradores y
  sin bloqueo en esa fecha; deja `fecha_bloqueo` = fin. «Pasar a resultados acumulados» (310301) con fecha del día siguiente.
  `cierres_ejercicio` guarda asientos, resultado y bloqueo anterior; «Deshacer el cierre» (permiso «reabrir») los anula y devuelve
  el bloqueo. El estado de resultados no cuenta los asientos de cierre (`saldosPorCuenta(..., sinCierre)`). **Centro de reportes**
  (`/reportes`, pestaña nueva para todos los roles con reportes): tarjetas por grupo con los reportes que el rol puede ver.
  Siguiente: IR-2. **Propuesta aprobada el 31-oct-2026**: parte 1 anexos A-1, B-1 y J desde la contabilidad
  (cada cuenta a su casilla, sugerida por código y editable); parte 2 anexos G y E y liquidación 12–33 (saldo a favor del IR-2
  anterior presentado); parte 3 anexo D, impuesto a los activos y H-1/H-2. Solo sector manufactura/comercio/agropecuaria/hoteles
  (A-1/B-1). El 31-oct Joannie volvió a subir el mismo formulario (no hay instructivo; tampoco en la carpeta de Drive). Del
  formulario: casilla 12 «27 % o 30 %», activos 1 % de los activos imponibles con crédito del ISR liquidado (casilla 12),
  recargo 10 % el primer mes + 4 % por mes. **Fórmulas del Excel oficial** (convertido con LibreOffice a xlsx y leídas con
  openpyxl, sin macros): casilla 12 = `SI(11>0; 11 × SI(A ≥ 1,000,000,000; 30 %; 27 %))`; A-1 total activos = 1+2+3+4−5, total
  pasivos y patrimonio = 7+8+9+10; B-1 casilla 1 = 1.1+1.2−1.3−1.4+1.5, 4 = 1+2+3, 5 (costo) viene del anexo D, 14 = 4−(5 a 13),
  15 = 5..13+14; activos: 1 % de los activos imponibles menos el ISR liquidado (casilla 12); nuevo saldo a favor solo si > 200.
  «sí» de Joannie a la estructura del IR-2 el 31-oct (sector 1: manufactura/comercio/agropecuaria). El PDF que subió ese día es el
  folleto «Agentes de Retención» (2023/2025, anterior a la Ley 30-26), no la Guía 10.
  **IR-2 parte 1** (migración 024, `lib/ir2.ts`, pantalla `/dgii/ir2?ejercicio=&anexo=a1|b1|j`, tarjeta en Reportes DGII): casillas
  y textos del A-1 y B-1 copiados del formulario; `cuentas.casilla_ir2` («A1:1.1», «B1:6.1»; vacío = `casillaSugerida` por código y
  nombre: categorías de depreciación del art. 287, ISR 63 fuera del B-1), se cambia en Catálogo › Editar y se ve en una columna.
  A-1 al fin del ejercicio (provisiones en positivo que se restan; resultados sin cerrar a 10.4/10.5); B-1 del ejercicio sin
  asientos de cierre (devoluciones/descuentos en positivo que se restan; costo 5 desde las cuentas de costo hasta la parte 3); cuentas
  con saldo sin casilla y A-1 que no cuadra se avisan; detalle por casilla con enlace a la cuenta. Anexo J desde facturas emitidas
  (1.x) y compras registradas (2.x) no anuladas, monto sin impuestos en pesos; B16/B02/B17 de compras sin casilla se avisan.
  Excel/PDF `IR-2_A1|B1|J_<RNC>_<año>`. Pruebas `pruebas/ir2.test.mjs`; recorrido `pruebas/navegador/ir2.cjs` (datos de estados y dgii).
  En `main` el 31-oct («sí» de Joannie).
  **IR-2 parte 2** (migración 025, `lib/ir2-liquidacion.ts`, pestaña «Liquidación · anexos G y E» en `/dgii/ir2?anexo=liq`): usa la
  pantalla común de declaraciones (`Declaracion` con `incrustada`; formulario «IR-2» en `FORMULARIOS` con `anual`: vence a los 120
  días del cierre, art. 299 CT) y guarda en `declaraciones` con período = mes de cierre del ejercicio (AAAAMM). Anexo G a mano
  (1.1–1.17, 2.1–2.4 y distribución 3.1–3.13; error si los totales no coinciden, como el Excel). Anexo E: 5 filas de pérdidas con
  las fórmulas del Excel (d = b × c %, e = b + d, g = e ÷ f, h = casilla 7, j = h × i, k = menor de g y j, l = e − g; con renta
  negativa el límite es 0); % por antigüedad sugerido (art. 287 k: 100 % años 1–3, 80 % el 4.º, 70 % el 5.º) y períodos = 6 − edad;
  B y C a mano; D desde el B-1 (15 = 4, 17 = 3.1, 18 = 2.3). Liquidación A, B, 1–33 con las fórmulas oficiales; casilla 14 sugerida
  desde el ISR retenido en cobros del ejercicio; el % de recargo (25) viene lleno con el de hoy si ya venció (10 % + 4 % por mes o
  fracción; pedido del 4-nov) y, una vez presentado, queda el que se presentó; el % de interés (29) a mano. Al marcarlo presentado, el ejercicio siguiente toma la casilla 33 como 22 y las pérdidas pendientes (l) con un período
  menos (y la pérdida fiscal si la casilla 9 fue negativa). Excel/PDF `IR-2_liquidacion_<RNC>_<año>` (`/exportar/ir2?periodo=`).
  Pruebas `pruebas/ir2-liquidacion.test.mjs`; el recorrido `ir2.cjs` llega hasta presentar y ver el arrastre. En `main` el
  4-nov-2026 («sí» de Joannie, junto con el recargo prellenado).
  **IR-2 parte 3** (propuesta en el documento «Propuesta IR-2 parte 3», https://claude.ai/artifact/VMgxG1U6Q6kajXDyz71wtL, hecha con el
  Excel oficial `IR-2, Vers. 2026.xls` de `Downloads/IR-2-2026.zip`, convertido con Excel y macros apagadas). Respuestas del
  4-nov-2026: compras 35/36 solo de líneas de bienes a cuentas de inventario o costo; si el costo del anexo D no coincide con las
  cuentas de costo manda el anexo D con aviso; el índice de inflación del D-2 lo escribe la contadora; orden: 1) costo de venta e
  impuesto a los activos, 2) depreciación fiscal D/D-1/D-2, 3) H-1 y H-2. **Entrega 1** (sin migración; `comprasDeBienes`,
  `b1ConCostoD` e `inventarioDe` en `lib/ir2.ts`, hojas «D» y «X» en `SECCIONES_IR2`): anexo D I–II (datos informativos 1–8), IV
  (34 y 38 = inventarios 1.5–1.8 del A-1 al cierre anterior y al actual; 35 locales y 36 exterior/B17 sin impuestos en pesos, notas
  B04/E34 restan; 37 ITBIS al costo; 39 = 34+35+36+37−38; «Dtipo» 1/2/3 con aviso si falta) y V manufactura (49, 52; si hay algo
  escrito ahí manda la 52; corregido en la entrega 2: es 39 + 52, como la casilla 5 del B-1 del Excel). `DCV` = costo del anexo D → casilla 5 del B-1 (`anexoB1ConCostoD` en `lib/declaraciones.ts`, pantalla y
  descarga del B-1) y casilla 1 de la liquidación. Impuesto a los activos (sector 1): 1 = A-1 6; 2–5 = A-1 2.2, 2.6, 3.2, 4.2; 6 a
  mano; 8 = A-1 5.2; 9 = 1−7+8; 38 = 34−35−36−37; 39 = 1 %; 40 = casilla 12; 41, 44, 45 como el Excel. Todo en la pestaña
  «Liquidación · anexos D, G, E y activos» y en el Excel/PDF de la liquidación. Pruebas `pruebas/ir2-anexo-d.test.mjs` (en
  `ir2-liquidacion.test.mjs` el costo de 2026 va como D35). En `main` el 4-nov-2026 («sí» de Joannie).
  **Entrega 2** (sin migración; `lib/ir2-depreciacion.ts`, hojas «D1» y «D2»): anexo D sección III (9–33; claves «D9b» categoría 2 y
  «D9c» categoría 3; uso propio 25 % y 15 %, arrendamiento y Ley 392-07 50 % y 30 %; 10 = distribución 39/40 del D-2; 18 sugerida de
  la 41/42; 15, 23 y 31 sugeridas = 11, 19 y 27; balances iniciales 9/17/25 = 16/24/32 del IR-2 anterior presentado). D-1 («U1»…:
  1 = casilla 38 del D-2 (= 15), 2 = su distribución, 6 sugerida al 5 % (art. 287), detalle de 10 adquisiciones, 10 mejoras y 10
  retiros con fecha AAAAMMDD, valor, base, proporción y depreciación; totales T65/W65 del Excel = «UTd»/«UTc»). D-2 («T1»…: 26 =
  1+2−3…−14+15…+22−23−24+25, 31 = 27−28−29−30, 32 = 26−31, 33 = 49, 34 = menor de 32 y 33, 35 = 34 × % escrito «T35p»; 37 inventario a
  mano, 38–48 vienen de 15, 16, 18, 19, 20, 21, 24, 8, 17, 22, 25; % = monto ÷ 49 y el reparto del ajuste sin perder centavos, que
  el Excel deja en blanco). Sugeridas desde el A-1 al inicio: 1 (6), 3 (4.2), 5 (2.5+2.6), 6 (3.2), 7 (2.1+2.2−5.1−5.2), 10
  (2.3−5.3), 11 (2.4−5.4), 27 (7+8+9), 37 (1.5–1.8); y del IR-2 anterior: 15 (D-1 UTc), 16/18 (D 16), 19/20 (D 24). El anexo G 2.2
  se sugiere = casilla 37 del D-2 (fórmula del Excel). Con inventarios 1.6/1.7 en el A-1 la empresa es de manufactura: inventarios
  a 40/41/50 y 47/48/51 y compras a 42/43; aviso si el inventario final del anexo D (38+47+48+51) no coincide con el A-1 (el Excel
  lleva al A-1 la 38+51 a 1.5, la 47 a 1.6 y la 48 a 1.7). Pruebas `pruebas/ir2-depreciacion.test.mjs` y el arrastre en
  `pruebas/ir2-anexo-d.test.mjs`. En `main` el 4-nov-2026 («sí» de Joannie).
  **Entrega 3** (migración 026, `lib/ir2-sociedad.ts`, pestaña «Anexos H-1 y H-2 · Beneficiario final» en `/dgii/ir2?anexo=h`,
  `app/e/[id]/dgii/ir2/anexos-h.tsx`, acción `guardarSociedad`, permiso «impuestos»): no son montos sino datos de la sociedad, una
  fila por empresa en `sociedad_ir2` (jsonb `datos`, RLS, auditada) que sirve para todos los años. Secciones y límites del Excel:
  H-1 A contacto y dirección; B accionistas (15: identificación, nombre, domicilio, % y cargo en el consejo); C beneficiarios por
  control accionario (30, personas físicas con 20 % o más); H-2 D por control efectivo (15); E actividades (5); F sucursales (10);
  «Actualización de datos sin cambios» (n.º y fecha de la declaración que se reitera). En C y D el Excel titula la participación con
  «$» pero sus instrucciones hablan de %: aquí es %. Sin nada guardado, el contacto y la actividad vienen de la ficha del cliente.
  Cada tabla muestra lo guardado + 3 filas vacías. Revisión: filas sin identificación o nombre (error), participaciones de B que no
  suman 100 %, persona física (identificación que no es RNC de 9 dígitos) con 20 % o más que no está en C, C con menos de 20 %,
  falta de contacto o de actividad (avisos); con «sin cambios» solo pide la fecha. Excel/PDF `IR-2_H_<RNC>_<año>` (`/exportar/ir2-h`).
  Pruebas `pruebas/ir2-sociedad.test.mjs`. En `main` el 4-nov-2026 («sí» de Joannie). **IR-2 completo.**
- **Firmas** (`migraciones/003_plataforma.sql`): una firma contable (`firmas`) tiene clientes (`empresas.firma_id`), equipo
  (`miembros_firma`, con marca de administrador) y **perfiles** con permisos configurables (`perfiles.permisos`: ver, registrar,
  contabilizar, revertir, catálogo, cerrar, reabrir, adjuntar, exportar, auditoría, empresa, usuarios; `lib/permisos.ts`).
  Cada persona tiene un perfil por empresa (`miembros.perfil_id`). El administrador de la firma tiene todo en todas.
  `conEmpresa` también fija `app.usuario_id` para la auditoría; `conUsuario` para lo de la firma.
- **Estados del asiento:** borrador (editable, puede no cuadrar, sin número) → contabilizado (numerado, inmutable) ;
  «anulado» solo para asientos de documentos. Lo contabilizado se corrige con **reversión** (`revierte_a`), como Xero/QBO.
  Si la empresa tiene `requiere_aprobacion`, quien registra no contabiliza su propio asiento.
- **Auditoría:** trigger `auditar()` (SECURITY DEFINER) guarda en `auditoria` cada cambio con antes/después y usuario.
  Pantalla «Historial de cambios» e historial por asiento (`lib/auditoria.ts`).
- **Documentos de soporte:** tabla `documentos` (bytea, PDF/JPG/PNG ≤ 4 MB, tipo comprobado por contenido, retiro lógico).
- **Exportación:** Excel real (.xlsx, exceljs) y PDF (pdfmake con fuentes estándar) en `lib/exportar.ts`; CSV se mantiene.
- **Ventas y CxC** (`lib/ventas.ts`, `migraciones/005_ventas_fiscal.sql`): toda factura o nota de crédito nace como
  **borrador** (sin NCF ni asiento, editable, se puede descartar) y al **emitirse** toma el NCF y registra su asiento
  (como Draft → Approved de Xero). Emitir exige el permiso «contabilizar» y, con aprobación obligatoria, que no sea quien
  registró. Lo emitido no se modifica ni se borra (triggers `facturas_proteger` y `lineas_factura_proteger`): se anula o se
  corrige con nota de crédito (permiso «revertir»; usa la tasa de la factura original). Cada línea lleva sus impuestos en
  `impuestos_linea_factura` (ITBIS o exento + un cargo adicional como propina o selectivo), con la tasa aplicada. Las cuentas
  de impuestos salen de `impuestos.cuenta_ventas_id`; las retenciones del cobro, de `retenciones` (tabla `retenciones_cobro`,
  cuenta `cuenta_por_terceros_id`). Clientes con tipo de identificación, comprobante habitual y retenciones habituales.
  Tipos de venta: B01, B02, B14, B15, B16 y B04 (los e-CF llegan con la fase fiscal). Ya no hay módulo apagado.
- **Compras y CxP** (`lib/compras.ts`, `lib/cxp.ts`, `migraciones/006_compras.sql`): mismo esquema borrador → registrada.
  Comprobante del proveedor (B01, B02, B14, B15, E31, E32, E44, E45; notas B04/E34) o propio con nuestro rango (B11 compras a
  informales con cédula, B13 gastos menores, B17 pagos al exterior). **Control de duplicados:** índice único
  (empresa, proveedor, NCF) entre las no anuladas. Asiento: gasto/costo/activo (+ impuestos sin crédito) e ITBIS pagado
  (`impuestos.cuenta_compras_id`) contra CxP (`cxp` o `cxp_exterior`). B02/E32/B13, «ITBIS al costo» o empresa no
  contribuyente → el ITBIS va al gasto. Cada compra guarda el tipo de gasto del 606 (01–11) y cada línea si es bien o servicio;
  los pagos guardan la forma de pago del 606 (01–07) y las retenciones que hacemos (`retenciones_pago`, cuenta
  `cuenta_a_terceros_id`, con su código 606) en la fecha del pago. Registrar compras y hacer pagos exige «contabilizar».
  Cuentas en `cuentas_empresa`: `cxp` 210101, `cxp_exterior` 210102, `gasto_general` 610214 (Configuración de cuentas).
- **Configuración tributaria** (`lib/fiscal.ts`, `migraciones/004_tributaria.sql`): tablas `impuestos` y `retenciones` por empresa
  con tasa `numeric(7,4)`, cuentas asignadas (trigger: cuenta de detalle activa de la misma empresa) y vigencia desde/hasta, para
  que un cambio de ley (p. ej. Ley 30-26: ISR honorarios 10 % → 15 % desde 1-jul-2026) no altere lo anterior. Las retenciones de
  ITBIS son % del ITBIS facturado; las de ISR, % del monto sin impuestos. Cada línea puede llevar varios impuestos (ITBIS + propina).
  `configurar_tributaria(eid)` carga la configuración sugerida al crear una empresa. Catálogos de comprobantes (B01–B17, E31–E47)
  y obligaciones en `lib/fiscal.ts`; lo que la firma confirma se guarda en `obligaciones_empresa`. Pruebas: `pruebas/fiscal.test.mjs`.
  ISR de alquileres 15 % desde el 1-jul-2026 (migración 017, en `main` el 30-oct; la tasa sale del formulario oficial IR-17 2026,
  casilla 1); antes de julio no se cargó tasa de alquileres.
- **Respaldos:** `.github/workflows/respaldo.yml` (diario, pg_dump cifrado AES-256 con prueba de restauración). Necesita en
  GitHub → Settings → Secrets: `DATABASE_URL` (conexión directa de Neon, sin pooler) y `RESPALDO_CLAVE`. Ver `docs/respaldos.md`.

## Estado por fase

Orden aprobado por Joannie (22-oct-2026). Cada fase: presentar → desarrollar → mostrar pantallas → pruebas → pedir aprobación.
No se pasa a la siguiente sin su autorización expresa.

| Fase | Contenido | Estado |
|---|---|---|
| (antes) Base | Usuarios, empresas, catálogo dominicano, asientos, diario, mayor, balanza, cierres, CSV | En `main` y producción (`53ec121` + `ad104ee`) |
| 1. Plataforma y núcleo | Firmas con varios clientes, perfiles y permisos configurables, equipo de la firma, ficha de la empresa, borradores/contabilización/reversión, aprobación opcional, alerta de duplicados, documentos adjuntos, historial de cambios, búsqueda avanzada, Excel y PDF, respaldos | **Aprobada y en `main`** (22-oct-2026, commit `dd422f7`). |
| 2. Configuración tributaria | Perfil fiscal (persona física/jurídica, contribuyente de ITBIS, agente de retención, emisor e-CF), obligaciones DGII sugeridas y confirmables, impuestos con tasa, cuentas y vigencia, retenciones ITBIS/ISR con vigencia y tipo 606, todos los comprobantes B y E con sus rangos, «Probar cálculo» con asientos de ejemplo, permiso «impuestos» | **Aprobada y en `main`** (22-oct-2026, commit `3983185`; migración `004_tributaria.sql`; 34 pruebas; recorrido `pruebas/navegador/tributaria.cjs` de 11 pasos). |
| 3. Ventas y CxC | Borradores y emisión de facturas, impuestos de la configuración por línea (con propina/selectivo), notas de crédito B04, anulación 608, cobros con retenciones configurables y sugeridas, clientes con datos fiscales, productos con impuestos, adjuntos e historial en facturas y cobros, antigüedad y estado de cuenta | **Aprobada y en `main`** (22-oct-2026, commit `0a396a1`; migración `005_ventas_fiscal.sql`; 45 pruebas, 11 de ellas de ventas con la lógica real; recorrido `pruebas/navegador/ventas.cjs` de 13 pasos; los de las fases 1 y 2 siguen pasando). |
| 4. Compras y CxP | Proveedores con datos fiscales y valores habituales, compras en borrador y registradas con NCF del proveedor o propio (B11, B13, B17), control de NCF duplicados, ITBIS con crédito o al costo, notas de crédito del proveedor, pagos con retenciones sugeridas y diferencia cambiaria, antigüedad y estado de cuenta de proveedores, datos del 606, adjuntos e historial | **Aprobada y en `main`** (23-oct-2026, commit `617f33a`; migración `006_compras.sql`; 56 pruebas, 11 de compras con la lógica real; recorrido `pruebas/navegador/compras.cjs` de 11 pasos; los de las fases 1 a 3 siguen pasando). |
| 5. Bancos | Importación de estados de cuenta y conciliación con reglas | Estructura aprobada (30-oct-2026). Parte 1 (cuentas e importación) en `main` («sí» del 30-oct); parte 2 (conciliación) en `main` («sí» del 30-oct); parte 3 (reporte y cierre) en `main` («sí» del 30-oct). **Fase 5 completa.** Sigue presentar la estructura de la Fase 7. |
| 6. Fiscal | 606–609, IT-1, ISR, IR-17; e-CF por proveedor certificado (PSFE) | Pendiente |
| 7. Estados financieros y reportes | Resultados, balance, flujo, comparativos; Excel y PDF | Estructura aprobada (30-oct-2026). Partes 1 (resultados y situación financiera) y 2 (flujo de efectivo y cambios en el patrimonio) en `main` («sí» del 31-oct). Parte 3 (cierre del ejercicio y Centro de reportes) en `main` («sí» del 31-oct). **Fase 7 completa.** Sigue presentar la estructura del IR-2. |

### Pendientes y decisiones abiertas

- Publicado en `main` el 22-oct-2026: la migración 003 convierte a cada dueño actual en una firma con sus empresas
  (Goemhy queda en una firma con el nombre de Manaury). Confirmar con Joannie la publicación en Vercel (captura de Deployments).
- Fase 4 publicada el 23-oct-2026 (Joannie confirmó en Vercel: c49b62b Ready). Siguiente: Fase 5 (Bancos), solo con autorización expresa.
- Preguntar a Joannie: ¿qué firma usará el sistema (Empire, Enfoca o se vende a muchas)? ¿Goemhy sigue como primer cliente?
- Antes de producción: secretos de respaldo en GitHub (`DATABASE_URL` directa y `RESPALDO_CLAVE`) y activar PITR en Neon.
  **4-nov-2026: el respaldo diario falla todos los días desde al menos el 30-oct por falta de esos secretos** (no hay ninguno en
  el repositorio). Claude no puede escribirlos (son credenciales): los pone Joannie o Manaury en GitHub › Settings › Secrets and
  variables › Actions. Costos revisados ese día: solo se paga Vercel Pro (US$20 por persona); Neon, GitHub y Gmail en plan gratis;
  sugerido pasar Neon a Launch (~US$5–15/mes) cuando haya cobro real (historial de 7 días y sin tope de 1 GB; los adjuntos se
  guardan en la base). La app corre en `iad1` (Washington): confirmar que Neon esté en AWS US East.
- **Factura electrónica (e-CF):** el 4-nov-2026 se pidió dejarla para después. Obligatoria por etapas en 2026 (Ley 32-23). Recomendado: conectarse a un proveedor ya
  certificado por la DGII (PSFE) en vez de certificarse. Joannie aún no lo ha confirmado.
- Después de la Fase 2: enviar la factura por correo, anticipos de clientes (cobrar antes de facturar).
- Seguridad: **límite de intentos de entrada** (`migraciones/007_intentos_entrada.sql`, `lib/intentos.ts`: 5 fallos
  seguidos por correo o 20 por IP en 15 minutos bloquean 15 minutos) y **acceso por correo** (migración 008): en `main`
  desde el 28-oct-2026 (`f23de8f`, «sí» de Joannie). Joannie puso `GMAIL_CLAVE_APP` en Vercel › contable-system.
  Confirmado el 28-oct-2026: publicado y la invitación llega a Gmail (prueba de Manaury). La firma de producción se llama
  «Manaury Enrique Gomez Guerrero» (la creó la migración 003 con el nombre del dueño).
- 28-oct-2026: en `main` la guía del Panel de la firma («los módulos están dentro de cada cliente») y avisos claros sin
  clientes (`746e474`). Joannie pidió acceso para Patricia (empiretaxnlegal@gmail.com) como administradora de la firma
  (lo hace un administrador en Firma → Equipo). Ese día Joannie dijo que las claves temporales no llegaban y pidió acceso con verificación por correo y cambio de clave al
  primer ingreso: hecho y en `main` (ver Seguridad).
- **Consola de la plataforma** (propuesta en https://claude.ai/artifact/4GRqmXRNgMejSwsTSGJXLY; «sí» de Joannie el 4-nov-2026 a la
  estructura en 2 entregas). Respuestas: la supervisión de los datos de una firma solo con permiso de esa firma (24 h, 7 días o
  hasta quitarlo, como el acceso temporal de Zendesk, con aviso por correo a sus administradores); la dueña es
  patriciapm2312@gmail.com (la cuenta de esa sesión), que también es el contacto del aviso de firma suspendida. Base: Ley 172-13,
  art. 5, numerales 5 (seguridad: evitar consulta o acceso no autorizado) y 6 (deber de secreto). **Entrega 1** (migración 027,
  `lib/plataforma.ts`, `exigirDuena` en `lib/acceso.ts`, `app/plataforma/`, `app/suspendida/`): `duenas_plataforma` por correo
  (solo por migración); exige la verificación en dos pasos (si no, /cuenta?exigido=consola). /plataforma lista las firmas con RNC,
  alta, clientes, personas, última entrada (sesiones) y estado; /plataforma/[fid] muestra administradores y clientes (nombre y RNC),
  suspende o reactiva con motivo y su registro; /plataforma/registro. `firmas.suspendida_*`: `accesoEmpresa` y `accesoFirma`
  llevan a /suspendida (los datos se conservan; /empresas oculta las suspendidas). `registro_plataforma` (ver detalle, suspender,
  reactivar; con el nombre de la firma) no se cambia ni se borra (trigger). Enlace desde Mi cuenta solo para la dueña. Pruebas
  `pruebas/plataforma.test.mjs` (cierran la conexión de lib/db.ts). En `main` el 4-nov-2026 («sí» de Joannie). **Entrega 2**
  (migración 028): `permisos_supervision` (la da un administrador de la firma en Personas y accesos › «Supervisión de la plataforma»
  por 24 h, 7 días o hasta quitarla; `darPermisoSupervision`/`quitarPermisoSupervision` en `app/firma/acciones.ts`, avisan por
  correo a los administradores; quitarla termina la supervisión en curso) y `supervisiones` (motivo ≥ 5 letras, 1 h). En
  /plataforma/[fid] «Entrar como supervisora» (con permiso vigente) y la lista de clientes pasa a enlaces. `accesoEmpresa` tiene un
  camino nuevo (`accesoSupervision`): dueña con dos pasos + supervisión vigente + permiso vigente → solo el permiso «ver», perfil
  «Supervisión de la plataforma (solo lectura)», sin pantallas de la firma; franja dorada fija arriba (`Marco.franja`,
  `.franja-supervision`) con la hora de fin, el motivo y «Terminar». Ninguna acción del cliente se conforma con «ver», así que
  nada se guarda; las descargas piden «exportar» (403). La firma ve todo el registro de la plataforma en Personas y accesos.
  Probado en pantalla con una firma ajena local (sin permiso 404; con permiso ve facturas, franja, descarga 403, nueva factura
  sin permiso, firma 404; al terminar vuelve a 404). En `main` el 4-nov-2026 («sí» de Joannie). **Consola completa.**
- **Bloque 1 · Ficha única del cliente** (Sistema Empire; estructura con el «sí» de Patricia el 4-nov-2026, en 2 entregas:
  https://claude.ai/artifact/LQjhLNWMeo28hDHmHbAEBS). **Entrega 1a · Ficha ampliada** (migración 029, `lib/ficha.ts`,
  `app/e/[id]/ficha-acciones.ts`, `app/e/[id]/empresa/page.tsx` con pestañas `?seccion=`): datos del Documento maestro, sección 5.
  Sociedad (tipo, constitución, municipio, provincia, capital), socios (`socios_empresa`, hasta 30, las cuotas suman 100 %),
  contactos (`contactos_empresa`: principal, alterno, representante, gerente; grupo de WhatsApp), operaciones (ventas, facturas y
  empleados al mes, TSS, e-CF, sistema que usa), empleados (`empleados_empresa`, hasta 300; solo con el permiso «empresa») y
  relación con Empire (categoría, tipo de cliente, contrato, día de facturación, estado, documentos firmados, modalidad y quién
  guarda los accesos: las claves de DGII/TSS nunca se guardan). Categoría sugerida por 2 de 3 criterios (`categoriaSugerida`:
  ventas ≤ 500,000 / ≤ 2,000,000; facturas ≤ 50 / ≤ 200; empleados ≤ 5 / ≤ 20). Logo PNG/JPG ≤ 1 MB en `documentos`
  (entidad 'empresa', descripción 'logo'). Las tres tablas con RLS e historial. El anexo H-1 del IR-2, sin nada guardado, toma
  los accionistas de los socios y el municipio y la provincia de la ficha. Pruebas `pruebas/ficha.test.mjs` (148 en total).
  En `main` el 4-nov-2026 («sí» de Patricia). Sigue la entrega 1b (Empire como cliente propio, unidades de negocio, lista maestra).
  **Entrega 1b · Empire y los módulos** (migración 030, `lib/empresa-propia.ts`, `lib/lista-maestra.ts`, `app/unidad.tsx`,
  `app/e/[id]/unidades-acciones.ts`). Respuestas de Patricia del 4-nov: la cuenta corriente de la socia es **activo** (cuenta por
  cobrar); no hay otra socia; las unidades son para Empire **y** para los clientes que quieran; los empleados los ven solo quienes
  editan la ficha. `firmas.empresa_propia_id` (Clientes de la firma › «Empresa propia de la firma», acción `marcarEmpresaPropia`;
  trigger: debe ser de la misma firma). `clientes.empresa_vinculada_id`: la base (`sincronizar_cliente_de_firma`, SECURITY DEFINER,
  fija por un momento la empresa propia) crea o pone al día en la facturación de la propia el cliente de cada empresa de la firma
  (nombre, RNC, correo, teléfono, dirección) al marcarla, al crear una empresa y cuando su ficha cambia; si ya existía con el mismo
  RNC se enlaza ese. `prepararEmpresaPropia` (al marcarla; repetirlo solo completa): unidades Firma contable, Laboratorio de Imperios
  y Sistema, «Ingresos – <unidad>» bajo 4101 (cuenta de la unidad), bancos Popular/Banreservas/BHD bajo 1101 y «Cuenta corriente –
  <socia>» bajo 1102 por cada socio de la ficha (caja chica, ahorros y gastos de oficina ya estaban en el catálogo). `unidades_negocio`
  por empresa (RLS, historial; se crean, renombran y desactivan en Configuración de cuentas › Unidades de negocio, permiso
  «catálogo») y `unidad_id` en `lineas_asiento`, `lineas_factura` y `lineas_compra` (trigger: misma empresa y activa). Con unidades,
  los formularios de asiento, factura y compra muestran la columna «Unidad»; la factura usa la cuenta de la unidad si el producto no
  tiene una, y el asiento de factura y compra lleva la unidad en su línea de ingreso o gasto; la nota de crédito toma la unidad si la
  factura tiene una sola. Estado de resultados: «Unidad de negocio» general, una columna por unidad (+ sin unidad + total), una
  unidad o sin unidad (`saldosPorCuenta(..., unidad)`; también en Excel/PDF). Lista maestra en Clientes de la firma: categoría,
  tipo, estado, formalizado, modalidad y responsable con filtros y buscador; arriba activos, nuevos del mes (inicio del contrato o
  alta), retirados o en cero y sin formalizar (sin contar la propia). Menú en dos módulos: arriba la empresa propia («Contabilidad
  propia»), debajo «Clientes»; en el selector la propia dice «empresa propia». Pruebas `pruebas/empresa-propia.test.mjs` (154 en
  total). En `main` el 4-nov-2026 («sí» de Patricia). **Bloque 1 completo.** En producción, después de publicar: crear (o elegir) a Empire Tax’N Legal SRL
  como cliente, registrar a Patricia en Ficha › Socios y elegirla en «Empresa propia de la firma».
- **Bloque 2 · Igualas y facturación de Empire** (propuesta en https://claude.ai/artifact/XiHuXmurtdaroriMDMjP61, «sí» de Patricia
  del 4-nov-2026 a empezar por la 2a; en 3 entregas: 2a lista de precios, 2b igualas y recurrentes, 2c propuestas y anticipos).
  Preguntas abiertas del documento: subir EMP-P01 (37 servicios), EMP-F02 y EMP-L01; igualas como borradores o emitidas solas;
  cómo facturar a quien no pide comprobante fiscal; a qué cuenta va el trueque. **Entrega 2a · Lista de precios** (migración 031,
  `lib/precios.ts`): `servicios.grupo` (6 grupos del documento), `codigo` (único por empresa) y `unidad_id`; `precios_servicio`
  (precio por categoría Pequeña/Mediana/Grande/Emprendedor con `vigente_desde`; RLS, historial; trigger: servicio de la misma
  empresa); `servicios.precio` queda como precio general. `clientes.categoria` (en Clientes; en los enlazados sale de la ficha:
  `sincronizar_cliente_de_firma` la copia y el trigger mira también `categoria`). Productos y servicios: formulario con código,
  grupo, unidad y los 4 precios con «Vigente desde» (`guardarPrecios`: si el vigente es igual no guarda; el mismo día reemplaza),
  tabla con precio general y por categoría, filtro por grupo y descarga «Lista de precios» (`/exportar/lista-precios`, por
  grupo, sin ITBIS). Factura: al elegir el servicio toma el precio de la categoría del cliente (`precioDe`) y su unidad; al
  cambiar de cliente se recalculan las líneas con servicio; aviso si el cliente no tiene categoría. Pruebas
  `pruebas/precios.test.mjs` (159 en total). En `main` el 4-nov-2026 («sí» de Patricia). Sigue la 2b (igualas). La lista queda vacía hasta que llegue EMP-P01.
  **Entrega 2b · Igualas y facturas recurrentes** (migración 032, `lib/igualas.ts` puro, `lib/igualas-db.ts`,
  `app/e/[id]/igualas-acciones.ts`, pestañas `/igualas` y `/recurrentes` en Ventas, agregadas a Contador, Auxiliar y Facturación).
  Respuestas de Patricia del 4-nov: las igualas se preparan **como borradores** y se emiten con un clic; el comprobante es el
  **habitual del cliente** (B01 con RNC, B02 sin él). `acuerdos_cliente` (Hoja de Acuerdo EMP-F02: normal, Plan de Arranque, ajuste
  gradual, acuerdo especial, declaración en cero RD$600–2,500; servicio de la lista de precios, iguala, tarifa especial con fecha
  (0 = mes gratis), deuda/cuota/término, inicio, día de facturación, servicios incluidos; uno activo por cliente; RLS e historial).
  `igualaDelMes`: tarifa especial hasta su fecha, cuota del acuerdo especial como segunda línea, el mes del aniversario 10 % de
  descuento por fidelidad (en la descripción y la nota); día 30 = último día del mes. `avisosAcuerdo`: aniversario a 60 días,
  aumento de 10 % por confirmar (desde el aniversario), fin de tarifa especial o de acuerdo a 30 días. `aumentos_iguala`: el aumento
  solo se aplica al confirmarlo (permiso «empresa»: Patricia), uno por aniversario, y sube `acuerdos_cliente.monto`.
  `facturas.acuerdo_id/recurrente_id/periodo` (únicos entre no anuladas). Pantalla Igualas: avisos, mes con «Le toca» (fecha,
  monto, nota), «Preparar todas las del mes» y «Emitir los borradores» (cada uno en su transacción; los errores, como falta de NCF,
  se listan sin parar los demás), acuerdos con formulario. Al abrir la pantalla en el mes en curso se preparan solos los borradores
  de los clientes cuyo día de facturación ya llegó (no hay tarea programada). `facturas_recurrentes` (Anexo A): plantilla desde
  «Repetir esta factura» en el detalle (copia cliente, líneas, impuestos y unidad; solo DOP), frecuencia mensual/quincenal/
  trimestral/anual o a solicitud, próxima y hasta; al abrir Facturas recurrentes se preparan las que tocan (hasta 12 atrasadas) y
  avanza la próxima; «Preparar ahora», pausa y eliminar. Pruebas `pruebas/igualas.test.mjs` (168 en total). En `main` el 4-nov-2026
  («sí» de Patricia). Pendiente del bloque 2: carta EMP-L01 y mensajes (bloques 3 y 5).
  **Entrega 2c · Propuestas, anticipos y trueque** (migración 033, `lib/propuestas.ts`, `lib/anticipos.ts`,
  `app/e/[id]/propuestas-acciones.ts`, pestañas `/propuestas` y `/anticipos` en Ventas; agregadas a Contador, Auxiliar y Facturación,
  y `/anticipos` a Cliente · Consulta). Respuesta de Patricia del 4-nov: en el trueque la cuenta de lo recibido **se elige en cada
  cobro**. `propuestas` + `lineas_propuesta` (número por empresa; precio de lista de la categoría del cliente, descuento por línea a
  la vista, precio final; requisitos, anticipo %, forma de pago, entrega, válida hasta; estados borrador → enviada → aceptada o
  rechazada, «vencida» si pasó la fecha; aceptada o rechazada no cambia de líneas, trigger). Aceptada: «Convertir en factura»
  (borrador con el precio final y el descuento dicho en la descripción, nota «Según la propuesta n.º») o «Convertir en iguala»
  (acuerdo normal con el servicio de la primera línea y el total final). `totalesPropuesta`, `montoAnticipo` (sobre el total con
  impuestos). `anticipos` (número por empresa; asiento `origen = 'anticipo'`: banco o caja contra 210501 «Anticipos de clientes»;
  con permuta, contra el gasto o activo elegido); se aplican desde la factura emitida («Aplicar anticipo»): `aplicarAnticipo` usa
  `registrarCobro` con `anticipoId` y la cuenta 210501 como destino (`cobros.anticipo_id`), así rebaja el saldo y va al 607 con la
  forma del anticipo; saldo = monto − cobros vigentes; no se anula si ya se aplicó. Trueque: forma de cobro `permuta` (cobros y
  anticipos), columna Permuta del 607 y casilla 17 del IT-1 (`COLUMNA_COBRO`); en el cobro, «Lo recibido va a» lista gastos y
  activos (sin bancos ni cuentas por cobrar). Descargas `/exportar/propuesta?id=` (Excel/PDF con precio de lista, descuento, precio
  final, impuestos, total y el detalle) y `/exportar/recibo-anticipo?id=`. Pruebas `pruebas/propuestas.test.mjs` (173 en total).
  En `main` el 4-nov-2026 («sí» de Patricia). **Bloque 2 completo** (salvo carta EMP-L01 y mensajes, bloques 3 y 5).
- **Bloque 3 · Operación diaria** (propuesta en https://claude.ai/artifact/2GmNCZP4Wnm5re7MbSkKkk, «sí» de Patricia del 4-nov-2026
  a empezar por la 3a; 3 entregas: 3a bitácora y notificaciones de pago, 3b cronograma y alertas, 3c WhatsApp). Respuestas del
  4-nov: **crear el rol Coordinadora** (bitácora, grupos, igualas, cobros, notificaciones, digita compras y ventas; sin presupuesto
  personal, cuenta corriente de Patricia, precios ni declaraciones); los enlaces de descarga duran **30 días**; agregar a la ficha
  las fechas de vencimiento del **registro mercantil y del nombre comercial (ONAPI)** (alerta 60 días antes). Faltan los ejemplos
  de notificaciones TSS y DGII para leerlas solas. **Entrega 3a · Bitácora y notificaciones de pago** (migración 034,
  `lib/bitacora.ts`, `app/e/[id]/bitacora-acciones.ts`, pestañas `/bitacora` y `/notificaciones` en «Cliente elegido», pantalla
  `/firma/[fid]/bitacora`, descarga `/exportar/bitacora?mes=AAAA-MM`). `gestiones` (fecha, tipo de la sección 8, descripción,
  responsable, entrega, estado pendiente/en proceso/hecha, soporte en `documentos` entidad 'gestion'; RLS e historial); se anota sola
  por triggers con `anotar_gestion` (origen + id único, sin repetir): factura o nota emitida, `envios_dgii` (declaración marcada
  presentada), recepción procesada y notificación enviada; responsable = `app.usuario_id`. Las del sistema no se borran.
  `notificaciones_pago` (TSS/DGII, mes, concepto, monto, fecha límite, PDF en `documentos` entidad 'notificacion'; pendiente →
  enviada → pagada, «No se envió» vuelve a pendiente); aviso `porVencer` con 3 días o menos sin pago. Inicio de la firma: por
  cliente, notificaciones por enviar, sin pagar por vencer y gestiones atrasadas (`resumenCliente`). Rol base **Coordinadora**
  (ver, registrar, contabilizar, adjuntar, exportar; sin Productos y servicios, impuestos, catálogo ni ficha editable) creado en
  todas las firmas; `/bitacora` y `/notificaciones` sumadas a Contador, Auxiliar y Facturación. Pruebas `pruebas/bitacora.test.mjs`
  (178 en total). En `main` el 5-nov-2026 («sí» de Patricia). Sigue la 3b (cronograma y alertas).
  **Entrega 3b · Cronograma y alertas** (migración 035, `lib/tareas.ts`, `lib/alertas.ts`, `app/firma/tareas-acciones.ts`,
  pantallas `/firma/[fid]/tareas` y `/firma/[fid]/alertas`, recuadro «Alertas» en el Inicio de la firma). `plantillas_tarea` por
  firma (sin RLS, siempre filtrada por `firma_id`; el cronograma de la sección 9 sembrado con `crear_plantillas_tarea`, también al
  crear una firma; día del mes desde/hasta o día de la semana; alcance firma, todos los clientes, con TSS o con iguala; lo edita un
  administrador). `tareas` (una por plantilla, cliente y período; `generarTareas` al abrir la pantalla en el mes en curso o
  siguientes; la empresa propia no cuenta; responsable y hecha/reabrir; la de un cliente, al hacerse, deja una gestión en su
  bitácora). Ficha › Sociedad: `vence_registro_mercantil`, `vence_nombre_comercial` (alerta 60 días antes) y `fecha_asamblea`
  (30 días). `alertasDeEmpresa` (no se guardan; se van al resolverse): comprobantes con 10 o menos o rango a 30 días; declaraciones
  del mes anterior confirmadas en el perfil fiscal (606/607/608 día 15, IT-1 día 20, IR-17 día 10; 7 días antes) sin
  `envios_dgii`; IR-2 a 30 días de los 120 del cierre; notificaciones por vencer; desde el día 10 sin documentos del cliente en el
  mes; sin formalizar; cumpleaños de contactos (hoy o mañana) y aniversario con la firma (7 días); en la empresa propia, igualas
  vencidas sin cobrar y los avisos de los acuerdos. Prospectos y agenda de citas quedan para después. Pruebas
  `pruebas/tareas-alertas.test.mjs` (181 en total). En `main` el 5-nov-2026 («sí» de Patricia).
  **Entrega 3c · WhatsApp y mensajes predeterminados** (migración 036, `lib/mensajes.ts` puro, `lib/mensajes-db.ts`,
  `lib/pdf-documentos.ts`, `app/whatsapp.tsx`, `app/e/[id]/mensajes-acciones.ts`, `app/firma/mensajes-acciones.ts`, pantalla
  `/firma/[fid]/mensajes`, descarga pública `/d/[token]`). Envío con clic (wa.me, sin costo; la API de WhatsApp Business no llega a
  grupos y cobra por mensaje). `plantillas_mensaje` por firma con los 23 textos de la sección 10 + «Envío de factura» (no tenía
  texto en el documento: escrito en el mismo tono, para que Patricia lo revise); `crear_plantillas_mensaje` también al crear una
  firma; los edita un administrador. Campos que se llenan solos: [nombre] (contacto principal de la ficha), [empresa], [mes],
  [monto], [enlace], [servicio], [número], [concepto], [declaración], [período], [fecha límite], [cantidad], [tipo], [años]; lo
  demás queda entre corchetes con aviso. «Cuenta bancaria»: el sistema solo guarda los últimos 4 dígitos, así que Patricia escribe
  los datos en el texto. Botón «Enviar por WhatsApp» (ventana encima de la pantalla, sirve en el celular): factura emitida de la
  empresa propia (iguala → «Cobro de iguala», otra → «Envío de factura»; vencida con saldo → «Pago atrasado»), cobro («Pago
  recibido»), propuesta, notificaciones de pago (TSS → «Notificación TSS», DGII → «Constancia»; al enviarla queda «enviada»),
  alertas de la firma (comprobantes, notificación, documentos para el 606, cumpleaños, aniversario) y un selector con todos en la
  Bitácora. Muestra el contacto, su teléfono (los de RD con 1 delante) y el grupo de WhatsApp de la ficha; «Abrir el chat de…» o
  «Elegir el grupo u otro chat»; se puede editar. Al tocarlo se guarda `mensajes_enviados` y, por trigger, la gestión «WhatsApp: …»
  (origen `mensaje`) en la bitácora; «Deshacer el envío» (24 h, quien lo envió o un administrador) la quita, retira el enlace y
  devuelve la notificación a pendiente. `enlaces_documento`: solo el hash del token, vence a los 30 días, se retira en Mensajes de
  WhatsApp › Enlaces compartidos (con descargas); se crea solo al enviar (antes da 404). Sin FORCE RLS para buscarlo por hash sin
  sesión. Entrega la factura o la propuesta en PDF (`tablaFactura`/`tablaPropuesta`, también en `/exportar/factura?id=`) o el PDF
  subido de la notificación. Pide el permiso «exportar»; no lo usan los usuarios de clientes ni la supervisión. Pruebas
  `pruebas/mensajes.test.mjs` (186 en total). En `main` el 5-nov-2026 («sí» de Patricia). **Bloque 3 completo.** Pendiente:
  probarlo en un celular real con WhatsApp; Patricia revisa «Envío de factura» y escribe los datos de «Cuenta bancaria». Sigue el bloque 4
  (reporte mensual e impuestos de clientes).
- **Bloque 4 · Reporte mensual e impuestos de clientes** (propuesta en https://claude.ai/artifact/FnsiPjFNvHwFvvJVtiZwnP, «sí» de
  Patricia del 5-nov-2026 a empezar por la 4a; 3 entregas: 4a impuestos del mes, 4b reporte mensual, 4c proyección IR-2/IR-1).
  Preguntas abiertas: Excel «Reporte de Cliente Mensual - IR2»; quién aprueba el reporte; escala del IR-1; cierre con botón o solo;
  constancia con monto → notificación. Para la 4a se usaron las recomendadas (cierre con botón; la notificación nace sola).
  **Entrega 4a · Impuestos del mes** (migración 037, `lib/impuestos-mes.ts`, `app/e/[id]/impuestos-acciones.ts`, pantalla
  `/firma/[fid]/impuestos?mes=AAAA-MM` con descarga `/firma/[fid]/impuestos/exportar`). Tablero de la firma (como el «Tax manager»
  de Xero): por cliente activo el 606, 607, 608, IT-1 e IR-17 que le tocan (obligaciones confirmadas; si no confirmó ninguna, las
  sugeridas por su perfil fiscal con aviso «confírmalas»), estado presentada / en cero / pendiente / vencida (día 15, 20 y 10 del
  mes siguiente, `venceMensual`), monto a pagar, compras revisadas, documentos sin procesar; filtros (con pendientes, listos,
  cerrados, mis clientes) y cifras arriba. Mes por defecto: el anterior. «En cero» para 606/607/608 desde el tablero (`marcarEnviado`
  con `en_cero=1`; si tiene registros, error). Al presentar IT-1, IR-17 o IR-2: monto a pagar (sugerido de I68, R37 o I31+X45,
  `montoSugerido`), fecha límite (sugerida) y constancia PDF/JPG/PNG (`guardarPresentacion`): con monto nace la notificación de pago
  DGII con la constancia como su PDF (WhatsApp y alertas del bloque 3); `envios_dgii.constancia_id/monto_pagar/fecha_limite/
  notificacion_id`; con monto nunca queda «en cero». Los 606/607/608 aceptan un acuse. Quitar la marca (`quitarPresentacion`) borra
  la notificación si sigue pendiente. `revisiones_compra` (revisada o «corregir» con nota; quién y cuándo; permiso «contabilizar»):
  tarjeta en el detalle de la compra, columna «Revisión» y filtro «Sin revisar» en Compras, aviso en Reportes DGII. «Cerrar el mes»
  (permiso «cerrar», solo con todo presentado o en cero) pone `fecha_bloqueo` = fin de mes y anota la gestión en la bitácora.
  Pruebas `pruebas/impuestos-mes.test.mjs` (188 en total). En `main` el 5-nov-2026 («sí» de Patricia).
  **Entrega 4b · Reporte mensual** («sí» de Patricia del 5-nov a empezarla sin el Excel «Reporte de Cliente Mensual - IR2», con las
  siete secciones del documento maestro; se ajusta cuando llegue). Migración 038, `lib/reporte-mensual.ts`, `app/e/[id]/reporte-acciones.ts`,
  pantalla `/e/[id]/bitacora/reporte?mes=AAAA-MM` (botón «Reporte mensual» en la Bitácora; misma pestaña), lista de la firma
  `/firma/[fid]/reportes`. `armarReporte`: 1 servicios (gestiones del mes), 2 facturas emitidas, notas y compras (cantidad, ITBIS,
  total en pesos), 3 ITBIS (casillas del IT-1 presentado o, si no, calculado: I21, I25, I38/I33, I34), 4 retenciones (I67 e IR-17 R37
  con vencimientos), 5 declaraciones del mes (`estadoDelMes`) y notificaciones, 6 pendientes del cliente (sin documentos del mes,
  compras por corregir, notificaciones vencidas sin pagar, saldo con la firma; las declaraciones por presentar no, son de la firma),
  7 cuenta con la firma (facturas de la empresa propia al cliente enlazado: las del mes y las que deben; conexión dueña). Solo con lo
  que declara según su perfil. `reportes_mensuales` (uno por empresa y mes; RLS, historial): borrador con notas para el cliente
  (permiso «registrar») → revisado («cerrar») → aprobado («empresa», solo Administrador: Patricia; guarda `datos` y `huella`, avisa
  «Cambió después de aprobado») → enviado (al registrar el WhatsApp «Reporte mensual» con enlace seguro tipo 'reporte'; deshacer lo
  vuelve a aprobado). «Quitar la aprobación» retira los enlaces. PDF con `tablaReporte` (secciones en negrita) en
  `/exportar/reporte-mensual?mes=` y en `/d/[token]`. Pruebas `pruebas/reporte-mensual.test.mjs` (189 en total). En `main` el 5-nov-2026
  («sí» de Patricia). Pendiente: confirmar quién aprueba (se dejó Patricia, permiso «empresa») y ajustar al Excel cuando lo suba.
  **Entrega 4c · Proyección de cierre fiscal** (migración 039, `lib/proyeccion.ts`, `app/e/[id]/proyeccion-acciones.ts`, pantalla
  `/e/[id]/dgii/proyeccion?mes=AAAA-MM`, tarjeta en Reportes DGII, descarga `/exportar/proyeccion?mes=`). `proyeccionDe`: ejercicio
  según `mes_cierre` hasta el mes elegido; por mes ingresos (4), costos (5) y gastos (6 sin 63) de los asientos contabilizados sin
  los de cierre; proyección = (utilidad acumulada ÷ meses con datos) × 12 (fórmula del documento maestro); ISR estimado: persona
  jurídica 27 % (30 % si los ingresos proyectados llegan a `UMBRAL_30` del IR-2), menos las retenciones de ISR de los cobros;
  persona física: no se estima hasta tener la escala del IR-1 (aviso). Costos y gastos por subgrupo de 4 dígitos, compras del 606 por
  tipo de gasto, gastos de asientos manuales o del banco sin factura (sin contar nómina, TSS, INFOTEP ni depreciación, por nombre de
  cuenta) y utilidad del ejercicio anterior. Alertas con umbrales sugeridos en `UMBRALES` (costos y gastos ≥ 95 % de los ingresos;
  gastos sin factura ≥ 10 %; utilidad del último mes ±50 % del promedio; proyección ±30 % del ejercicio anterior; revisión 2 meses
  antes del cierre). «Preparar para el cliente» (permiso «impuestos») guarda `proyecciones_fiscales` (una por empresa y mes, con
  notas) y aparece «Enviar por WhatsApp» con el mensaje «Proyección IR-2» y enlace seguro tipo 'proyeccion' al PDF de lo preparado
  (`tablaProyeccion`). Pruebas `pruebas/proyeccion.test.mjs` (190 en total). En `main` el 5-nov-2026 («sí» de Patricia).
  **Bloque 4 completo.** Pendiente: confirmar los umbrales; la escala del IR-1 para personas físicas; el Excel del reporte mensual.
- **Bloque 5 · Expediente y biblioteca de documentos** (propuesta del 5-nov-2026 en https://claude.ai/artifact/8B6pHXvfbnAmWc5gXnU89n,
  esperando el «sí» de Patricia; 3 entregas: 5a expediente digital (carpetas 01–06 del manual + «Documentos del cliente», con lo que
  el sistema ya genera en su carpeta), trámites DGII/TSS/Cámara/ONAPI con volante, plazo de 30 días y alertas 5 días antes, y lista
  de 9 pasos de empresa nueva; 5b biblioteca con plantillas y campos de la ficha, referencia ETL-XX-AAAA-NNNN, PDF y Word; 5c lectura
  de PDF y redacción con IA, después, con la llave de IA). Preguntas: plantillas del manual en Word, lugar de la fecha formal,
  formato de la referencia, Word además de PDF, trámites fuera de la DGII, pasar el Drive actual. Fuera: auditoría NIA, control
  interno, estados desde balanza en Excel, formularios oficiales llenados.
  «sí» de Patricia del 5-nov a empezar por la 5a; se usaron las respuestas recomendadas: trámites también de TSS, Cámara y ONAPI;
  el Drive se pasa subiendo por carpeta (hasta 10 archivos y 4 MB por envío). **Entrega 5a · Expediente, trámites y empresa nueva**
  (migración 040, `lib/expediente.ts`, `lib/tramites.ts`, `app/e/[id]/expediente-acciones.ts`, pestaña `/expediente` en «Cliente
  elegido», sumada a Contador, Auxiliar y Coordinadora; pantalla `/firma/[fid]/tramites`). Los archivos van en `documentos`
  (entidad 'expediente', `carpeta` 01–06, `anio`; ahora también Word .docx y Excel .xlsx, por contenido ZIP + extensión,
  `tipoDeArchivo`); subir (permiso «adjuntar»), retirar y devolver («registrar»), buscar y filtrar por año, enviar por WhatsApp
  («Documento listo», ref 'expediente', enlace tipo 'documento'). `listarExpediente` suma lo del sistema en su carpeta: logo (01),
  constancias de `envios_dgii` y notificaciones (04), reportes aprobados y proyecciones (05), y de la empresa propia al cliente
  enlazado facturas, recibos y anticipos (03) y propuestas (06). Tarjeta «Documentos del cliente» lleva a la recepción. `tramites`
  (DGII, TSS, Cámara, ONAPI u otra; tipo con sugerencias, n.º de volante, fecha, plazo = 30 días si no se pone, responsable del
  equipo; volante y respuesta en `documentos` entidad 'tramite'; RLS e historial; trigger `gestion_tramite` anota en la bitácora al
  registrar y al cerrar); alerta «Trámites» 5 días antes y urgente al vencer (`alertasDeEmpresa`). Empresa nueva: «Abrir la lista de
  pasos» (`empresas.en_constitucion`, `pasos_constitucion` con los 9 pasos del manual: estado, fecha, responsable, nota y documento,
  que va a 01). Pruebas `pruebas/expediente.test.mjs` (195 en total). En `main` el 5-nov-2026 («sí» de Patricia). Sigue la 5b
  (biblioteca de documentos): necesita las plantillas del manual en Word y las respuestas 2 a 4 de la propuesta.
- **Bloque 6 · Formularios en línea y diagnóstico** (propuesta del 5-nov-2026 en https://claude.ai/artifact/5TNogQFAyekF9cTMPnSSXW,
  esperando el «sí» de Patricia; 2 entregas: 6a formularios en línea con enlace seguro (F01 Ficha de Registro, F03 Constitución, F04
  Solicitud de Servicio), revisión antes de cargar a la ficha, expediente o pasos de empresa nueva, y lista de solicitudes con
  estados y «Cotizar» → propuesta; 6b levantamiento con anexos, estado de situación inicial, diagnóstico por área y propuesta de
  categoría y precio). Referentes: organizers de TaxDome y onboarding de Karbon. Faltan: EMP-F01/F03/F04, levantamiento y anexos
  1–5, lista EMP-P01; preguntas: quién acepta, firma de la Hoja de Acuerdo, duración del enlace.
  «sí» de Patricia del 5-nov a empezar por la 6a sin los formularios (campos del documento maestro y de la ficha; se ajustan cuando
  lleguen); se usaron las recomendadas: la coordinadora revisa y carga, el enlace dura 30 días. **Entrega 6a · Formularios en línea
  y solicitudes** (migración 041, `lib/formularios.ts`, `app/f/[token]` y `app/f/acciones.ts` públicos, `app/e/[id]/solicitudes-acciones.ts`,
  pestaña `/solicitudes` «Solicitudes y formularios» en «Cliente elegido», sumada a Contador, Auxiliar, Coordinadora y Facturación;
  pantalla `/firma/[fid]/solicitudes`). `formularios` (ficha F01, constitución F03, solicitud F04; `token_hash` que se pone al
  mandarlo por WhatsApp —ref 'formulario', mensajes «Ficha de Registro», «Formulario de constitución» y el nuevo «Solicitud de
  servicio» (`crear_plantillas_mensaje_extra`, para que Patricia lo revise)— o con «Enlace para copiar»; uno nuevo anula el
  anterior; vence a los 30 días; sin FORCE RLS para buscarlo por hash). El cliente llena `/f/<token>` desde el celular, sin cuenta;
  `leerRespuestas` usa los mismos nombres de campo y lectores de la ficha (cédulas, 100 %, fechas; constitución: capital ≥
  RD$100,000, al menos un nombre y el gerente); se envía una sola vez; adjuntos en `documentos` entidad 'formulario'. Ficha y
  constitución quedan «recibido» (gestión en la bitácora y alerta «Solicitudes y formularios»); la revisión muestra lo enviado junto
  a lo que hay y se carga por secciones (empresa, sociedad, socios, contactos, operaciones, adjuntos); lo que vino en blanco no borra
  lo que había; los contactos se unen por rol; los adjuntos pasan a 01 (si el mismo archivo ya estaba, no se repite) y se muestra la
  categoría sugerida. Constitución: abre los 9 pasos, carga capital, socios, gerente, TSS y deja los nombres propuestos en la nota
  del paso 1. Solicitud: entra directo a `solicitudes` (servicio de la lista de precios de la empresa propia, qué, para qué, para
  cuándo, prioridad; también se anotan las de WhatsApp, escrito o llamada; recibida → cotizada → en proceso → entregada o
  descartada; gestiones al entrar y al entregarse; alerta urgente si pasa su fecha). «Cotizar» crea el borrador de propuesta en la
  empresa propia con el precio de la categoría del cliente (sin servicio, en 0). Pruebas `pruebas/formularios.test.mjs` (198 en
  total). En `main` el 5-nov-2026 («sí» de Patricia). Pendiente: ajustar las preguntas a EMP-F01/F03/F04 cuando las suba. Sigue la 6b
  (levantamiento y diagnóstico): necesita el levantamiento con sus anexos 1–5 y la lista EMP-P01.
  8-nov-2026: Patricia subió EMP-P01 (37 servicios), Formulario y Ficha de Levantamiento, anexos 1, 2, 3 y 5 (falta el 4, pasivos) y el Manual de la
  Coordinadora v2.0 (no trae las plantillas de la 5b). Propuesta de la 6b en 3 partes (6b.1 lista de precios, 6b.2 levantamiento y estado inicial, 6b.3
  diagnóstico y propuesta) en https://claude.ai/artifact/2Px23rimYxGZb6LShBcCpD, esperando su «sí». Reglas por aplicar: empate de categorías = Mediana, iguala
  mínima RD$4,000, emprendedor sin descuento. La lista no trae precio de iguala.
  «sí» de Patricia del 8-nov a empezar la 6b.1. **Entrega 6b.1 · Lista de precios** (sin migración; `lib/lista-p01.ts`, acción `cargarLista`, botón en Productos y
  servicios solo en la empresa propia, permiso «empresa»): los 37 servicios de EMP-P01 (leídos del PDF en el orden real de sus filas) con precios por categoría y fecha
  2026-10-01, ITBIS 18 %, unidad «Firma contable» si existe y precio general 0. Se puede repetir: no duplica y un precio cambiado después se queda. `categoriaSugerida`:
  tres criterios distintos = Mediana. `igualaBajoMinimo` (aviso al guardar el acuerdo) y `descuentoAEmprendedor` (aviso en la propuesta). Pruebas
  `pruebas/lista-p01.test.mjs` (246 en total). Probado en pantalla la carga (37 y luego 37 iguales), que no sale en un cliente y el aviso de iguala; el aviso de
  emprendedor solo con prueba automática. En `main` y producción el 8-nov-2026 («sí» de Patricia, `4614dc2`). Para usarla en producción hay que elegir antes a Empire como empresa propia. Sigue la 6b.2 con su «sí».
  «sí» de Patricia del 8-nov a la 6b.2 con las respuestas recomendadas. **Entrega 6b.2 · Levantamiento y estado inicial** (migración 052, `lib/levantamiento.ts` puro,
  `app/f/[token]/levantamiento.tsx`, `app/e/[id]/levantamiento-acciones.ts`, pantalla `/e/[id]/solicitudes/levantamiento/[fid]`, descarga `/exportar/estado-inicial?id=`): formulario
  tipo `levantamiento` con el mismo enlace de 30 días (mensaje `levantamiento_contable`, para que Patricia lo revise); Formulario + Ficha de Levantamiento en un cuestionario
  (`SECCIONES_LEV`, se agregó «Facturas al mes» porque la categoría la necesita) y anexos con filas que se agregan (`ANEXOS`: nómina, gastos fijos y variables, activos corrientes y
  no corrientes, pasivos; el anexo 4 se armó con las líneas de pasivos del anexo 5 porque no llegó). Viene lleno de la ficha; el borrador vive en sessionStorage (lleva salarios).
  Confirma con nombre y cédula. `estadoInicial`: líneas del anexo 5 con su referencia, diferencia si no cuadra, utilidades que cuadrarían, referencia operativa; la nómina solo del
  anexo 1 (si se escribe en gastos, aviso y no cuenta), costos directos a mano, margen en %, y aviso de que el anexo 5 no resta los gastos variables. La firma escribe el patrimonio
  (capital de la ficha). Aceptar carga empresa, sociedad, operaciones, empleados (solo con permiso «empresa», igual que ver los salarios) y adjuntos. Patricia aprueba (permiso
  «empresa», solo si cuadra; `formularios.aprobado_*`): entonces hay PDF/Excel, sale en el expediente 05 y se puede «Pasar a los Saldos del balance» (R5). Pruebas
  `pruebas/levantamiento.test.mjs` (250 en total). Probado en pantalla en tamaño celular y el flujo completo con Salón Rosa. En `main` y producción el 8-nov-2026 («sí» de Patricia, `21e0853`, con la migración 052). Sigue la 6b.3 (diagnóstico y propuesta) con su «sí».
  «sí» de Patricia del 8-nov a la 6b.3. **Entrega 6b.3 · Diagnóstico y propuesta** (migración 053, `lib/diagnostico.ts` puro, `lib/pdf-diagnostico.ts`, `armarPdf` en `lib/exportar.ts`,
  `app/e/[id]/diagnostico-acciones.ts`, pantalla `/e/[id]/solicitudes/levantamiento/[fid]/diagnostico` y su `/pdf`): `hallazgosDe` sugiere hallazgos por área con la tabla de la propuesta; la
  firma cambia, quita o agrega, elige categoría (se sugiere) y escribe la iguala (referencia: suma de lo mensual que le toca, mínimo RD$4,000 salvo emprendedor). Lo guardado va en
  `formularios.diagnostico`. Patricia aprueba (permiso «empresa», estado inicial aprobado antes): se fija la categoría en la ficha y nacen en la empresa propia hasta dos propuestas en borrador
  (servicios iniciales de una vez con el levantamiento primero si se cobra, y aparte la iguala con la línea «Iguala mensual» de «Registros contables mensuales (virtual)», para que
  «Convertir en iguala» dé el monto correcto; los servicios `MENSUALES` no van en la primera). Quitar la aprobación y aprobar de nuevo actualiza las mismas propuestas. PDF con portada verde y dorada en
  texto (sin el logo), resumen, cifras del estado inicial, hallazgos por área y propuesta; WhatsApp «Informe de diagnóstico» con enlace seguro tipo 'diagnostico' (texto para que Patricia lo
  revise) y expediente 06. Auditoría y lo que el cliente no precisó quedan sin servicio para que Patricia elija. Pruebas `pruebas/diagnostico.test.mjs` (255 en total). Probado en pantalla con
  Salón Rosa. En `main` y producción el 8-nov-2026 («sí» de Patricia, `5a27138`, con la migración 053). **Bloque 6 completo.** Patricia revisa el mensaje «Informe de diagnóstico»; faltan EMP-F01/F03/F04 y, si existe, el anexo 4 propio.
- **Bloque 7 · Presupuesto y cuenta de la socia** (propuesta del 5-nov-2026 en https://claude.ai/artifact/HV8vbyEbxv8CdNW1MHAjHc,
  esperando el «sí» de Patricia; documento maestro, sección 3; referentes Xero Budget Variance, QuickBooks Budget vs. Actuals y
  transacciones recurrentes, YNAB metas; 3 entregas: 7a «Registrar salida» con los 5 tipos (oficina, personal, deuda personal,
  ahorro, traspaso) que arma el asiento, categoría personal en la línea, plantillas de asientos sin programar y recurrentes como
  borrador, estado de cuenta de la socia y liquidación al cierre (dividendos contra 310301 con retención o cuenta por cobrar);
  7b presupuesto por mes con real automático, Dentro/Excedido/Sin presupuesto, partidas pagadas/pendientes y presupuesto contra
  real; 7c metas de ahorro, deudas personales y panel). Solo lo ve el rol Administrador. Preguntas: Excel PRESUPUESTO 2026
  (necesario para 7b y 7c), si lo ve solo Patricia, retención de dividendos (confirmar tasa con la Ley 30-26), recurrentes como
  borrador, una cuenta de ahorros para todas las metas, meta diaria por días hábiles.
  «sí» de Patricia del 5-nov a empezar por la 7a con las respuestas recomendadas (recurrentes como borrador; el sistema propone
  las dos opciones de liquidación). **Entrega 7a · Pagos a su cuenta y cuenta de la socia** (migración 042, `lib/salidas.ts`,
  `lib/plantillas.ts`, `lib/socia.ts`, `lib/propia.ts`, `app/e/[id]/socia-acciones.ts`, `app/e/[id]/plantillas-acciones.ts`).
  **Pestañas privadas** (`PESTANAS_PRIVADAS` en `lib/pestanas.ts`: `/salidas` «Registrar salidas» y `/socia` «Cuenta de la socia»,
  grupo «Cuenta de la socia», solo dentro de la empresa propia): las ven el administrador de la firma y el rol base Administrador;
  un rol con «todas» (NULL) ya no las incluye (`pestanasDelRol`, también para la supervisión), y en Roles y permisos se marcan a
  propósito (`pestanasAGuardar`: NULL solo si marcó todas las comunes y ninguna privada). `salidas` (número por empresa; tipo
  oficina/personal/deuda/ahorro/traspaso; sale de un banco o caja en pesos de 1101 o de una cuenta bancaria; oficina → gasto o
  costo con unidad; personal y deuda → «Cuenta corriente – …» bajo 1102 con categoría, la deuda con acreedor; ahorro y traspaso →
  otra cuenta de efectivo; asiento `origen = 'salida'` contabilizado, permiso «contabilizar»; anular con motivo, permiso
  «revertir», anula el asiento). `lineas_asiento.categoria_personal` (la escriben `insertarAsiento`, los borradores y las
  reversiones; categorías sugeridas en `CATEGORIAS_PERSONALES`, se puede escribir otra). Vista previa del asiento antes de
  guardar; aviso de que un gasto con NCF va en Compras para el 606. Descarga `/exportar/salidas`. `plantillas_asiento`
  (pestaña `/plantillas` «Asientos frecuentes» en Contabilidad, para todas las empresas; no se sumó a Contador ni Auxiliar):
  sin programar («Usar» abre Nuevo asiento con sus líneas, `?plantilla=`) o mensual (día 1–30, el 30 es el último día; desde,
  hasta): al abrir la pantalla `prepararRecurrentes` crea los borradores que tocan (hasta 12 atrasados, `asientos.plantilla_id`
  y `periodo` únicos), avisa si el mes está cerrado y la desactiva al pasar su fecha final; «Contabilizar los marcados» (con
  aprobación obligatoria, no lo hace quien lo preparó). «Guardar como plantilla» en el detalle de cualquier asiento. Cuenta de la
  socia: estado de cuenta (saldo inicial, cargos, abonos, saldo, por categoría con %, filtro por categoría, Excel/PDF
  `/exportar/socia`) y liquidación de los dos últimos ejercicios terminados (`liquidaciones_socia`, permiso «cerrar»; deshacer,
  «reabrir»): dividendos (bruto = neto ÷ 0.90 para que se rebaje justo lo elegido; asiento `origen = 'liquidacion'`: 310301 al
  debe, cuenta corriente y 210203 «ISR retenido a terceros por pagar» al haber; exige ganancias acumuladas suficientes a la
  fecha; la retención del 10 % es el concepto 5 del formulario IR-17-2026 y `calcularIr17` la suma sola a la casilla 5 del mes)
  o dejar el saldo como cuenta por cobrar (sin asiento). Pruebas `pruebas/salidas-socia.test.mjs` (205 en total). Probado en
  pantalla con la empresa propia local. En `main` el 5-nov-2026 («sí» de Patricia). Sigue la 7b (presupuesto del mes): la 7b y la
  7c necesitan el Excel PRESUPUESTO 2026.
- **Bloque 8 · Aplicación del cliente** (propuesta del 5-nov-2026 en https://claude.ai/artifact/Kh4HKXCJd4Kck2MMdopXfK, esperando el
  «sí» de Patricia; documento Fase 2, secciones 2 a 4, modalidad 1; referentes Dext (lectura de facturas con revisión), guía e-CF de
  la DGII (QR → consulta del timbre) y Next.js PWA (instalable sin tienda); las páginas de TaxDome rechazaron la consulta automática.
  3 entregas: 8a cuenta propia del prospecto (lista maestra con estado prospecto, «Pasar a cliente» sin otra cuenta), formularios y
  solicitudes dentro de su cuenta, pantalla de inicio del cliente (facturas del mes, impuestos a pagar, reporte y proyección,
  estado de cuenta con Empire, avisos, espacio para talleres) e instalable en el celular; 8b carga de facturas de ingreso y gasto
  (foto, PDF, QR o a mano; validaciones de RNC/NCF, repetido, a nombre de otra empresa, sin crédito fiscal; estados recibida,
  rechazada, aprobada, desestimada; bandeja de revisión: el gasto aprobado pasa a borrador de compra y el ingreso a venta externa
  para el 607); 8c lectura automática con IA (necesita la llave en Vercel). Preguntas: cuenta abierta o por invitación, quién pasa a
  cliente, quién aprueba facturas, ventas externas al 607, firma sencilla de la Hoja de Acuerdo, nombre de la app. Fuera: Parte B,
  inventario, auditoría en campo, talleres, e-CF y bóveda, envío por correo y pantalla de normas.
  «sí» de Patricia del 5-nov a empezar por la 8a con las respuestas recomendadas (registro abierto con verificación del correo; pasa a
  cliente la coordinadora o Patricia). **Entrega 8a · Cuenta del cliente y pantalla de inicio** (migración 043, `lib/prospectos.ts`,
  `lib/prospectos-alta.ts`, `lib/inicio-cliente.ts`, `app/unirse/[fid]` y `app/unirse/acciones.ts` públicos, `app/e/[id]/cliente-acciones.ts`,
  `app/e/[id]/inicio-cliente.tsx`, `app/e/[id]/solicitudes/cliente.tsx`, `app/e/[id]/instalar.tsx`, `app/manifest.ts`, iconos en
  `public/app/`). `firmas.alta_clientes` (Clientes de la firma › Datos de la firma, con la dirección para compartir `/unirse/<firma>`).
  En la página pública cualquiera crea su cuenta (nombre, correo, teléfono, negocio, RNC o cédula, acepto de la Ley 172-13): se crean el
  usuario, `miembros_firma`, la empresa con `crearEmpresa` (`estado_cliente = 'prospecto'`, nuevo; `alta_app`), el contacto principal
  y el acceso con el rol base nuevo **«Cliente · Prospecto»** (ver, adjuntar; Inicio, Solicitudes y Mis documentos); le llega el enlace
  de un solo uso para verificar el correo y crear la contraseña, y a los administradores un correo. Con un correo que ya existe responde
  lo mismo y le recuerda cómo entrar (sin otra empresa). `altas_prospecto` limita a 5 por hora por dirección y 2 por correo (solo la
  conexión dueña). Sin `GMAIL_CLAVE_APP` y fuera de Vercel, el enlace se escribe en el registro del servidor para probar. El prospecto no
  cuenta en tareas, Impuestos del mes ni «Nuevos este mes»; la lista maestra tiene la cifra «Prospectos de la aplicación» y la alerta
  «Prospecto: dar seguimiento». En Solicitudes y formularios del equipo, recuadro del prospecto con **«Pasar a cliente»** (permiso
  «registrar»; `pasarACliente`: estado activo, `paso_a_cliente`, contrato e inicio con la fecha si no tenían, y las personas con el rol
  de prospecto pasan a **«Cliente · Con aplicación»** (ver, adjuntar, exportar), con correo de aviso). El cliente ve en su menú Inicio,
  Mis documentos y Mis solicitudes (`NOMBRES_CLIENTE`): pedir un servicio de la lista de precios de la empresa propia o un requerimiento
  (`pedirServicio`, origen «Aplicación»), llenar su Ficha de Registro o Constitución (`llenarFormulario` abre `/f/<token>`) y ver el
  estado de lo pedido. Inicio del cliente (solo esos dos roles; Cliente · Consulta sigue igual): documentos del mes, impuestos por pagar
  (notificaciones sin pagar con su PDF), saldo y facturas con Empire (`cuentaConFirma`, ahora exportada), reporte aprobado y proyección
  (descargas `/e/[id]/mis-documentos/<tipo>/<id>`), avisos y espacio para los talleres; el prospecto ve la bienvenida. Instalable
  (manifiesto, iconos del símbolo inverso sobre el verde, `apple-touch-icon`, aviso «Agregar a inicio» en el iPhone). Pruebas
  `pruebas/prospectos.test.mjs` (210 en total). Probado en pantalla en tamaño de celular: registro, contraseña, pedir servicio, ficha,
  pestañas bloqueadas, Pasar a cliente e inicio con una notificación de prueba. En `main` el 5-nov-2026 («sí» de Patricia); en
  producción responden `/manifest.webmanifest` y los iconos. Para usarla en producción: marcar «Abrir la página Crear mi cuenta» en Datos
  de la firma y compartir `/unirse/<firma>`. Sigue la 8b (carga de facturas); falta probar el correo real y la instalación en un celular.
  «sí» de Patricia del 5-nov a empezar por la 8b (recomendadas: la coordinadora aprueba; las ventas hechas fuera del sistema van al
  607 con su NCF). **Entrega 8b · Carga de facturas y su revisión** (migración 044, `lib/validar-fiscal.ts` puro, `lib/facturas-subidas.ts`,
  `app/e/[id]/facturas-subidas-acciones.ts`, pestaña `/facturas-subidas` «Facturas subidas» en «Cliente elegido» («Mis facturas» para el
  cliente), sumada a Contador, Auxiliar, Coordinadora y Cliente · Con aplicación (el prospecto no); pantalla `/firma/[fid]/facturas-subidas`
  «Facturas por revisar»; paquete `jsqr` 1.4.0). `facturas_subidas` (número por empresa; gasto o ingreso; forma foto/pdf/qr/manual;
  contraparte, NCF, fecha, subtotal, ITBIS, total, `qr_url`, `marcas` y `sin_credito`; recibida → aprobada, rechazada o desestimada con
  motivo que ve el cliente; RLS e historial); el archivo va en `documentos` (entidad `factura_subida`; el mismo archivo no se sube dos
  veces). Con la foto basta (Empire completa los datos); el QR se lee en el celular de la foto del código (jsQR) y `leerQr` toma de la
  dirección de consulta del timbre de la DGII el RNC del emisor y del comprador, el e-NCF, la fecha y el total (los nombres de los
  parámetros salen de los resultados de búsqueda de la guía de la DGII, que no se pudo abrir: confirmarlos con un QR real). Revisión al
  subir (`revisarFactura`): dígito verificador del RNC (pesos 7 9 8 6 5 4 3 2; probado con los RNC de Empire y Goemhy) y de la cédula,
  NCF B + 10 o E + 12 con tipo conocido, repetida (entre las subidas, las compras del proveedor o las facturas), a nombre de otra empresa
  (por el QR), ITBIS que no es el 18 %, sin crédito (B02, E32, B13, E43, B11, E41). El NCF vencido o fuera de rango no se revisa (lo da la
  DGII). Aprobar (permiso «registrar», no el cliente; `aprobarSubida`): el gasto busca o crea el proveedor por RNC y deja el borrador de
  la compra (tipo de gasto del 606, bien o servicio, ITBIS 18 % o exento) con el archivo copiado; el ingreso busca o crea el cliente
  (sin RNC: «Consumidor final», solo B02) y deja el borrador de la venta con `facturas.ncf_externo`: al emitirla conserva ese NCF y no toma
  del rango (`emitir`; el vencimiento del NCF puede quedar vacío; `facturas_emision_check` cambiado). Las e-CF de ventas se registran a
  mano. Inicio del cliente: tarjeta «Facturas subidas en el mes» (gastos, ventas y en revisión), botón «Subir una factura» y avisos de las
  rechazadas o desestimadas; alerta del equipo «Facturas subidas» por revisar. Pruebas `pruebas/facturas-subidas.test.mjs` (215 en
  total). Probado en pantalla: QR leído de una imagen de prueba, foto sola, lista de la firma, aprobar a compra, rechazar con motivo, venta
  aprobada y emitida con su NCF (B0200000077), aviso al cliente. En `main` el 6-nov-2026 («sí» de Patricia). Pendiente: probar el QR
  de una factura electrónica real; la 8c (lectura con IA, necesita la llave en Vercel).
  10-nov-2026: la llave `GEMINI_API_KEY` ya está en Vercel (dicho por quien la puso; no se ha probado). Propuesta de la 8c en https://claude.ai/artifact/NgB8mqfADe3maaNrtgaCMn, esperando el «sí» de Patricia y 20 facturas reales de muestra.
  «sí» de Patricia del 10-nov a la 8c con las recomendadas (botón en la revisión, Gemini 3.5 Flash-Lite, aviso a los clientes). **Entrega 8c · Lectura de facturas con IA** (sin migración; `lib/lectura-ia.ts`,
  `app/e/[id]/lectura-ia-acciones.ts`, `app/firma/[fid]/documentos/leer-ia.tsx`): `leerFactura` llama por REST a la Interactions API de Gemini (`GEMINI_API_KEY`, `MODELO_IA`, `response_format` con `ESQUEMA`, pensamiento «minimal», 45 s); `interpretar` descarta lo que no tiene forma;
  `combinar` llena solo lo vacío (lo escrito o el QR se respeta y se avisa) y marca dudas, otra empresa y diferencias. «Leer con IA» y «Leer las pendientes con IA» (hasta 8) en Facturas subidas guardan en `facturas_subidas` y en `marcas` (`origen: 'ia'`, `campo`, en amarillo); en Documentos recibidos el
  botón llena el formulario en pantalla. Permiso «registrar», no los clientes; cada lectura en `bitacora`. Los botones solo salen con la llave puesta. `/unirse` avisa de la lectura con IA (Patricia revisa el texto; falta en el contrato). `GEMINI_URL_PRUEBA` solo fuera de Vercel, para simular a Gemini.
  Pruebas `pruebas/lectura-ia.test.mjs` (261 en total). Probado en pantalla con Gemini simulado; **falta la prueba real con 20 facturas**, antes del «sí» para pasar a `main`. Se hace en local con la llave en `.env.local`: el 10-nov la vista previa dio error al entrar porque su base no tiene las migraciones (`intentos_entrada` no existe; se vio con `vercel logs`) y `GEMINI_API_KEY` está solo en Production.
- **Facturas por correo y normas y tasas** (documento Fase 2, sección 7; propuesta del 6-nov-2026 en
  https://claude.ai/artifact/WYEPeEVe9FffdXZtpUNZbC, esperando el «sí» de Patricia; referentes: «responder a» de la configuración de
  correo de Xero y el límite de Gmail de 500 correos al día). 2 entregas: A «Enviar por correo» en facturas y notas emitidas (correo de la
  ficha, texto predeterminado editable, PDF adjunto; las de Empire con su marca y las de un cliente con su nombre y «responder a» al correo
  de su ficha, desde la misma cuenta de Gmail; bitácora; aviso y marca «no salió» si Gmail lo frena; envío de las igualas emitidas);
  B «Normas y tasas» en la administración de la firma (tasas y retenciones aplicadas a todos los clientes con su vigencia, calendario
  fiscal editable que usan alertas, tablero y reporte, tipos de comprobante; responsable de las normas con registro de revisiones y
  adjunto; aviso de cambios en 30 días y recordatorio si pasan 30 días sin revisión). Preguntas: enviar también las de los clientes,
  responsable, frecuencia, aplicar a todos o elegir, texto propio del correo.
  «sí» de Patricia del 6-nov a empezar por la A (recomendadas: también las facturas de los clientes, a su nombre). **Entrega A · Facturas
  por correo** (migración 045, `lib/correo-facturas.ts`, `app/e/[id]/correo-acciones.ts`): `enviarConDetalle` en `lib/correo.ts` con
  adjuntos, `replyTo`, nombre del remitente y `encabezado` (sin marca: franja gris con el nombre de la empresa); `errorDeGmail` reconoce
  el límite del día (5.4.5 / 4.7.0). PDF con `Tabla.sinMarca` (sin verde, dorado ni «Empire Tax’N Legal · Sistema contable»).
  Recuadro «Enviar por correo» en toda factura o nota emitida y vigente (permiso «exportar», pestaña Facturas; no los usuarios de
  clientes): para (`clientes.email`, hasta 5 direcciones), asunto «Factura <NCF> · <empresa>» y el texto de la plantilla nueva
  «Correo: envío de factura» (`correo_factura`, en `crear_plantillas_mensaje_extra`; escrita para que Patricia la revise; a
  «Consumidor final» no se le nombra). Empresa propia: remitente «Empire Tax’N Legal» con su marca; un cliente: remitente con su
  nombre, sin la marca. «Responder a» = correo de la ficha de quien factura (`empresas.correo`). Siempre desde la misma cuenta de
  Gmail. `correos_enviados` (RLS, historial): cada intento, «enviado» o «no salió» con el motivo; el último que no salió abre el
  recuadro con aviso y «Enviar de nuevo». Lo que salió va a la bitácora (trigger, origen `correo`, tipo mensaje). Igualas: columna
  «Correo» (enviado / no salió / por enviar) y «Enviar por correo las emitidas» (las del mes que no han salido; sin correo se
  listan; si Gmail llega al límite se para y avisa). «Mensajes de WhatsApp» de la firma pasa a «Mensajes predeterminados»; la
  plantilla del correo no se ofrece como WhatsApp en la Bitácora. Solo en una computadora local sin clave de Gmail:
  `CORREO_PRUEBA_CARPETA` guarda los correos como .eml en vez de enviarlos (así se revisó el adjunto, el remitente y «responder a»).
  Pruebas `pruebas/correo-facturas.test.mjs` (223 en total). En `main` el 6-nov-2026 («sí» de Patricia; publicado en producción,
  `ababe2a`). Pendiente: probar un envío real con Gmail en producción; Patricia revisa el texto del correo. Sigue la B (normas y
  tasas) con su «sí».
  «sí» de Patricia del 7-nov a empezar la B (recomendadas: responsable Patricia y la puede cambiar; revisión mensual con recordatorio
  a los 30 días; la tasa nueva va a todas las empresas con opción de quitar algunas). **Entrega B · Normas y tasas** (migración 051,
  `lib/normas-reglas.ts` puro, `lib/normas.ts`, `app/firma/normas-acciones.ts`, pantalla `/firma/[fid]/normas` en Administración,
  solo administradores; descarga del adjunto `/firma/[fid]/normas/revision/[rid]`). Tasas y retenciones de todas las empresas de la
  firma (la propia incluida) juntas por concepto, tasa y vigencia, con estado vigente/próxima/cerrada. «Cargar una tasa nueva»
  (`cargarTasaNueva`, en cada empresa marcada con `conEmpresa`, así queda en su historial): cierra la vigente el día antes y crea la
  nueva con las mismas cuentas y códigos 606/IR-17, nombre nuevo opcional y la norma en la nota; no la aplica si ya estaba, si la
  empresa no tiene el concepto o si su tasa empieza después; lo registrado no cambia. `calendario_fiscal` por firma (606/607/608 día
  15, IT-1 20, IR-17 10, IR-2 120 días tras el cierre, con su norma; `crear_calendario_fiscal`, también al crear una firma) y
  `prorrogas_fiscales` (un mes con otra fecha; manda sobre el calendario). `vencimiento_fiscal(formato, periodo)` (SECURITY DEFINER;
  día inexistente = último del mes) lo usan `estadoDelMes`/`vencimientos` (Impuestos del mes), `alertasDeEmpresa` (declaraciones e
  IR-2) y el reporte mensual. `firmas.responsable_normas_id` (administradora; se dejó a Patricia) y `revisiones_normas` (fecha, qué se
  revisó, si hubo cambios, PDF/JPG/PNG ≤ 4 MB; no se cambian). `historial_normas` guarda cada cambio de la pantalla. Avisos de la
  firma (`avisosNormasDeFirma`, en el Inicio y en Alertas, para administradores y la responsable): tasa que cambia en 30 días, prórroga
  que vence en 30 días y recordatorio a los 30 días sin revisión (urgente a los 60). Tipos de comprobante para consultar (crédito del
  ITBIS y empresas con rango activo). Pruebas `pruebas/normas.test.mjs` (243 en total). Probado en pantalla: tasa de prueba en 3 de 4
  empresas con aviso, prórroga del IT-1 que el tablero toma, revisión que quita el recordatorio, Sara (no administradora) no entra. En `main` y producción el 7-nov-2026 («sí» de Patricia,
  `3b06a9a`, con la migración 051). En producción: Patricia registra su primera revisión y confirma las fechas del calendario.
- **Rediseño (en curso desde el 7-nov-2026; todo lo demás en pausa hasta terminarlo).** Documento de Patricia «Sistema Empire ·
  Lista de rediseños» (6-nov-2026, 8 págs., en `Downloads`; 22 cambios): cuatro secciones (Firma, Contabilidad Empire, Talleres,
  Administración) con desplegables; en Firma se elige el trabajo y después el cliente; a los clientes no se les hacen asientos (sus
  facturas alimentan impuestos, reportes y estados); la empresa propia sale de la lista de clientes como Contabilidad Empire;
  permisos por persona con casillas por sección. Datos: no se borra nada (se esconde), la oficina sigue trabajando. Propuesta en
  https://claude.ai/artifact/Vyop1x7vUXwWV97eRa3nKk, esperando el «sí» de Patricia: 6 entregas R1 menú en cuatro secciones (1, 7, 17,
  18, 21), R2 Contabilidad Empire (3–6), R3 clientes sin asientos (8, 9, 14, 15, 20), R4 el trabajo primero (2, 11, 12), R5 estados
  financieros sin asientos (10; también IR-2 A-1/B-1 y proyección), R6 permisos por persona (19, 22); el n.º 13 es la 5b. Revisado:
  606/607/608, IT-1, IR-17, Impuestos del mes y Reporte mensual no dependen de asientos; estados, IR-2 y proyección sí. 7 preguntas
  en el documento (Prime con contabilidad, asientos viejos escondidos, NCF sin asiento, «por revisar», «solo mis clientes»,
  saldos por año, empezar por R1). En pausa: entrega B, 5b, 6b, 7b/7c, 8c.
  «sí» de Patricia del 7-nov a empezar por la R1. **R1 · Menú en cuatro secciones** (sin migración; `app/e/[id]/menu.tsx`,
  `.seccion` en `app/globals.css`, `PESTANAS_ADMINISTRACION` en `lib/pestanas.ts`, `esPrime` en `lib/ficha.ts`): desplegables
  `<details>` Firma (pantallas de la firma + las pestañas del cliente elegido, hasta la R3/R4), Contabilidad Empire (las pestañas de la
  empresa propia cuando está elegida; si no, enlace para abrirla o, sin propia, «Elegirla»), Talleres («Próximamente») y
  Administración (Empresas Empire, Personas y accesos, Roles y permisos —solo administradores—, Actividad y, de la empresa elegida,
  Usuarios y permisos e Historial de cambios). Se abre sola la sección de la pantalla actual. El usuario de un cliente sigue viendo
  solo su aplicación. «Clientes de la firma» pasa a **Empresas Empire** (también en avisos y textos) con la etiqueta **Prime**
  (modalidad 2 o 3). Sin RNC de la firma, aviso en el Inicio y en Datos de la firma (anclas `#datos-firma`, `#empresa-propia`).
  Recorrido `pruebas/navegador/firma.cjs` ajustado al menú nuevo. Probado en pantalla (escritorio, celular y usuario de cliente);
  223 pruebas. En `main` y producción el 7-nov-2026 («sí» de Patricia, `0433889`). Sigue la R2 (Contabilidad Empire) con su «sí».
  «sí» de Patricia del 7-nov a empezar la R2. **R2 · Contabilidad Empire** (migración 046): la empresa propia deja de ser un
  cliente. `PESTANAS_SOLO_PROPIA` (igualas, recurrentes, propuestas, salidas, socia) y `pestanasEn` en `lib/pestanas.ts`:
  `accesoEmpresa` las quita fuera de la propia (si se abren en un cliente lleva a `?solo_empire=1` con aviso; los datos que hubiera
  se conservan). `pestanasDePropia` (`lib/acceso.ts`) da al menú lo que la persona ve en la propia: la sección Contabilidad Empire
  muestra siempre sus pestañas («Resumen de Empire», con sus avisos de cobro de `alertasDeEmpresa`) y «Cobros de Empire»: Tareas de
  cobro (`/firma/[fid]/empire/tareas`), Mensajes de cobro (`/firma/[fid]/empire/mensajes`) y Presupuesto (solo administradores; lugar
  reservado hasta el Excel PRESUPUESTO 2026). `plantillas_tarea.seccion` ('firma' | 'empire'; las tres de igualas pasan a 'empire',
  también en `crear_plantillas_tarea`); pantalla común `app/firma/[fid]/tareas/vista.tsx` con «Se ve en» en el cronograma.
  `CLAVES_COBRO`/`esDeCobro` en `lib/mensajes.ts` (cobro de iguala, envío de factura, pago atrasado, pago recibido, cuenta bancaria y
  el correo de la factura); pantalla común `app/firma/[fid]/mensajes/vista.tsx` (los enlaces compartidos quedan en la Firma). La
  propia sale del selector «Viendo» (dentro de ella dice «Contabilidad Empire»), de la lista de Empresas Empire (se sigue eligiendo
  abajo) y de Inicio, Alertas, Documentos, Facturas por revisar, Impuestos del mes, Solicitudes, Trámites, Bitácora y Elegir de la
  Firma. Pruebas `pruebas/rediseno.test.mjs` (226 en total). Probado en pantalla. En `main` y producción el 7-nov-2026 («sí» de
  Patricia, `386b0bd`, con la migración 046). Sigue la R3 (clientes sin asientos) con su «sí»; antes, activar los respaldos.
  «sí» de Patricia del 7-nov a empezar la R3. **R3 · Clientes sin contabilidad** (migración 047): `empresas.lleva_contabilidad`
  (falso por defecto; casilla en Ficha › Relación con Empire, que sustituye a la pregunta 1 de la propuesta: un cliente Prime que sí la
  lleve se marca ahí). `PESTANAS_CONTABLES` (asientos, asientos frecuentes, cierre, diario, mayor, balanza, catálogo, configuración de
  cuentas, bancos) fuera para los clientes sin la marca (`pestanasEn(…, propia, contabilidad)`; abrirlas lleva a
  `?sin_contabilidad=1` con aviso; lo guardado se conserva); sin cliente elegido el menú tampoco las muestra. «Ver asiento» se
  esconde en factura, compra, cobro y pago, y el enlace al mayor en los estados. **Cobros, pagos, CxC y CxP se quedan por ahora:**
  el 606, el IT-1 y el IR-17 toman de ahí la forma y fecha de pago y las retenciones; se quitan cuando el registro de facturas las
  capture, junto con el n.º 9 (facturas y compras sin asiento), después de la R5 (si se dejan de hacer asientos antes, los estados
  financieros del cliente se quedan sin datos). Resumen del cliente (`app/e/[id]/resumen-trabajo.tsx`): facturas subidas y por
  revisar, documentos por procesar, impuestos del mes anterior (`estadoDelMes`) con su tabla, trámites abiertos, pendientes de la
  bitácora y la iguala con Empire (`cuentaConFirma`). Ficha: logo en Datos generales; la casilla «Los asientos requieren aprobación»
  solo en la empresa propia (`CamposFicha conAprobacion`); Relación con Empire muestra la iguala activa del cliente (acuerdo en la
  propia: tipo, servicio, monto, día, tarifa especial, servicios incluidos) con enlace a Igualas. Roles «Cliente · Consulta» y
  «Cliente · Sube documentos» con solo Inicio, Mis facturas, Mis documentos y Mis solicitudes; todo rol de cliente ve el inicio de
  la aplicación (`paraClientes`). 227 pruebas. Probado en pantalla. En `main` y producción el 7-nov-2026 («sí» de Patricia,
  `539e592`, con la migración 047). Sigue la R4 (el trabajo primero) con su «sí».
  «sí» de Patricia del 7-nov a empezar la R4. **R4 · El trabajo primero** (sin migración): la sección Firma del menú va por
  trabajos (Trabajo del mes, Facturas y documentos, Impuestos, Reportes, Expediente y trámites, Cobros y pagos, Contabilidad del
  cliente si la lleva; lo que no tenga lugar va en «Otros»). Lo de todos los clientes abre la pantalla de la firma; lo de un cliente
  abre el cliente elegido arriba o `/firma/[fid]/elegir?a=` (dentro de Empire siempre pide elegir). Ya no hay un bloque del cliente
  con todo adentro. La ficha pasa a Administración (`PESTANAS_ADMINISTRACION` = ficha, usuarios, historial). «Facturas por revisar»
  pasa a **Facturas del cliente** (`/firma/[fid]/facturas-subidas`: cliente elegido adentro, filtros por estado, «Cargar o revisar
  las de…»). Impuestos del mes: cada casilla abre el formulario exacto (`/dgii?mes=&desde=impuestos#f606`, `/dgii/it1`,
  `/dgii/ir17`) y `VolverAImpuestos` (`app/e/[id]/dgii/volver.tsx`) vuelve al tablero en el mismo mes. Documentos recibidos
  (`/firma/[fid]/documentos`, con filtro de cliente): cada foto o PDF se completa y se aprueba ahí (`app/firma/documentos-acciones.ts`:
  `procesarDocumento` crea la factura del cliente con `subirFactura` + `aprobarSubida` → borrador de compra para el 606 o de venta para
  el 607 con el archivo, y deja el documento procesado; `descartarDocumento` con motivo); los estados de banco y contratos se
  procesan en el cliente. 227 pruebas. Probado en pantalla (menú, tablero → IT-1 y vuelta, facturas del cliente, documento → borrador
  de compra B0100000777 con su archivo). En `main` y producción el 7-nov-2026 («sí» de Patricia, `9031dac`). Sigue la R5 (estados
  financieros sin asientos) con su «sí»; después, el n.º 9 (facturas y compras sin asiento, retenciones en el registro) y la R6.
  «sí» de Patricia del 7-nov a empezar la R5. **R5 · Estados financieros sin asientos** (migración 048): `empresa_lleva_contabilidad()`
  (SECURITY DEFINER: la propia o la marca de la ficha; una firma sin propia elegida cuenta a todas sus empresas como clientes, igual que
  el menú de la R3). `saldosPorCuenta` (`lib/reportes.ts`), en un cliente sin contabilidad, no lee asientos: `saldosDeRegistro` arma
  los mismos saldos con `movimientosDeRegistro` (facturas emitidas al haber de su cuenta de ingreso, nota B04/E34 al debe; compras
  registradas al debe de su cuenta con otros impuestos e ITBIS al costo, nota al haber; en pesos; desde el inicio del ejercicio porque
  los años anteriores vienen en el formulario) y el balance de `saldos_registro` (cortes por fecha, RLS e historial; 14 conceptos en
  `CONCEPTOS_BALANCE` de `lib/saldos-registro.ts`, cada uno a su cuenta del catálogo: efectivo 110101, CxC 110201, inventario 110301,
  impuestos a favor 110402, otros 110405, activos fijos 120103, otros 120201, CxP 210101, impuestos 210201, préstamos 210401/220101,
  otros pasivos 210502, capital 310101, años anteriores 310301; vale el último corte ≤ la fecha). Así el estado de resultados, el de
  situación (cuadra con el resultado del ejercicio), el IR-2 (A-1, B-1) y la proyección (`lib/proyeccion.ts` usa `movimientos`)
  funcionan sin asientos; los asientos que tenga el cliente se ignoran, no se borran. Pantalla de estados: «de sus facturas emitidas,
  sus compras registradas y los saldos del balance · preparados por <firma>», solo resultados y situación (flujo y cambios en el
  patrimonio necesitan asientos), recuadro «Saldos del balance» (fecha de corte, conceptos por grupo, CxC y CxP sugeridas de los
  saldos de facturas y compras, notas, cortes guardados, borrar; permiso «registrar»). Excel/PDF con «preparado por <firma>» y, sin
  firma escrita, la firma como «Preparado por». Las pruebas de estados, IR-2 y proyección marcan sus empresas con «lleva
  contabilidad»; nueva `pruebas/estados-registro.test.mjs` (231 en total). Probado en pantalla con Salón Rosa (balance de 6,180 que
  cuadra, descarga, IR-2 A-1, proyección; Empire sigue con asientos y flujo). En `main` y producción el 7-nov-2026 («sí» de Patricia,
  `5d7be77`, con la migración 048). Ojo en producción: sin empresa propia elegida, todas las empresas cuentan como clientes (Goemhy
  incluida); si una lleva contabilidad completa, marcarla en su ficha. Siguen el n.º 9 (facturas y compras sin asiento, retenciones en
  el registro, quitar cobros y pagos) y la R6 (permisos por persona), con su «sí».
  «sí» de Patricia del 7-nov a empezar el n.º 9. **N.º 9 · Facturas y compras sin asiento** (migración 049): en un cliente sin
  contabilidad, `emitir`, `registrarCompra`, `registrarCobro` y `registrarPago` no hacen asiento (`llevaContabilidad`), los cobros y
  pagos no piden cuenta de banco (`cuenta_destino_id`/`cuenta_origen_id` pueden ir vacías) y anular no toca asientos si no hay.
  Las restricciones de emisión y registro ya no exigen asiento; el trigger `documento_sin_asiento` (con `lleva_contabilidad(eid)`,
  SECURITY DEFINER) rechaza un documento sin asiento en una empresa que lleva contabilidad y no deja emitir, registrar, cobrar, pagar
  ni anular con fecha en período cerrado (la regla que con asiento cuida el trigger de asientos). `PESTANAS_CONTABLES` suma cobros,
  anticipos, CxC, pagos, CxP y sus estados de cuenta: el cliente sin la marca ya no los ve. El cobro y el pago se anotan dentro de la
  factura o la compra (`app/e/[id]/pago-en-documento.tsx`, acciones `cobrarFactura`, `pagarCompra`, `anularCobroDeFactura`,
  `anularPagoDeCompra` en `app/e/[id]/registro-pagos-acciones.ts`, permiso «contabilizar» y pestaña Facturas o Compras): fecha, forma
  (cobro: efectivo, transferencia, cheque, tarjeta, permuta u otra; pago: códigos 01–07 del 606), monto que salda (sugerido: el
  saldo), hasta dos retenciones vigentes y referencia; la lista de cobros o pagos muestra forma, retenciones y referencia con
  «Anular». Así el 606, 607, IT-1 e IR-17 siguen saliendo igual. Las pruebas de ventas, compras y propuestas marcan sus empresas con
  «lleva contabilidad»; nueva `pruebas/registro-sin-asiento.test.mjs` (235 en total). Probado en pantalla con Salón Rosa: compra
  registrada sin asiento y pagada con ITBIS retenido 108 (el 606 de noviembre lo toma), factura cobrada en efectivo, menú sin cobros
  ni pagos. En `main` y producción el 7-nov-2026 («sí» de Patricia, `d23bbed`, con la migración 049). Sigue la R6 (permisos por
  persona) con su «sí»; es la última del rediseño.
  «sí» de Patricia del 7-nov a empezar la R6. **R6 · Permisos por persona** (migración 050, `lib/permisos-persona.ts`,
  `app/firma/[fid]/equipo/permisos-persona.tsx`, acción `guardarPermisosPersona`): `miembros_firma` guarda permisos y pantallas propios
  por sección (`permisos_clientes`/`pestanas_clientes` para la Firma y `permisos_empire`/`pestanas_empire` para Contabilidad Empire),
  el alcance (`todos`, `mis_clientes` = donde es responsable, `elegidos` con `clientes uuid[]`), `crear_clientes` y las plantillas
  usadas. En Personas y accesos, cada persona del equipo (no administradora) tiene «Permisos propios»: casillas de permisos y de
  pantallas por grupo, botones «+ <rol>» que suman las casillas del rol sin quitar las marcadas (los roles quedan como plantillas que se
  combinan; cambiar a la persona no cambia el rol), alcance y «Crear clientes». `accesoEmpresa`: en la propia mandan los de Empire; en
  un cliente de su alcance, los de la Firma (perfil «Permisos propios»); si no, su rol cliente por cliente como antes (nada cambia hasta
  marcarlos). `clientesDeFirma`, `pestanasDePropia` y `soloCliente` lo tienen en cuenta. «Registrar» deja borradores y «Contabilizar
  (aprobar)» los emite o postea (lo que registra quien no aprueba queda pendiente). Crear clientes: `Firma.crear_clientes`
  (administradora o la casilla); quien lo crea sin ser administradora queda como responsable y, con alcance «elegidos», lo suma a su
  lista. `equipoDe` ya no incluye a los usuarios de clientes (listas de responsables). Aviso en Personas y accesos con quienes del
  equipo no tienen la verificación en dos pasos y enlace para exigirla. Pruebas `pruebas/permisos-persona.test.mjs` (238 en total).
  Probado en pantalla con una «Sara Secretaria» local (plantilla Coordinadora sin «Contabilizar», todos los clientes, crea clientes):
  ve ambos clientes, su menú sigue sus casillas, una pantalla sin permiso la devuelve con aviso, creó «Cliente de Sara SRL», no llega a
  Personas y accesos. En `main` y producción el 7-nov-2026 («sí» de Patricia, `d851410`, con la migración 050). **Rediseño completo**
  (los 22 cambios de la lista, salvo el n.º 13, generador de documentos = 5b, que espera las plantillas en Word). Vuelve el plan en pausa:
  entrega B (normas y tasas), 5b, 6b, 7b/7c y 8c, cada uno con su «sí». En producción lo hace Patricia: quitar «Manaury Prueba» (Quitar de la
  firma), marcar «Exigir verificación en dos pasos» en Datos de la firma y corregir el RNC repetido de Goemhy y «Gomez Guerrero».
- **Nueva navegación** (aprobada por Joannie el 28-oct-2026, en 3 partes; dijo que la firma se llama **Empire Tax’N Legal**:
  lo cambia ella en Clientes de la firma › Datos de la firma, no se toca la base a mano). Parte 1 (marco único, Inicio de la
  firma, Actividad, Clientes) en `main` (`b328ea3`, 29-oct). Parte 2 (roles con pestañas, roles definidos, Facturación y menú
  reordenado) en `main` (`3b752a1`). Parte 3 (documentos recibidos y portal del cliente) en `main` (`a9aa3f5`, 29-oct).
- **Revisión del 29-oct-2026** (Drive › «5. Revisión de la plataforma, roles e IA»): urgentes (1) respaldos sin funcionar
  (faltan secretos en GitHub y Actions en $0), (2) e-CF obligatorio para micro/pequeños desde el 15-nov-2026 (Aviso DGII 06-26,
  confirmar texto oficial): adelantar PSFE, (3) Vercel Hobby no permite uso comercial: pasar a Pro (hecho: la captura del 30-oct muestra el equipo en Pro). Propuestos y esperando su
  «sí»: roles con permisos y restricciones (Administradora, Contadora, Auxiliar, Facturación opcional, Solo lectura, Cliente ·
  Consulta, Cliente · Sube documentos), menú reordenado (diario arriba, configuración y administración abajo, sin plegables),
  IA según el rol (dice qué rol/quién puede hacerlo; herramientas filtradas por permisos, OWASP LLM06), verificación en dos
  pasos, Excel en todas las listas. Videos con voz: bloqueados por la red (falta permitir la API de Gemini y la llave); herramientas
  y plan en `herramientas/videos/README.md`. El 29-oct Joannie aprobó todo eso, incluido el rol Facturación, y adelantar la e-CF.
  Parte 2 en `main` (`3b752a1`, 29-oct). Voz elegida: **Aoede** (Gemini TTS, ya funciona en el entorno). Joannie pidió **terminar
  primero los pendientes de la plataforma** y grabar los videos al final, con la versión definitiva. Correo a proveedores PSFE
  redactado como borrador en Gmail (sin destinatarios: ella elige a quién enviarlo).
- Antes de facturar de verdad, cada empresa debe cargar sus rangos de NCF autorizados en «Comprobantes NCF».
- **Orden de los pendientes acordado con Joannie (29-oct-2026):** 1) Excel en todas las listas y 2) verificación en dos pasos
  (en `main`, `6c0bf98`, «sí» del 29-oct); 3) Fase 6 Fiscal («sí» del 29-oct; parte 1 606/607/608 en `main` (`133b3af`, «sí» del 29-oct); TXT e IT-1 en `main` (`b8a9abe`, «sí» del 29-oct, junto con el menú móvil de Manaury); IR-17 en `main` (`e4f4e8a`, «sí» del 30-oct); retención de alquileres 15 % (migración 017) en `main` («sí» del 30-oct); sigue ISR anual (IR-2-2026 ya subido; depende de la Fase 7, presentar estructura antes);
  dgii.gov.do responde 403 a descargas automáticas: Joannie sube los archivos) (606/607/608, luego IT-1, IR-17, ISR; presentar estructura
  antes); 4) e-CF (cuando elija el PSFE); 5) Fase 5 Bancos; 6) Fase 7 Estados financieros; 7) Asistente IA por rol (llave de
  Gemini en Vercel, nivel pagado); 8) manuales y videos con la voz Aoede, al final, con la versión definitiva. Aparte: Consola
  de la plataforma (aprobada el 4-nov-2026; entregas 1 y 2 en `main`).

## Cómo trabajar en local

```bash
service postgresql start            # en la nube de Claude hay Postgres 16 instalado
su postgres -c "psql -c \"CREATE ROLE contable LOGIN PASSWORD 'contable' CREATEDB CREATEROLE;\" -c \"CREATE DATABASE contable OWNER contable;\""
echo 'DATABASE_URL=postgres://contable:contable@localhost:5432/contable' > .env.local
npm install
DATABASE_URL=postgres://contable:contable@localhost:5432/contable npm run migrar
DATABASE_URL=postgres://contable:contable@localhost:5432/contable npm test   # 142 pruebas (base, montos, cálculos, fiscal, ventas, compras y seguridad)
npm run build && npx next start -p 3100
PLAYWRIGHT=/opt/node-tools/node_modules/playwright node pruebas/navegador/fase1.cjs   # recorridos completos (base vacía)
PLAYWRIGHT=/opt/node-tools/node_modules/playwright node pruebas/navegador/tributaria.cjs   # crea su propia firma
PLAYWRIGHT=/opt/node-tools/node_modules/playwright node pruebas/navegador/ventas.cjs       # crea su propia firma
PLAYWRIGHT=/opt/node-tools/node_modules/playwright node pruebas/navegador/compras.cjs      # crea su propia firma
# también: acceso, firma, roles, documentos, dos-pasos, bancos, conciliacion, estados, ir2 y dgii (cada uno crea su propia firma; dgii, conciliacion, estados e ir2 con --experimental-strip-types)
```

Ojo: con FORCE RLS, consultar las tablas con `psql` como dueño devuelve 0 filas si no se fija antes
`SELECT set_config('app.empresa_id', '<uuid>', true)` dentro de una transacción.

## Otros proyectos de esta misma línea de trabajo

- **empire-web** (`enfocatutalentord-cmyk/empire-web`): web de Empire Tax’N Legal, publicada en
  https://www.empiretaxnlegal.com.do. Su estado está en el `CLAUDE.md` de ese repositorio.
- `enfoca-panel` y `enfoca-talent-intelligence-platform`: Joannie pidió **no tocarlos** en esta línea de trabajo.
