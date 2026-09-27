# Rodillo IRONMAN — app de control para el Elite Direto XR-T

> **Probar sin instalar nada:** abre la URL de GitHub Pages del repo en Chrome/Edge
> (Android u ordenador), pulsa "🚴 Rodillo", elige el Direto y un entreno.

App web (funciona en el navegador, instalable como si fuera una app) para controlar
el rodillo en modo ERG, grabar potencia/cadencia/velocidad/FC y ver gráficas de la
sesión — sin depender de la app de pago de Elite.

## Qué hace (v1)

- Conecta con el rodillo por Bluetooth (protocolo estándar **FTMS**, lo entienden
  prácticamente todos los rodillos inteligentes, incluido el Direto XRT).
- Conecta con la FC por Bluetooth (el reloj Garmin, con "Emitir FC" activado, o un
  pulsómetro de pecho si lo tienes en el futuro).
- Controla el rodillo en modo ERG: le manda el vatiaje objetivo de cada bloque del
  entreno automáticamente, incluidas rampas de calentamiento.
- 4 entrenos de ejemplo con tus vatios actuales (FTP 256W), y un editor para crear
  los tuyos (nombre, tipo de bloque, minutos, vatios de inicio/fin).
- Pantalla en directo: potencia, objetivo, cadencia, FC, velocidad, cuenta atrás del
  bloque, gráfico en vivo, ajuste manual ±5W, pausa.
- Al terminar: resumen con medias por bloque comparadas contra el objetivo, gráfico
  completo de la sesión, y exportación a CSV.
- Historial de sesiones guardado en el propio navegador (no se pierde al cerrar la
  pestaña, pero es local a ese dispositivo/navegador — ver limitaciones).
- Instalable como app (PWA): "Añadir a pantalla de inicio" en el móvil.

## Cómo publicarla (GitHub Pages, gratis, 5 minutos)

(Si el repo ya está subido, solo falta el paso 4.)

1. Entra en [github.com](https://github.com) e inicia sesión (o crea una cuenta).
2. Crea un repositorio nuevo, por ejemplo `rodillo-ironman` (puede ser público o
   privado — con privado también funciona GitHub Pages).
3. Sube TODOS los archivos de esta carpeta a ese repositorio (botón "Add file" →
   "Upload files" en la web de GitHub, arrastra la carpeta entera).
4. Ve a **Settings → Pages** del repositorio. En "Source" elige la rama `main` y
   la carpeta `/ (root)`. Guarda.
5. Espera un minuto y GitHub te da una URL tipo
   `https://<tu-usuario>.github.io/rodillo-ironman/`. Esa es tu app, para siempre,
   gratis, con HTTPS (necesario para que funcione el Bluetooth).
6. Ábrela en Chrome del móvil (Android) y en Chrome/Edge del ordenador. En el móvil,
   menú (⋮) → "Añadir a pantalla de inicio" para tenerla como un icono más.

Cuando quieras que te actualice la app más adelante, solo tengo que subir los
archivos nuevos a ese mismo repositorio y la URL se actualiza sola.

## Requisitos importantes

- **Solo funciona en Chrome o Edge, en Android o en el ordenador.** Web Bluetooth
  no existe en iOS (ni Safari ni Chrome de iPhone) ni en Firefox — es una limitación
  de esos navegadores, no de la app.
- El rodillo y el pulsómetro se emparejan **desde la propia app**, no hace falta
  emparejarlos antes en los ajustes de Bluetooth del sistema.
- Actívale al reloj "Emitir FC" (Ajustes → Sensores y accesorios → FC de muñeca →
  Emitir FC / Emitir durante actividad) para que esta app la pueda leer a la vez
  que el reloj graba su propia actividad — no hay conflicto entre los dos.

## Limitaciones conocidas de esta v1 (para que no pillen por sorpresa)

- **No lo he podido probar contra tu rodillo real** — he seguido la especificación
  pública del protocolo FTMS y los problemas ya documentados por otros proyectos de
  código abierto, pero cada rodillo tiene sus manías. Lo más probable es que la
  primera sesión real haga falta ajustar algo (p. ej. si el ERG no "agarra" bien,
  si el rodillo necesita un comando distinto para arrancar, etc.). Avísame de
  cualquier cosa rara con pantallazos o una descripción de qué pasó, y lo arreglamos.
- Los datos viven en el navegador de cada dispositivo (IndexedDB). Si entrenas un
  día desde el móvil y otro desde el ordenador, el historial no se comparte solo
  entre los dos — hay que exportar el CSV y pasarlo a mano (o decírmelo y lo
  automatizamos en una v2, por ejemplo subiendo el CSV a la carpeta del proyecto
  del IRONMAN automáticamente).
- No calcula distancia recorrida ni desnivel (no aporta nada en rodillo indoor).
- No hay integración directa con Strava/Garmin Connect en esta v1 — el camino hoy
  es exportar el CSV y yo lo cruzo con lo demás, igual que ya hago con tus datos
  de Strava.

## Cambios v1.1 (26/09/2026)

- ERG más robusto: si el rodillo no confirma un vatiaje, se reenvía (antes se podía
  quedar el objetivo anterior sin avisar). Tras una pausa se reenvía el objetivo.
- La pantalla no se apaga durante la sesión (Wake Lock) — clave en bicis de 3-5 h.
- Chart.js va incluido en el repo: la app funciona sin conexión una vez instalada.
- El service worker ya no deja la app "congelada" en una versión vieja: las
  actualizaciones del repo llegan solas.
- Nombres de entreno escapados (un nombre con `<` ya no rompe la pantalla).

## Alternativas open source que merece la pena conocer

- **[Auuki](https://github.com/dvmarinoff/Auuki)** (auuki.com) — misma idea (web +
  Bluetooth FTMS), mucho más madura: ERG/pendiente/resistencia, workouts .zwo,
  graba .FIT y sube a Strava e Intervals.icu. AGPL-3.0.
- **[QZ / qdomyos-zwift](https://github.com/cagnulein/qdomyos-zwift)** — app nativa
  (iOS incluido), puente a Zwift y a otras apps. GPL.
- **GoldenCheetah** — escritorio, análisis muy completo y control de rodillo.

## Próximos pasos posibles (a decidir contigo según qué tal vaya la v1)

- Auto-generar el entreno de la semana a partir del documento de la semana del
  IRONMAN, para no tener que construirlo a mano cada vez.
- Subida automática del CSV a la carpeta del proyecto (o a Strava/Intervals.icu)
  al terminar la sesión, si tienes conexión a internet en ese momento.
- Historial compartido entre móvil y ordenador (hoy son independientes).
