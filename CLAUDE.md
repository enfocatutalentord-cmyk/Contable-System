# Contable-System: estado del proyecto y forma de trabajo

Este archivo es el punto de partida para seguir el trabajo desde cualquier sesión o plataforma.
Actualízalo al terminar cada bloque de trabajo (qué se hizo, qué quedó pendiente, qué decidió Joannie).

Última actualización: 4-nov-2026 (IR-2 completo y Consola de la plataforma completa en `main`; e-CF para después, pedido del 4-nov; respaldos sin activar).

## Con quién y cómo

- Se trabaja con **Joannie** (Enfoca Tu Talento). Responder siempre en **español**, con tono humano, claro y sin tecnicismos
  innecesarios. Explicar los pasos en el panel (Vercel, GitHub, midominio.do) uno por uno, con lo que hay que hacer clic.
- La cuenta de la app en producción la abrió **Manaury Enrique Gómez Guerrero**, con la empresa **Goemhy Services** (RNC 132151119).
- **Nunca pasar nada a `main` sin el «sí» de Joannie.** Se trabaja en la rama `claude/gallant-bell-4ejogr` y se pasa a `main`
  (fast-forward) solo cuando ella lo aprueba. `main` publica solo en producción.
- Todo lo que se proponga debe basarse en lo que hoy usan las plataformas líderes y mejor valoradas (G2, Capterra, casos
  publicados), citando la fuente. Referentes elegidos: **Xero** (G2 4.4, fechas de bloqueo, conciliación con reglas),
  **QuickBooks Online** (G2 4.0, centro de reportes, antigüedad de saldos, portal del contador) y **Alegra** (referente en RD,
  606/607/608 y e-CF).
- No inventar datos, montos ni resultados. Antes de decir que algo funciona, probarlo.

## Documento rector

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
