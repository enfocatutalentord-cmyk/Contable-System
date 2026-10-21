# Contable-System

Sistema contable para empresas en República Dominicana. Next.js + TypeScript + Postgres, publicado en Vercel.

## Fase 1 (base)

- Cuentas de usuario y varias empresas por usuario, con roles: dueño, contador, auxiliar y solo lectura.
- Catálogo de cuentas dominicano por niveles (clase, grupo, subgrupo, detalle), ampliable con subcuentas.
- Asientos de diario con número consecutivo, validación de cuadre y anulación con motivo (no se borran).
- Libro diario, libro mayor y balanza de comprobación, con descarga para Excel.
- Cierres de período con fecha de bloqueo (como las «lock dates» de Xero) e historial.

### Seguridad de los datos

- Cada empresa está aislada en la base con Row Level Security: la app trabaja con el rol `contable_app`,
  que solo ve la empresa en curso.
- Las reglas contables las hace cumplir la base aunque la app falle: el asiento debe cuadrar, solo cuentas de
  detalle activas, nada se crea, cambia ni anula en un período cerrado, y los asientos no se borran.
- Contraseñas con scrypt; sesiones en cookie httpOnly guardadas como hash.

## Desarrollo

```bash
cp .env.example .env.local   # y pon tu DATABASE_URL
npm install
npm run migrar
npm run dev
```

Pruebas (usan la base de `DATABASE_URL` y limpian lo que crean):

```bash
npm test
```

## Publicación en Vercel

1. En el proyecto de Vercel: **Storage → Create Database → Neon (Postgres)** y conéctala al proyecto.
   Eso crea `DATABASE_URL` en las variables de entorno.
2. Cada publicación de producción aplica las migraciones pendientes (`vercel-build`) antes de compilar.
   Las vistas previas no tocan la base de producción.
