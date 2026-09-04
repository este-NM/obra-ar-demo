export const visualConfig = {
  assets: {
    // Copias web 5:1; los originales de 12600 x 8910 permanecen intactos.
    original: "./visual-assets/original.jpg",
    s1: "./visual-assets/s1.png",
    s2: "./visual-assets/s2.png",
    s3: "./visual-assets/s3.png",
    ent1: "./visual-assets/ent1.png",
    ent2: "./visual-assets/ent2.png",

    // Máscaras de sólo lectura provenientes de obras_ar_stable/previo.html.
    currentTraces: "./obras_ar_stable/gold-traces.png",
    currentGlow: "./obras_ar_stable/gold-glow.png",
  },

  render: {
    // Limita la densidad interna para mantener el laboratorio fluido.
    maxDevicePixelRatio: 1.25,
    // Color aplicado a los PNG grises cuando funcionan como máscaras luminosas.
    lightColor: "#ffd66f",
  },

  baseImage: {
    // Ciclos de respiración luminosa por segundo.
    breathingFrequency: 0.28,
    // Variación de luminosidad de original.jpg alrededor de su valor normal.
    breathingDepth: 0.3,
    // Ciclos de la microescala basal por segundo; se mantiene independiente de la luz.
    scaleFrequency: 0.13,
    // Expansión uniforme máxima de original.jpg; nunca reduce la escala por debajo de 1.
    scaleDepth: 0.016,
  },

  current: {
    type: "centralityGlow",
    // Cantidad máxima de posiciones recientes que deja el mouse.
    maxFoci: 12,
    // Segundos durante los que cada posición continúa aportando luminosidad.
    focusLife: 1.45,
    // Compensa la proporción horizontal, conservada del shader AR anterior.
    aspectCorrection: 1.415668203,
    // Ciclos de respiración por segundo; 0.24 equivale a un ciclo cada 4.17 s.
    breathingFrequency: 0.24,
    // Variación relativa de la presencia luminosa alrededor del estado normal.
    breathingDepth: 0.04,
    // Ganancia de la máscara nítida gold-traces.png.
    traceGlowGain: 1.42,
    // Presencia mínima de la máscara nítida.
    traceBaseGain: 1.0,
    // Ganancia de la máscara difusa gold-glow.png.
    glowGlowGain: 1.72,
    // Presencia mínima de la máscara difusa.
    glowBaseGain: 0.74,
  },

  s1: {
    type: "axisSweep",
    axis: "vertical",
    // Ciclos por segundo del colapso y retorno.
    frequency: 0.45,
    // Compresión horizontal mínima al cruzar el eje vertical.
    minScale: 0.06,
    // Cantidad de estados anteriores que forman el tail.
    tailSamples: 10,
    // Multiplicador de opacidad entre una muestra del tail y la siguiente.
    tailDecay: 0.72,
    // Opacidad de la primera muestra del tail.
    tailOpacity: 0.45,
    // Separación temporal, en segundos, entre muestras del tail.
    tailStep: 0.055,
  },

  s2: {
    type: "axisSweep",
    axis: "horizontal",
    // Ciclos por segundo del colapso y retorno.
    frequency: 0.45,
    // Compresión vertical mínima al cruzar el eje horizontal.
    minScale: 0.06,
    // Cantidad de estados anteriores que forman el tail.
    tailSamples: 10,
    // Multiplicador de opacidad entre una muestra del tail y la siguiente.
    tailDecay: 0.72,
    // Opacidad de la primera muestra del tail.
    tailOpacity: 0.45,
    // Separación temporal, en segundos, entre muestras del tail.
    tailStep: 0.055,
  },

  s3: {
    type: "aura",
    // Ciclos por segundo de la respiración de la silueta.
    frequency: 0.55,
    // Expansión máxima de cada copia de la propia figura.
    auraScale: 0.1,
    // Cantidad de capas escaladas que construyen el aura.
    auraLayers: 7,
    // Intensidad luminosa global del aura.
    glow: 0.65,
    // Desenfoque máximo, medido en píxeles a escala de pantalla.
    blur: 18,
    // Opacidad máxima de las expansiones.
    opacity: 0.62,
  },

  ent1: {
    type: "convergingGlow",
    // Ciclos de convergencia por segundo.
    frequency: 0.4,
    // Altura de cada frente como fracción de la obra.
    bandWidth: 0.1,
    // Intensidad luminosa de los dos frentes.
    glow: 0.82,
    // Pérdida de opacidad al alcanzar el centro.
    centerFade: 0.6,
    // Contracción espacial del realce durante la absorción central.
    centerCompression: 0.56,
  },

  ent2: {
    type: "circulatingGlow",
    // Una vuelta completa de cada circulación cada 7.1 segundos.
    frequency: 0.14,
    // Presencia neutra del dibujo entre circulaciones; no genera halo global.
    baseOpacity: 0.035,
    // Radio de cada frente luminoso como fracción del ancho de la obra.
    packetRadius: 0.072,
    // Cola corta que permite leer el sentido de circulación.
    trailSamples: 7,
    trailStep: 0.018,
    trailDecay: 0.7,
    glow: 0.96,
    blur: 16,
    // Recorridos elípticos normalizados sobre los cuatro campos de ent2.
    circulations: [
      { centerX: 0.286, centerY: 0.315, radiusX: 0.12, radiusY: 0.185, direction: 1, phase: 0 },
      { centerX: 0.714, centerY: 0.315, radiusX: 0.12, radiusY: 0.185, direction: -1, phase: 0 },
      { centerX: 0.385, centerY: 0.7, radiusX: 0.082, radiusY: 0.14, direction: -1, phase: 0.45 },
      { centerX: 0.615, centerY: 0.7, radiusX: 0.082, radiusY: 0.14, direction: 1, phase: 0.45 },
    ],
  },
};
