# Diffora

Revisión local de cambios de Git después de trabajar con agentes de programación. Interfaz React + Ink, Git exclusivamente de lectura: no contiene acciones de staging, commits, checkout, push ni escrituras en el repositorio inspeccionado. Progreso, notas e informes se guardan fuera del repositorio; abrir un editor es una acción explícita del usuario.

## Instalación

Requisitos: Node.js **24 LTS recomendado** (mínimo 22.13), npm, Git en PATH y una terminal interactiva. Compatibilidad comprobada antes de instalar: [Ink 7](https://github.com/vadimdemedes/ink/releases/tag/v7.0.0) requiere Node ≥22 y React ≥19.2; el proyecto fija Ink 7.0.6 y React 19.2.4. [Calendario LTS de Node](https://github.com/nodejs/Release).

Desde esta carpeta:

```sh
npm install
npm run typecheck
npm test
npm run build
node dist/cli.js --repo "/ruta/a/mi repositorio"
```

Para disponer del comando `diffora` desde cualquier carpeta, instala este proyecto globalmente una sola vez, sin publicarlo:

```sh
npm install --global /ruta/a/diffora
cd /ruta/a/tu-proyecto
diffora
```

El comando usa el repositorio de la carpeta actual; no lleva `/` al principio. La instalación local enlaza el proyecto compilado. Si cambias las fuentes, ejecuta `npm run build` desde la carpeta del proyecto. El script `prepare` también compila al instalar con scripts habilitados; npm 11 puede requerir `--allow-scripts=diffora` para habilitarlo en instalaciones globales.

Si prefieres instalar una copia empaquetada:

```sh
npm pack
npm install --global ./diffora-0.1.0.tgz
diffora --repo "/ruta/a/mi repositorio"
```

La instalación global requiere permisos en el prefijo de npm. También puedes usar directamente `node /ruta/a/terminal-review/dist/cli.js`.

La marca y el paquete se llaman **Diffora**. Las variables antiguas `TERMINAL_REVIEW_STATE_DIR` y `TERMINAL_REVIEW_EDITOR` siguen siendo compatibles; las nuevas son `DIFFORA_STATE_DIR` y `DIFFORA_EDITOR`. `terminal-review` sigue disponible como alias. El directorio de progreso mantiene su nombre anterior para conservar marcas y notas. Tras actualizar, reinstala el paquete local para registrar el nuevo comando `diffora`.

## Uso

```sh
diffora                     # repositorio del directorio actual
diffora --repo /ruta/repo   # acepta subcarpetas y rutas con espacios
diffora --help
diffora --version
npm run dev -- --repo /ruta/repo    # desarrollo con tsx
```

Selecciona un commit con las flechas y pulsa Enter para abrir sus archivos; selecciona un archivo y pulsa Enter para entrar en el visor. Los archivos y diferencias se cargan al cambiar la selección. Tab permite pasar entre paneles. Pulsa `w` para revisar cambios pendientes y `h` para regresar al historial.

El historial muestra hasta 30 commits alcanzables desde HEAD, con hash corto, título y fecha de commit. Un commit normal se compara con su padre; el primer commit usa el árbol vacío mediante `diff-tree --root`; un merge se compara con el **primer padre**, indicado en pantalla.

Los commits pendientes de push se destacan en amarillo con **↑**. Una línea `--- Publicados ---` los separa de los commits alcanzables desde la rama upstream configurada. Sin upstream, se comparan con todas las referencias remotas; sin referencias remotas, todos aparecen sin push. Se conserva el orden del historial, incluso si un merge intercala ambos estados. La comparación usa las referencias locales, sin hacer fetch ni consultar la red; pulsa **r** para actualizar después de un push o fetch.

Las categorías pendientes son:

- **Sin preparar:** working tree frente al índice.
- **Preparados:** índice frente a HEAD (también funciona antes del primer commit).
- **Sin seguimiento:** archivos nuevos no ignorados, representados como contenido añadido.

Se muestran estados Git (`A`, `M`, `D`, `R…`, `?`) y origen/destino de renombres. Las imágenes compatibles muestran una vista previa a color; los demás binarios presentan un aviso. Los cambios de permisos y renombres sin cambios de contenido muestran los metadatos del patch.

| Tecla           | Acción                                                 |
| --------------- | ------------------------------------------------------ |
| ↑ / ↓           | Seleccionar en listas o desplazar una línea en el diff |
| Enter           | Abrir selección / pasar al siguiente panel             |
| Tab / Shift+Tab | Siguiente / anterior panel (cíclico)                   |
| Esc             | Volver al panel anterior                               |
| h / w           | Historial / pendientes                                 |
| r               | Actualizar las consultas                               |
| /               | Buscar archivos por nombre o ruta                      |
| m               | Marcar / desmarcar el archivo seleccionado como revisado |
| n               | Marcar / desmarcar como pendiente de otra revisión (naranja) |
| s               | Alternar diff unificado / paralelo (en el visor de texto) |
| c               | Escribir o editar una nota; Enter guarda, Esc cancela   |
| f               | Alternar «solo lo que falta» (gris y naranja)           |
| ]               | Siguiente archivo no terminado del filtro, con vuelta al inicio |
| j / k           | Siguiente / anterior bloque de cambios                 |
| e               | Abrir el archivo actual y la línea del diff en el editor |
| t               | Todas las tareas del repositorio; Enter abre la seleccionada |
| i               | Resumen del commit o categoría actual                  |
| E               | Exportar un informe Markdown (mayúscula)               |
| ?               | Ayuda de teclado                                       |
| q / Ctrl+C      | Salir y restaurar la terminal                          |

