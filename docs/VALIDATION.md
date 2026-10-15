# Validación operativa local de Rayo

Validación realizada el 14 de octubre de 2026. La ejecución predeterminada utiliza PostgreSQL y no crea usuarios ni viajes de demostración.

## Pruebas automatizadas

21 pruebas aprobadas, sin omisiones, ejecutadas con una base PostgreSQL de pruebas aislada. Cubren identidad, verificación y recuperación de un solo uso, revocación de sesiones y streams, permisos, asignación exclusiva, cotizaciones, licencias, privacidad del seguimiento, eventos entre réplicas, preferencias, soporte, auditoría y outbox persistente.

Los pagos se prueban con respuestas controladas de Stripe y firmas verificadas por su SDK: importes, idempotencia, conciliación y protección ante cobros duplicados y actualizaciones atrasadas. La prueba del reembolso concurrente reproduce el fallo al retirar la corrección y pasa al restaurarla. Estas pruebas no hacen cobros reales.

Las diez pruebas heredadas conservan cobertura del modo demo explícito; las otras once cubren los componentes operativos. Los datos de las pruebas se eliminan al terminar y no crean cuentas en la base de uso local.

## Entorno local

PostgreSQL, API y panel se ejecutan localmente. Mailpit captura SMTP en el equipo sin entregar correo externo. No hay administrador predeterminado: el operador debe crear el suyo con el procedimiento de README.md.

Se incluyen contenedores, proxy HTTPS, monitoreo y herramientas de copia/restauración. Docker y Compose están instalados y se ejecutaron con Colima (perfil rayo, 2 CPU/4 GB). Se construyeron las imágenes backend y panel; arrancaron PostgreSQL, migraciones, auth, trips, tracking, ops, gateway, worker, panel, Caddy y Mailpit. El panel y /health respondieron 200; /api/me, /api/trips y login inexistente devolvieron 401. Se levantaron dos réplicas de auth/trips/tracking/ops. La copia pg_dump se restauró en una base temporal, verificando las tres migraciones y cero usuarios, y se eliminó esa base temporal. No se ha desplegado un dominio público.

## Límites de comprobación

La compilación del panel, la comprobación TypeScript móvil y la exportación Expo web se validan localmente. Expo prebuild generó correctamente los proyectos Android/iOS en una copia temporal; se verificaron los permisos Android de ubicación y el modo location de iOS. No se han compilado ni probado builds nativos firmados Android/iOS. Faltan Xcode completo y Android SDK/adb en este equipo. GPS de segundo plano, permisos en dispositivos reales y recepción de push requieren esas pruebas.

Mapbox, Stripe y Expo Push requieren credenciales propias; no se han activado con cuentas reales. El correo externo requiere sustituir Mailpit por un servidor SMTP. Las rutas y tarifas operativas se rechazan si falta configuración; no se sustituyen por simulaciones.

## Dependencias

La auditoría local de dependencias de producción del backend y del panel reportó cero vulnerabilidades. La actualización acotada de uuid bajo xcode redujo el árbol completo de 22 a 15 avisos altos, sin moderados. Los avisos restantes derivan de braces y node-forge, sin parches publicados en la consulta realizada. Se requiere revisar esa deuda antes de distribuir las aplicaciones móviles. Véanse DEPENDENCIES.md y DEVICE-TESTS.md.
