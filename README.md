# Rayo · Plataforma operativa de taxis

Panel Next.js, aplicación Expo para Android/iOS/web y servicios de identidad, movilidad, seguimiento, operaciones y gateway. El arranque normal usa **PostgreSQL sin usuarios, conductores o viajes de demostración**. No existe acceso automático al panel.

## Estado de esta entrega

Implementadas las integraciones y sus flujos de configuración: Mapbox para cartografía/geocodificación/rutas, Stripe Checkout con firma de webhooks y conciliación, GPS nativo de segundo plano, Expo Push, SMTP, sesiones revocables, auditoría, soporte y preferencias persistidas. Preparados Docker/Caddy HTTPS y monitoreo. El usuario eligió **operación local por ahora**: no se publicó ningún dominio ni se activaron proveedores con credenciales inventadas.

Sin las claves correspondientes, las integraciones muestran un error de configuración; no se sustituyen por datos o pagos falsos. Las pruebas de integraciones financieras usan fixtures controlados, nunca cobros reales. Consulta [validación](docs/VALIDATION.md) y [activación](docs/ACTIVATION.md).

## Ejecutar localmente

Requiere Node.js24 y PostgreSQL17. En macOS puede instalarse PostgreSQL con Homebrew; Docker es la alternativa documentada más abajo.

```sh
npm install
npm run setup:local
npm run db:migrate
npm run dev
```

`setup:local` crea un clúster exclusivo en `.local/postgres`, accesible solo en `127.0.0.1:55432`, con contraseña aleatoria y autenticación SCRAM. Crea `.env` privado y configura `apps/mobile/.env.local` sin sustituir valores existentes. No crea usuarios de la aplicación. No inicia servicios al arrancar el sistema.

- Panel: **http://localhost:3000**
- API: **http://localhost:3100**
- Liveness: **http://localhost:3100/health**
- Readiness y conectores: **http://localhost:3100/ready**

El proceso local levanta los cinco servidores HTTP y el trabajador de comunicaciones/conciliación. Cada servicio también tiene ejecución independiente. Los archivos SQLite antiguos se conservan para la demo explícita; sus cuentas y datos ficticios **no se importan** a la base operativa.

### Crear el primer administrador

No hay contraseña predeterminada. Guarda una contraseña propia en un archivo privado fuera del código (12–128 caracteres, con mayúscula, minúscula, número y símbolo) y ejecuta:

```sh
ADMIN_EMAIL=tu-correo@empresa.com ADMIN_NAME='Tu nombre' ADMIN_PASSWORD_FILE=/ruta/privada/clave.txt npm run admin:create
```

El comando no imprime la contraseña ni cambia la de una cuenta existente. Después inicia sesión en el panel con esa cuenta. `ADMIN_PASSWORD` también se admite para gestores de secretos; evita escribir secretos directamente en el historial del terminal. El administrador inicial se crea verificado mediante este procedimiento local de confianza; los registros públicos solo permiten pasajero o conductor.

### Correo local

Para probar verificación y recuperación sin enviar mensajes a Internet, instala Mailpit y ejecuta en otra terminal:

```sh
npm run dev:mail
```

Configura en `.env` `SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025`, `SMTP_FROM=Rayo <no-reply@rayo.local>` y `SMTP_REQUIRE_TLS=false`, solamente para el entorno local. La bandeja está en **http://localhost:8025**. Mailpit captura el mensaje SMTP; no lo entrega a los destinatarios externos. En esta sesión se dejó la bandeja local funcionando.

El envío usa un outbox PostgreSQL con reintentos, recuperación de trabajos interrumpidos y registros fallidos visibles en Operación. Los tokens de verificación son de un único uso, vencen y no aparecen en respuestas API ni en los logs de petición. Los enlaces perdidos pueden reenviarse mediante `/api/resend-verification`.

## Mapbox y tarifas

