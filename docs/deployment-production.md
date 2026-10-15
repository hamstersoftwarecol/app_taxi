# Despliegue preparado; uso exclusivamente local

Esta entrega prepara archivos para ejecutar Rayo en el computador y, posteriormente, en un servidor. No se ha desplegado infraestructura, configurado DNS ni activado proveedores. Docker/Compose y Buildx se instalaron con Homebrew y se ejecutaron con Colima, perfil rayo. Las imágenes y el arranque conjunto están validados localmente; el despliegue público sigue pendiente.

## Arranque local

Desde la raíz del repositorio:

```sh
node deploy/init-local.mjs
deploy/compose.sh config --quiet
deploy/compose.sh up --build -d
```

`init-local` crea `deploy/.local/.env.local` con permisos 0600 y secretos aleatorios, sin imprimirlos. Falla si ese archivo ya existe para evitar cambiar por accidente la contraseña de un volumen persistente. No versionar `.local/`, copias ni secretos. El wrapper entrega ese archivo a Compose como archivo de interpolación y a los servicios como configuración privada; admite otra ruta absoluta mediante `DEPLOY_ENV`.

Abrir [Rayo local](http://localhost:8080), [bandeja Mailpit](http://localhost:8025) y, si hace falta inspección de datos, PostgreSQL en `127.0.0.1:55432`. La clave PostgreSQL está en el archivo privado. Mailpit recibe SMTP en `mailpit:1025` dentro de la red; no envía correos a Internet. Registro, confirmación y recuperación se pueden comprobar desde su bandeja local. HTTP local no ofrece HTTPS público. Los servicios siguen en `RAYO_MODE=production`, sin semillas ni cuentas demo, y el overlay local usa `NODE_ENV=development` para cookies de localhost y SMTP local sin TLS.

`PUBLIC_APP_URL=http://localhost:8080` coincide con la entrada del proxy. No cambiar a `127.0.0.1` durante una sesión sin actualizar origen/cookies. Para pruebas con Expo, configurar su URL de API explícitamente; los puertos del backend permanecen privados. Cartografía, cotizaciones y pagos exigen cuentas y configuración reales; no se activan por levantar estos contenedores.

## Crear el primer administrador

No existe usuario ni contraseña predeterminada. El comando CLI recibe `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` del entorno del operador. La contraseña debe ser fuerte. Para evitar escribirla en el historial, en Bash:

```bash
read -r -p 'Correo administrador: ' ADMIN_EMAIL
read -r -p 'Nombre administrador: ' ADMIN_NAME
read -r -s -p 'Contraseña: ' ADMIN_PASSWORD; printf '\n'
export ADMIN_EMAIL ADMIN_NAME ADMIN_PASSWORD
deploy/compose.sh run --rm -e ADMIN_EMAIL -e ADMIN_NAME -e ADMIN_PASSWORD auth node scripts/bootstrap-admin.mjs
unset ADMIN_EMAIL ADMIN_NAME ADMIN_PASSWORD
```

Es idempotente por correo administrador y no modifica la contraseña de un administrador existente. Nunca registrar administradores mediante HTTP.

## Arquitectura y operación

`deploy/compose.yaml` define PostgreSQL17 persistente, un trabajo de migración y servicios separados: auth3101, trips3102, tracking3103, ops3104, gateway3100 y worker sin puerto. La migración espera salud de PostgreSQL y todos los procesos esperan que termine correctamente. El administrador Next se construye en otra imagen. Solo los proxies publican puertos: local8080 o futuro Caddy80/443. Los puertos de PostgreSQL/Mailpit locales se enlazan exclusivamente a loopback.

```sh
deploy/compose.sh ps
deploy/compose.sh logs --tail=100 gateway auth worker
deploy/compose.sh down
```

`down` conserva el volumen PostgreSQL. No usar `down -v` salvo que se quiera eliminar expresamente los datos. Reiniciar o recrear contenedores conserva sesiones, viajes y correo encolado. Los logs rotan por tamaño; evitar copiar el archivo privado o URLs con tokens a incidencias.

## Observabilidad opcional local

El generador prepara un token privado para `/metrics`, su archivo para Prometheus y una clave aleatoria de Grafana. El token del archivo y `METRICS_TOKEN` deben coincidir. Si se rotan, sustituir ambos y recrear gateway/Prometheus. El archivo individual es legible dentro del contenedor y su directorio en el host es 0700.

```sh
DEPLOY_MONITORING=true deploy/compose.sh up -d
```

Grafana queda en [localhost:3001](http://localhost:3001); sus credenciales están en el archivo privado. Prometheus no publica puerto. Su recolección consulta gateway3100 con `Authorization: Bearer` desde un archivo secreto, no desde la configuración YAML. Se provisiona la fuente Prometheus; los paneles operativos se crean según las métricas emitidas por la aplicación.

## Copias y recuperación

```sh
deploy/backup.sh
```

La copia utiliza `pg_dump` de PostgreSQL17 dentro del contenedor, formato custom, sin contraseñas en argumentos. Se escribe primero a un archivo parcial con permisos privados y solo se renombra si termina correctamente. Por defecto guarda en `deploy/.local/backups` y elimina únicamente dumps propios de más de 14 días, después de una copia exitosa. Se puede definir `BACKUP_DIR` absoluto y `BACKUP_RETENTION_DAYS` entero positivo. La copia local no protege frente a pérdida del computador: el operador debe trasladarla cifrada a almacenamiento independiente y restringir su acceso. Automatizar diariamente con el programador del host después de probar la restauración.

Probar primero en una base separada. Para reemplazar la base configurada, detener escritores y exigir confirmación explícita:

```sh
deploy/compose.sh stop gateway auth trips tracking ops worker admin
CONFIRM_RESTORE=YES deploy/restore.sh --confirm-replace-database /ruta/absoluta/rayo-fecha.dump
deploy/compose.sh run --rm migrate
deploy/compose.sh up -d
```

`pg_restore --clean --if-exists --single-transaction --exit-on-error` reemplaza los objetos del dump y aborta ante un error. El wrapper se conecta a la base de `DEPLOY_ENV`; comprobar ese archivo y el destino antes de confirmar. Después verificar salud, login con cuenta existente, viajes, pagos y cola de correo. La frecuencia de copias define la pérdida potencial de datos; medir tiempo de restauración antes de establecer compromisos de recuperación. Las credenciales de proveedores no están dentro del dump y requieren respaldo privado independiente.

## Activación pública futura: requiere decisión posterior

No ejecutar todavía. Preparar un archivo privado distinto con secretos fuertes, `DOMAIN`, `ACME_EMAIL`, `PUBLIC_APP_URL=https://dominio`, `CORS_ORIGINS` exactos y credenciales PostgreSQL. `DATABASE_URL` debe apuntar al nombre interno `postgres`. La clave de la URL requiere codificación porcentual si contiene caracteres reservados; generar contraseñas hexadecimales evita ese problema. Definir SMTP real con TLS, remitente verificado, tokens Mapbox restringidos y reglas tarifarias de operación. Pagos requieren claves/webhook Stripe y la configuración comercial correspondiente. Ningún proveedor se activa automáticamente.

El operador debe disponer de servidor, dominio/DNS, puertos80/443 y autorización de despliegue. Caddy solicita certificados ACME únicamente al arrancar la variante pública. Mantiene HSTS en HTTPS, proxy WebSocket y salida SSE inmediata; `/api` y `/health` van al gateway, el resto al administrador. `/metrics` no se publica por el proxy.

Una vez autorizado y con esos requisitos revisados:

```sh
DEPLOY_TARGET=production DEPLOY_ENV=/ruta/privada/production.env deploy/compose.sh config --quiet
DEPLOY_TARGET=production DEPLOY_ENV=/ruta/privada/production.env deploy/compose.sh up --build -d
```

La variante pública fuerza `NODE_ENV=production`, nunca activa Mailpit ni publica PostgreSQL. Antes de cualquier publicación, construir y probar imágenes, comprobar webhooks/HTTPS, restaurar una copia en otro entorno y fijar las imágenes a versiones/digests revisados. La configuración de observabilidad es opcional y sus interfaces siguen privadas.

Referencias oficiales: [Compose y dependencias](https://docs.docker.com/reference/compose-file/services/), [perfiles Compose](https://docs.docker.com/reference/compose-file/profiles/), [proxy Caddy/SSE/WebSocket](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [cabeceras Caddy](https://caddyserver.com/docs/caddyfile/directives/header), [autorización Prometheus](https://prometheus.io/docs/prometheus/latest/configuration/configuration/).

## Ejecución local validada en este equipo

El perfil Colima rayo usa 2 CPU, 4 GB RAM y disco de 25 GB. Los secretos del conjunto se generaron en deploy/.local/.env.local y están excluidos de Git y del contexto Docker. La instalación local original en el puerto 3000 mantiene su propia base.

Para evitar conflictos con PostgreSQL y Mailpit locales, el conjunto validado usa panel/proxy 8080, PostgreSQL 55433 y bandeja Mailpit 8026, todos en loopback:

```sh
colima start rayo
LOCAL_POSTGRES_PORT=55433 LOCAL_MAILPIT_PORT=8026 DOCKER_CONTEXT=colima-rayo sh deploy/compose.sh up -d --build
LOCAL_POSTGRES_PORT=55433 LOCAL_MAILPIT_PORT=8026 DOCKER_CONTEXT=colima-rayo sh deploy/compose.sh ps
```

LOCAL_HTTP_PORT también es configurable (8080 por defecto). Si se cambia, ajustar PUBLIC_APP_URL y CORS_ORIGINS en el archivo privado. Mantener las mismas variables de puerto al operar el conjunto.

Se comprobaron migraciones, respuestas HTTP, dos réplicas por servicio de identidad/movilidad/seguimiento/operaciones, backup y restauración en una base temporal. No se activó el overlay público HTTPS ni el perfil opcional Prometheus/Grafana.

Para detener los contenedores sin borrar datos:

```sh
LOCAL_POSTGRES_PORT=55433 LOCAL_MAILPIT_PORT=8026 DOCKER_CONTEXT=colima-rayo sh deploy/compose.sh down
colima stop rayo
```
