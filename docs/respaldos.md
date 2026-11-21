# Copias de seguridad y recuperación

Hay dos capas. (La copia la saca el usuario dueño de Neon, que puede leer todas las empresas aunque la base las aísle;
un usuario sin ese privilegio no podría copiarlas.)

1. **Restauración a un momento anterior (Neon).** Neon guarda el historial de cambios de la base y permite volver a un
   momento anterior o crear una rama de la base en ese punto (Neon Console → Branches → Restore). La ventana disponible
   depende del plan de Neon.
2. **Copia quincenal cifrada (GitHub Actions, `.github/workflows/respaldo.yml`).** Los días 1 y 15 de cada mes a las
   5:17 a. m. saca una copia completa, **la restaura en una base de prueba y compara las cantidades** (empresas, asientos,
   líneas, documentos, usuarios); si no coinciden, falla y GitHub avisa por correo. La copia se guarda cifrada (AES-256)
   90 días como artefacto de la ejecución (quedan unas seis a la vez). Se pidió quincenal y no diaria (21-nov-2026); entre
   una copia y otra el respaldo es el historial de Neon (capa 1), y antes de un cambio grande se puede sacar una a mano
   con **Run workflow**. Para volver a diaria o pasar a mensual, solo cambia la línea `cron` del archivo
   (`"17 9 * * *"` diaria, `"17 9 1 * *"` mensual).

## Activarla (una vez)

En GitHub → repositorio → **Settings → Secrets and variables → Actions → New repository secret**:

- `DATABASE_URL`: la cadena de conexión **directa** de Neon (en Vercel aparece como `DATABASE_URL_UNPOOLED`, o en Neon →
  Connect → sin «Connection pooling»).
- `RESPALDO_CLAVE`: una frase larga. **Guárdala también fuera de GitHub** (gestor de contraseñas): sin ella la copia no se abre.

Después: **Actions → Respaldo quincenal → Run workflow** para probarla.

## Restaurar una copia

```bash
# 1. Descargar el artefacto de Actions y descifrar
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in respaldo-AAAA-MM-DD.dump.enc -out respaldo.dump -pass pass:'LA_CLAVE'
# 2. En una base vacía de Neon (por ejemplo, una rama nueva), con el mismo usuario dueño que producción
psql "$DESTINO" -c "CREATE ROLE contable_app NOLOGIN NOBYPASSRLS" -c "GRANT contable_app TO CURRENT_USER"   # si no existe
pg_restore --no-owner --dbname="$DESTINO" respaldo.dump   # incluye los permisos de contable_app
# 3. Apuntar DATABASE_URL de Vercel a esa base y volver a publicar.
```