Añade a `.env` `MAPBOX_TOKEN` para geocodificación/rutas y `MAPBOX_PUBLIC_TOKEN` de tipo `pk.` para renderizar mapas. Restringe los tokens a los orígenes y permisos necesarios en tu cuenta. Nunca se expone el token privado al cliente.

Configura `FARE_RULES_JSON` por categoría, con `base`, `perKm`, `perMinute` y `minimum`. Ejemplo únicamente ilustrativo, que debe ajustarse a las reglas autorizadas de tu operación:

```dotenv
FARE_RULES_JSON={"mini":{"base":4000,"perKm":1500,"perMinute":250,"minimum":7000},"sedan":{"base":5000,"perKm":2000,"perMinute":300,"minimum":10000},"suv":{"base":7000,"perKm":2500,"perMinute":350,"minimum":14000}}
```

Sin tarifas configuradas no se cotiza. El servidor consulta Mapbox, guarda la ruta y calcula el importe. La cotización vence a los cinco minutos y solo puede consumirse una vez. El cliente no puede fijar el precio. Un cambio de categoría/origen/destino exige cotizar de nuevo.

## Pasajeros, conductores y GPS

El registro requiere correo confirmado. Un conductor registra placa, vehículo, categoría, número de licencia y vencimiento; un administrador revisa la solicitud en Conductores. Esa aprobación es **manual**, no una consulta automática a registros gubernamentales ni una comprobación biométrica. Solo conductores aprobados y con licencia vigente pueden conectarse, aceptar e iniciar viajes. La base impide asignar un conductor a dos viajes activos.

```sh
npm run start -w apps/mobile
npm run web -w apps/mobile
```

La URL de API es obligatoria mediante `EXPO_PUBLIC_API_URL`. El instalador local configura `http://localhost:3100` para la vista web/iOS Simulator. Android emulado usa `http://10.0.2.2:3100`; un teléfono físico necesita la IP LAN del computador y `API_HOST=0.0.0.0`, con acceso limitado a tu red. Reinicia Expo al cambiar variables.

GPS y push necesitan **development build y dispositivo compatible**, no Expo Go. El conductor solicita explícitamente los permisos de ubicación y segundo plano; Android muestra servicio persistente e iOS el indicador de ubicación. Salir de servicio o de sesión detiene el seguimiento. Un 401/403 también lo detiene. La API valida precisión, fecha, orden de las muestras, rol y aprobación. Los pasajeros solo reciben ubicaciones de viajes activos propios.

Cartografía móvil: MapboxGL dentro de WebView restringida, con GPS nativo de Expo; no requiere una clave adicional de Google Maps. Configura `EXPO_PUBLIC_EAS_PROJECT_ID` para push, y tus identificadores/certificados para distribuir builds. No se han firmado instaladores Android/iOS en este entorno. Más detalle en [clientes](docs/clients-production.md).

## Pagos y conciliación

