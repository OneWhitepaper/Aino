<p align="center">
  <img src="assets/aino-banner.svg" alt="Aino" width="100%">
</p>

# Aino

Aino es un espacio de trabajo de IA para conversaciones, proyectos locales y colaboración entre agentes. Su aplicación de escritorio reutiliza el motor de Hermes Agent para modelos, herramientas, habilidades y delegación.

[Sitio web](https://petoi.cn/) · [Descargar Aino](https://petoi.cn/download.html) · [Guía de inicio](https://petoi.cn/guide.html) · [Versiones](https://github.com/OneWhitepaper/Aino/releases) · [Informar de un problema](https://github.com/OneWhitepaper/Aino/issues)

[English](README.md) · [简体中文](README.zh-CN.md) · [اردو](README.ur-pk.md)

## Instalación

1. Abre la [página de descargas de Aino](https://petoi.cn/download.html).
2. Selecciona un paquete disponible para tu sistema y arquitectura. Sigue las instrucciones de esa versión.
3. Abre Aino, completa el acceso o la configuración del modelo que ofrezca tu versión e inicia una conversación.

Los paquetes disponibles son los que aparecen en la página de descargas. El instalador del proyecto Hermes original no instala la distribución Aino.

## Uso

Puedes conversar directamente o abrir/crear una carpeta de proyecto, incluso si está vacía. Los modelos disponibles dependen de tu cuenta o proveedor configurado. La aplicación reutiliza las herramientas, habilidades, complementos, tareas programadas, conexiones remotas y delegación del motor existente.

Consulta la [guía de inicio](https://petoi.cn/guide.html) y la [guía de cuenta, modelos y saldo](docs/aino-platform-user-guide.md) (en chino). La disponibilidad y los precios dependen del servicio utilizado.

## Actualizaciones y ayuda

Comprueba las actualizaciones desde Configuración → Acerca de. Las [versiones publicadas](https://github.com/OneWhitepaper/Aino/releases) y la [rama main](https://github.com/OneWhitepaper/Aino/tree/main) pueden diferir: un cambio en el código no implica que ya exista un instalador nuevo.

Envía los problemas del producto a [Aino Issues](https://github.com/OneWhitepaper/Aino/issues), indicando versión, sistema y pasos de reproducción. La opción de enviar diagnósticos a Nous es un servicio externo separado y requiere consentimiento explícito. Un enlace privado de Nous no concede acceso a los responsables de Aino.

## Desarrollo

Clona [este repositorio](https://github.com/OneWhitepaper/Aino) y sigue [CONTRIBUTING.md](CONTRIBUTING.md) y la [guía de compilación](apps/desktop/BUILDING.md). Elige valores aislados para `HERMES_HOME` y `HERMES_RUNTIME_DIR` antes de activar el entorno.

El comando `hermes`, las API y los formatos internos se conservan por compatibilidad. Consulta los [límites de marca y compatibilidad](docs/aino-brand-boundary.md). La [documentación técnica del motor](website/docs/user-guide/configuration.md) conserva referencias heredadas cuando describen interfaces reales.

Para importar datos de otros agentes, instala el complemento oficial con `hermes plugins install agent-importers` y revisa la vista previa con `hermes import-agent <source> --dry-run`. Consulta la [guía de importación](website/docs/user-guide/import-from-other-agents.md).

## Código abierto y atribución

El repositorio sigue siendo público. Aino deriva de [Hermes Agent](https://github.com/NousResearch/hermes-agent), de Nous Research. Los avisos originales se conservan en [LICENSE](LICENSE) y [NOTICE.md](NOTICE.md). Los servicios y componentes de terceros mantienen sus propios nombres y licencias.
