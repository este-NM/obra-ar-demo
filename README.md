# Chargermovement — recorrido interactivo y WebAR

Este paquete contiene dos pruebas de la misma lógica.

## 1. `preview.html`
Se puede abrir directamente en una computadora. El cursor hace de sustituto de la centralidad de cámara.

- mover el cursor sobre el canal: conduce el haz;
- salir del canal: el haz deja de recibir activación y la estela decae;
- click/tap: dispara una propagación en ambos sentidos por la trayectoria;
- el botón **Mostrar trayectoria** sirve únicamente para comprobar la correspondencia vector/obra.

## 2. `index.html` — WebAR
Pensado para GitHub Pages. Reconoce el print y usa el centro de la pantalla como condición de activación.

Antes de usarlo hay que generar una vez el archivo `targets.mind`:

1. abrir el compilador oficial de imágenes de MindAR;
2. cargar `target.jpg`;
3. compilar y descargar el resultado;
4. renombrarlo `targets.mind` si fuera necesario;
5. subir `targets.mind` junto con los demás archivos a la raíz del repositorio de GitHub Pages.

Después, al abrir `index.html` desde HTTPS:

- se activa la cámara;
- el efecto aparece solamente cuando el print es reconocido;
- el centro de pantalla intersecta el plano del print y determina qué punto del canal intenta activar;
- para completar el recorrido hay que desplazar físicamente la cámara por la obra;
- un tap sobre una zona del canal dispara una propagación local.

## Archivos

- `target.jpg`: imagen del print usada para reconocimiento.
- `channel-mask.png`: máscara vectorial del ancho real de la cinta/canal.
- `path-data.js`: trayectoria central obtenida del vector suministrado.
- `beam-engine.js`: dinámica de haz, estela, velocidades y propagaciones.
- `preview.html`: demo directa.
- `index.html`: versión AR.

## Dinámica incorporada

Se sigue el ciclo A → B → C → D → E → A. La respuesta de movimiento se modula según las indicaciones suministradas: A–B aumenta; B–C alcanza la mayor velocidad; C–D disminuye; D–E aumenta levemente; E–A disminuye hacia la mínima. La transición es continua, sin saltos entre tramos.

En los solapamientos señalados como `down`, el brillo se atenúa brevemente para que el tramo `up` conserve la precedencia visual del diagrama.

## Nota de calibración

Esta primera versión interpreta el vector provisto como trayectoria central del haz. Una siguiente calibración puede modificar, sin rehacer la arquitectura:

- anchura del halo;
- persistencia de la cola;
- velocidad absoluta;
- tolerancia de centralidad;
- color del haz;
- fuerza de propagación por tap;
- extensión exacta de las zonas `up/down`.