Configura `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` usando primero el modo de pruebas de tu cuenta. Endpoint de webhook: **`/api/webhooks/stripe`**. Eventos soportados: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed` y `charge.refunded`.

Stripe aloja la captura de datos de tarjeta; Rayo no recibe números de tarjeta. La firma se verifica sobre el cuerpo crudo. Se deduplican eventos y se comprueba propietario, moneda e importe. Los importes de negocio se guardan en pesos COP; los importes/comisiones de Stripe se guardan en unidades menores y se convierten al mostrarlos.

Antes de renovar un Checkout se consulta su estado real bajo bloqueo. Un pago confirmado o con reembolso no crea otro cobro; se conserva el historial de intentos. La conciliación no puede revertir una confirmación por una respuesta atrasada. Los viajes con tarjeta requieren pago confirmado antes de iniciarse. Si se cancela un viaje ya pagado, el trabajador solicita un reembolso idempotente y concilia su resultado; no se presenta como reembolsado antes de la confirmación del proveedor.

Operación permite revisar pagos y discrepancias, conciliar Stripe y registrar efectivo recibido en viajes completados. Los indicadores de cobros confirmados no se calculan únicamente a partir del estado del viaje. Esto no sustituye un sistema contable o fiscal externo.

## Notificaciones y soporte

Activa `EXPO_PUSH_ENABLED=true`, configura EAS/APNs/FCM para tu proyecto y `EXPO_ACCESS_TOKEN` si habilitaste seguridad de acceso a Expo Push. El usuario autoriza notificaciones mediante un botón. Los dispositivos quedan vinculados a la sesión. El trabajador vuelve a comprobar que la sesión no esté revocada antes de enviar, consulta recibos y retira dispositivos no registrados.

Las preferencias viven en PostgreSQL por usuario. Los pasajeros/conductores crean tickets de soporte y consultan los suyos; administración responde y resuelve. Con `SUPPORT_EMAIL` y SMTP configurados se envían avisos al equipo y respuestas al usuario. El ticket se conserva aunque la entrega de correo falle.

## Auditoría, monitoreo y réplicas

`audit_log` conserva acciones y no admite UPDATE/DELETE mediante su protección de base. La API administrativa muestra acciones, recursos y actor, sin contraseñas/tokens. Logs de petición estructurados contienen identificador, método, estado y duración, sin cuerpo ni URL con tokens.

`/metrics` requiere `Authorization: Bearer METRICS_TOKEN` y expone solicitudes, tiempos, conectividad PostgreSQL y trabajos pendientes/fallidos. Hay configuración Prometheus/Grafana y retención de logs. Las sesiones se consultan en cada petición; los streams se cierran al vencer y comprueban revocación periódicamente (hasta tres segundos).

Los eventos se coordinan con PostgreSQL LISTEN/NOTIFY. Los clientes vuelven a leer datos con permisos actuales y hacen sincronización periódica: una notificación no es el almacenamiento del evento. Los trabajos se reclaman con `FOR UPDATE SKIP LOCKED`; los bloqueos/índices de PostgreSQL protegen las reservas entre réplicas. Ajusta el total de conexiones según servicios y réplicas; cada pool requiere al menos dos conexiones.

## Docker, HTTPS y despliegue futuro

Lee [el runbook](docs/deployment-production.md). `deploy/compose.sh up -d --build` configura HTTP local, PostgreSQL, Mailpit y cinco servicios separados más worker/frontend. El overlay de producción añade Caddy con certificados ACME automáticos, y monitoring es opcional. `.env.production.example` enumera configuración; nunca contiene claves reales.

Solo el proxy debe exponerse públicamente. PostgreSQL, servicios y métricas quedan internos. Hay backup/rotación y restauración con confirmación explícita. Docker se validó con Colima: imágenes construidas, servicios iniciados y respaldo/restauración comprobados en una base temporal. El conjunto Docker usa una base separada de la instalación local. Consulta el runbook para sus puertos. El usuario eligió solo local: no se modificó DNS, no se emitió un certificado público y no se desplegó en un servidor externo.

## Verificación

```sh
npm test
TEST_DATABASE_URL=postgresql://usuario:clave@127.0.0.1:puerto/base_pruebas npm run test:production
npm run build
npx tsc --noEmit -p apps/mobile/tsconfig.json
npm run export:web -w apps/mobile
```

Las pruebas operativas necesitan PostgreSQL real; no reutilizan `DATABASE_URL`. Usan esquemas aislados y los eliminan al finalizar. Sin `TEST_DATABASE_URL`, la suite común indica explícitamente las pruebas omitidas. [Resultado y límites de validación](docs/VALIDATION.md).

## Demo histórica explícita

`npm run dev:demo` activa el backend SQLite histórico para las pruebas del prototipo. Los clientes actuales ya requieren contratos operativos (cotizaciones y sesiones reales), por lo que esa modalidad no es una alternativa al flujo de producción. No se usa como fallback ni se importa al PostgreSQL operativo.