Con menos de 110 columnas se muestra únicamente el panel activo. Las líneas largas se recortan con `…` según el ancho de terminal, incluyendo caracteres anchos. La vista unificada inicial tiene números anteriores/nuevos, añadidos verdes `+`, eliminados rojos `-`, contexto neutro y encabezados de bloques. La barra inferior muestra atajos, carga, errores, selección y posición del diff.

Con los tres paneles visibles, **arrastra con el botón izquierdo los bordes verticales entre paneles** para ajustar sus anchos. Cada borde cambia los dos paneles vecinos, con un mínimo de 20 columnas por panel. Los tamaños se conservan durante la sesión y se adaptan al redimensionar la ventana. Requiere una terminal que envíe [eventos de mouse SGR](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h2-Mouse-Tracking); el teclado sigue disponible. El visor usa una pantalla alternativa y restaura la pantalla anterior y el mouse al salir.

### Comparación lado a lado

Entra al diff de texto con **Enter** y pulsa **s**: la versión **Anterior** queda a la izquierda y la **Nueva** a la derecha, con fondos rojos/verdes y énfasis en la parte modificada de cada pareja de líneas. Las líneas de contexto aparecen en ambos lados; una adición o eliminación sin pareja deja el otro lado vacío. Se conservan los números reales y los metadatos de Git. Los bloques de eliminaciones/adiciones se emparejan por orden dentro del mismo hunk; no se pretende detectar movimientos de código.

Al enfocar el visor paralelo, ocupa todo el ancho disponible. **Esc** o **Tab** recuperan los paneles de archivos e historial; **s** vuelve a la vista unificada. El cambio de vista conserva el bloque que estabas leyendo y no borra las marcas verdes/naranjas ni vuelve a consultar Git.

La vista paralela requiere al menos **80 columnas**. Si reduces la ventana, aparece un aviso y se muestra temporalmente la vista unificada; al ensancharla se recupera la paralela. La preferencia dura durante la sesión, también al cambiar de archivo. Las líneas largas se recortan por columna sin desplazamiento horizontal. Las imágenes mantienen su control **v** anterior/nueva; **s** no las cambia.

### Buscar y llevar el progreso de revisión

Pulsa `/` desde cualquier panel: se abre el panel de archivos con un campo de búsqueda. El filtro se aplica mientras escribes, sin distinguir mayúsculas/minúsculas, sobre la ruta completa y la ruta anterior de los renombres. Es una búsqueda literal, limitada a los archivos de la categoría o commit seleccionado. **Enter** aplica el filtro y permite recorrer los resultados con las flechas; otro Enter abre el diff. **Esc** limpia el filtro; **Ctrl+U** borra el texto mientras lo editas. Durante la edición, letras como `q`, `h` o `r` forman parte de la búsqueda; Ctrl+C sigue permitiendo salir. No hay búsqueda dentro del contenido del diff.

