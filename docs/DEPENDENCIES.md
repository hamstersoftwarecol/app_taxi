# Revisión de dependencias móviles

Revisión local del 14 de octubre de 2026.

Se sustituyó uuid 7.0.3 por 11.1.1 únicamente bajo xcode mediante overrides. Ese consumidor utiliza v4; se verificaron 100 identificadores de proyecto válidos y la generación completa Android/iOS con Expo prebuild. No se degradó Expo ni React Native.

La auditoría del monorepo pasó de 22 avisos (15 altos, 7 moderados) a 15 altos y cero moderados. Son dos vulnerabilidades de origen con propagación a sus consumidores transitivos:

- [braces GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): agotamiento de pila con patrones profundamente anidados. La versión publicada más reciente consultada es 3.0.3 y está afectada. Llega mediante micromatch/Metro.
- [node-forge GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv): verificación RSA incorrecta. La versión publicada más reciente consultada es 1.4.0 y está afectada. Llega mediante herramientas CLI y firma de Expo.

Ambos avisos indican que no hay versión corregida publicada. No se aplicaron reemplazos no verificados ni se ocultaron avisos. npm audit fix --force propone degradaciones incompatibles de Expo/React Native y no es la solución adoptada.

Las auditorías de producción del backend y del panel reportaron cero vulnerabilidades. Los avisos móviles siguen abiertos; la comprobación de generación de proyectos no equivale a una revisión de seguridad de los binarios. Revisarlos de nuevo antes de distribuir builds y no exponer Metro/Expo de desarrollo públicamente.

Para repetir: ejecutar npm audit desde la raíz y npm ls uuid node-forge braces. Al existir parches publicados, actualizar las dependencias, comprobar compatibilidad Expo, regenerar proyectos y ejecutar las pruebas en dispositivos descritas en DEVICE-TESTS.md.