Con el diff cargado, pulsa `m` en el panel de archivos o en el visor para alternar el **punto verde ●** (revisado y terminado). Pulsa `n` para alternar el **punto naranja ●** (revisado parcialmente o necesita otra revisión). Ambas marcas son excluyentes: `m` pasa de naranja a verde, `n` de verde a naranja, y repetir la tecla de la marca actual vuelve al punto gris `·` sin revisar. Los puntos conservan su color incluso en la fila seleccionada; `M`, `A`, `D` y los demás estados de Git siguen visibles. El encabezado muestra `terminados/total ✓` y añade `pendientes !` si hay naranjas; el diff usa **✓** para verde y **!** para naranja, también distinguibles sin color.

Si **un solo archivo está naranja**, el commit queda naranja aunque los demás sean verdes o sigan sin revisar. Solo queda verde cuando **todos** sus archivos están terminados; si no hay naranjas pero quedan archivos sin revisar, sigue gris. El resumen siempre incluye la lista completa, no solo los resultados del filtro. Los commits sin lista cargada o restaurada, o sin archivos, no se marcan automáticamente. Las marcas se identifican por commit/categoría y ruta, incluyendo los renombres; sobreviven a la navegación y al cierre del visor. No modifican Git ni se guardan en el repositorio.

### Progreso persistente y cambios externos

Las marcas, notas, resúmenes de commits y preferencia de vista se guardan automáticamente en **~/.local/state/terminal-review/**. Si existe `XDG_STATE_HOME`, se usa su subcarpeta `terminal-review`; `DIFFORA_STATE_DIR` permite elegir otra carpeta, siempre fuera del repositorio. Cada repositorio tiene un JSON independiente, identificado por la ruta raíz canónica. Los directorios nuevos son privados (0700) y los archivos usan 0600. El guardado usa un temporal y un reemplazo atómico; **q** y Ctrl+C esperan el último guardado.

Al iniciar, actualizar con **r** y aproximadamente **cada 2 segundos**, se comprueban los cambios pendientes marcados o anotados y el diff seleccionado. Se compara una huella del contenido completo, modos, versión del índice y baseline de Git, no una miniatura ni el patch truncado. Cambiar solo la fecha de modificación no invalida una revisión. Si cambia el contenido, desaparece el cambio o pasa a otra categoría, pierde su marca y vuelve a **sin revisar**. Su nota se conserva como **obsoleta: volver a revisar**. Las marcas de commits son estables porque su identidad incluye el hash.

`r` conserva las marcas que siguen correspondiendo al mismo contenido. La búsqueda se limpia al cambiar de categoría/commit o actualizar. La comprobación periódica no constituye una instantánea atómica con otros procesos; también se compara la huella antes y después de cargar cada diff.

Si el estado está corrupto, tiene otra versión, es excesivo o no se puede leer, la interfaz continúa funcionando y avisa; **no se sobrescribe el archivo original**. Si falla un guardado, `q` muestra el error en lugar de perder datos silenciosamente; Ctrl+C permite salir sin guardar. Si dos ventanas escriben sobre el mismo progreso, la segunda detecta el cambio externo y no lo pisa: exporta sus notas con **E** antes de reabrir. Un bloqueo temporal `.write-lock` dejado por una terminación forzada solo debe retirarse cuando hayas confirmado que ningún visor está guardando.

### Notas y tareas

Con el diff cargado, pulsa **c**, escribe una nota de hasta **1000 caracteres** y pulsa Enter. Guardar una nota no vacía marca el archivo naranja. **Esc** cancela; **Ctrl+U** borra el borrador. Durante la edición, los atajos son texto normal. Guardar una nota vacía elimina esa nota, no la marca.

**t** reúne las marcas naranjas y las notas sin resolver, incluso si pertenecen a otro commit/categoría. Las notas cuyo contenido cambió se distinguen como obsoletas; no se pierden al invalidar su marca. Usa ↑↓ y Enter para abrir su fuente y archivo; se limpian los filtros para que el archivo no quede oculto. Si el commit está fuera de los últimos 30, se carga por su hash y se añade al historial. Una tarea cuyo cambio ya desapareció sigue visible con su nota, aunque ya no haya diff que abrir.

**m** resuelve la tarea y archiva su nota; el texto se conserva y reaparece al volver a marcar naranja. Al desmarcar una nota sin resolver, sigue disponible entre las tareas. Los borradores cancelados o sin guardar no se persisten.

### Revisar lo que falta y navegar por bloques

**f** oculta los archivos verdes, sin cambiar índices ni identidades de Git. Se combina con la búsqueda por ruta. **]** salta al siguiente archivo gris/naranja que coincida, volviendo al primero al llegar al final. Marcar verde un archivo con este filtro activo selecciona el siguiente pendiente; si no queda ninguno, muestra una lista vacía.

En el diff de texto, **j/k** saltan entre encabezados de bloques, tanto en vista unificada como paralela. No marcan bloques individuales. La línea que se abre en el editor corresponde a la primera línea nueva visible, o a la primera línea del bloque seleccionado; cerca del final puede quedar contexto anterior en pantalla para no dejar el visor vacío.

### Abrir en el editor

**e** envía el archivo y su línea a **VS Code (`code --goto`)** por defecto. También reconoce `cursor`. No usa un shell ni toma el teclado con Vim/Nano. Configura el comando antes de abrir el visor:

```sh
DIFFORA_EDITOR="code --reuse-window" diffora
DIFFORA_EDITOR="cursor --reuse-window" diffora
DIFFORA_EDITOR='mi-editor --file "{file}" --line {line}' diffora
```

Los argumentos citados se respetan; las plantillas admiten `{file}`, `{line}` y `{column}`. Se comprueba que el archivo regular exista dentro del repositorio, incluyendo el destino de symlinks. Un archivo eliminado no se abre. **Se abre el archivo actual del working tree**, no una copia histórica: si estás revisando un commit o el índice y el archivo actual difiere, el número viene del diff y puede no coincidir con el contenido actual. Una línea eliminada usa la siguiente línea nueva disponible, o su número anterior como aproximación.

### Resumen e informe Markdown

**i** muestra total de archivos, terminados, pendientes y sin revisar del commit/categoría actual, más el número de tareas abiertas del repositorio. Siempre cuenta la lista completa, independientemente de filtros.

**E** exporta un informe nuevo en **~/.local/state/terminal-review/exports/<id-repo>/** (o en la carpeta configurada) y muestra su ruta. Incluye ámbito, fecha, todos sus archivos/estados/notas y todas las tareas abiertas del repositorio. No sobrescribe informes anteriores ni escribe Markdown en tu proyecto. Las marcas son decisiones humanas: el informe no asegura que el código esté libre de errores. Esc vuelve al visor; **?** muestra todos los atajos.

## Vista previa de imágenes

Selecciona una imagen como cualquier otro archivo. El panel de diferencias muestra una miniatura a color y su formato, resolución y tamaño. Pulsa **v** en ese panel para alternar **Anterior / Nueva**. En archivos añadidos o eliminados se muestra la versión disponible; puedes alternar para consultar el aviso de la versión ausente.

Se admiten **PNG, JPEG, WebP, GIF, TIFF y AVIF** (comprobados por extensión y firma del contenido), tanto en commits como en el índice y el working tree. Los renombres conservan la imagen de origen. GIF y otros formatos animados muestran solamente el primer fotograma; no se reproduce animación. SVG sigue mostrando su diff como texto.

La miniatura usa bloques Unicode `▀` con colores ANSI de primer plano y fondo, conservando proporciones y adaptándose al panel. La transparencia aparece sobre un fondo cuadriculado. Es una vista previa de resolución limitada, sin protocolos gráficos específicos de un emulador; en terminales sin true color los colores pueden aproximarse. No es una imagen a resolución completa ni un diff de píxeles superpuesto.

Cada versión tiene un límite de **10 MiB y 16 megapíxeles**, con miniaturas de hasta 160×160 píxeles y 5 segundos de procesamiento de la miniatura. Las imágenes dañadas, excesivas o no compatibles presentan un aviso. No se ejecuta código ni se procesa SVG/PDF mediante el decodificador de imágenes. La aplicación continúa siendo de solo lectura.

La decodificación usa Sharp 0.35.4, que requiere Node ≥20.9, compatible con el requisito del proyecto. npm instala sus dependencias nativas opcionales para tu plataforma: no uses `--omit=optional`. [Instalación y compatibilidad de Sharp](https://sharp.pixelplumbing.com/install/).

## Abrir el visor desde Claude Code o Codex

Actualiza o instala las skills personales una vez desde tu terminal:

```sh
diffora --install-skills
```

Esto crea las skills `diffora` en `~/.claude/skills/` y `~/.agents/skills/`, y conserva la skill `terminal-review` como alias compatible. Actualiza la versión oficial anterior que navegaba por texto y conserva una copia `SKILL.md.backup-<hash>`. Si el contenido está personalizado, lo conserva sin sobrescribir. No modifica el repositorio revisado. Reinicia el agente si conserva la versión anterior.

- **Claude Code:** escribe `/diffora` en el chat.
- **Codex CLI/IDE:** escribe `$diffora` o selecciónalo desde `/skills`. En la app, usa el selector de skills disponible (`@` en ChatGPT).

La skill ejecuta `diffora --open` en el repositorio del chat. En **macOS** abre una ventana independiente de Terminal.app con la interfaz Ink: paneles, flechas, Enter, Tab, historial y pendientes. El agente mantiene su conversación abierta. `q` sale del visor; después puedes volver a la ventana del chat.

No se toma el teclado del terminal en el que sigue ejecutándose el agente: abrir una UI a través de su herramienta de shell no transfiere automáticamente la entrada de usuario. El modo `--open` usa un archivo `.command` temporal ejecutable con argumentos citados literalmente y una ruta absoluta a Node; no necesita AppleScript ni permisos de Automatización. El archivo y su carpeta se eliminan al salir del visor. Si la apertura falla, se elimina el archivo y se muestra el error. Un sandbox que bloquee abrir aplicaciones puede impedir el lanzamiento desde el agente; en ese caso, ejecútalo desde tu terminal local.

Puedes probarlo directamente:

```sh
diffora --open --repo /ruta/a/tu-proyecto
```

`--open` requiere macOS y una sesión gráfica local. La UI normal `diffora` y el modo de texto no tienen ese requisito. La apertura automática debe comprobarse en el entorno del usuario; el entorno del agente bloqueó Launch Services al intentar abrir Terminal.app.

La invocación depende del cliente: no se registra `/diffora` como comando nativo de Codex ni se reemplaza su `/review`. [Invocación de skills en OpenAI Docs](https://learn.chatgpt.com/docs/build-skills), [skills en Claude Code](https://code.claude.com/docs/en/skills).

### Modo de texto opcional

Si prefieres revisar dentro de la conversación, pídelo expresamente al invocar la skill. La navegación por texto sigue disponible sin TTY:

```sh
diffora --text
diffora --text --source staged
diffora --text --source unstaged --file 2
diffora --text --commit e69f764 --file 1
diffora --text --source unstaged --file 2 --offset 80 --limit 80
```

Los números de archivo comienzan en 1 y corresponden a la última lista de su categoría/commit. `--offset` comienza en 0; `--limit` admite de 1 a 200 filas (80 por defecto). Las diferencias indican la siguiente página y conservan los avisos de binarios y truncamiento. El informe tiene un límite adicional de 65 536 caracteres. La selección de commits por hash se limita a los últimos 30 commits y rechaza prefijos ambiguos.

Si el comando no está instalado globalmente, puedes instalar las skills con `node /ruta/a/diffora/dist/cli.js --install-skills`, pero el agente necesitará el comando en su PATH o una ruta absoluta conocida al CLI.

## Arquitectura

```text
src/cli.ts                Argumentos, validación de TTY y ciclo de vida
src/ui/                   Componentes Ink, dimensiones y recorte visual
src/application/          useReducer, coordinación, informes de texto e instalación de skills
src/core/                 Modelos, parser y neutralización de controles
src/git/                  Procesos Git y consultas del repositorio
src/images/               Decodificación acotada y miniaturas a color
```

La UI no ejecuta Git: consume `useReview`, que coordina `Repository`. Cada consulta lleva una identidad de selección y generación; el reducer descarta resultados y errores atrasados, incluso al salir de una selección y volver a ella. Los efectos se cancelan con AbortController al cambiar selección o desmontar la aplicación.

Git se ejecuta mediante `spawn`, `shell: false`, argumentos separados, pathspecs literales y nombres delimitados por NUL. Se desactivan paginadores, color de Git, herramientas externas de diff y textconv. `GIT_OPTIONAL_LOCKS=0` evita actualizaciones opcionales del índice. Los controles de los archivos, títulos, rutas y errores se sustituyen por representaciones visibles antes de renderizarlos; los tabs se convierten en cuatro espacios. Los enlaces simbólicos nuevos se muestran como su destino, sin leer el archivo enlazado.

## Desarrollo y validación

| Script                         | Propósito                                                 |
| ------------------------------ | --------------------------------------------------------- |
| `npm run dev -- --repo <ruta>` | Ejecutar fuentes con tsx                                  |
| `npm run build`                | Compilar `src/` a `dist/` con declaraciones               |
| `npm run typecheck`            | Comprobar código y pruebas con TypeScript estricto        |
| `npm test`                     | Parser, reducer e integración con repositorios temporales |
| `npm run test:terminal`        | Prueba real en PTY, macOS/Linux y Python 3                |
| `npm run test:workflow`        | Notas, editor simulado, filtros, exportación y reapertura |

Las pruebas crean y modifican **solamente repositorios temporales**: primer commit, commit normal, merge, historial vacío, últimos 30 commits, estados preparados/sin preparar, archivos nuevos, eliminados, renombrados, binarios, nombres con espacios/saltos de línea/pathspecs, límites y ausencia de Git. También comparan el estado Git y el índice antes/después de las lecturas y verifican el rechazo de respuestas atrasadas.

La prueba PTY comprueba navegación a pendientes, archivos y diff, búsqueda con edición y ausencia de resultados, marcado/desmarcado, comparación paralela, arrastre de ambos bordes y límites de tamaño, commits sin push en amarillo y separador de publicados, redimensionado y recuperación de la vista, flechas, Tab, Esc, vuelta al historial, actualización y salida con `q` y Ctrl+C; verifica la restauración de los ajustes de terminal, mouse y pantalla en 140, 80 y 40 columnas. No modifica el repositorio desde el cual se ejecuta.

**Estado de validación:** comprobación de tipos completa, compilación y 84 pruebas de parser, reducer, interfaz, persistencia, seguridad e integración aprobadas. Las pruebas PTY cubren 140, 80 y 40 columnas: seis sesiones de navegación/colores/imágenes y nueve sesiones del flujo de revisión con reinicios, notas, editor simulado con archivo/línea verificados, filtros, bloques, exportación e invalidación automática sin pulsar r. Las fixtures, el editor simulado y el estado son temporales; no modifican el repositorio real.

## Límites del MVP

- Diff y contenido nuevo: máximo **1 MiB**, y máximo **10 000 líneas de contenido**; se avisa si se trunca. Consultas de listas: máximo **8 MiB**, con error en lugar de presentar resultados parciales. Git tiene un límite de **15 segundos** por proceso.
- Archivos de texto interpretados como UTF-8. Los nuevos se consideran binarios si contienen NUL en sus primeros 8 000 bytes, como la heurística básica de Git. Nombres con bytes que no sean UTF-8 se muestran con caracteres de reemplazo.
- Sin desplazamiento horizontal; para ver más contenido, ensancha la terminal. Se recomienda al menos 40 columnas y 8 filas.
- Comprobación periódica cada 2 s sin observar cada evento del sistema de archivos; `r` fuerza la actualización. Las consultas no constituyen una instantánea atómica si otro proceso modifica el repositorio mientras se revisa.
- Submódulos muestran los cambios de referencia; no se abre su historial interno. Los conflictos sin resolver usan la salida de diff de Git; el parser no implementa bloques combinados `@@@` como un diff ordinario.
- Huellas de archivos regulares pendientes: máximo **64 MiB** y 10 s por lectura; archivos no validables se muestran, pero no se marcan. El estado/informe tiene un límite de **2 MiB** y las notas de 1000 caracteres. El progreso es local, no se sincroniza ni se comparte automáticamente entre equipos.
- Sin búsqueda de contenido, revisión de bloques individuales, IA, servidor ni integración remota con GitHub. Las notas son por archivo y fuente.
