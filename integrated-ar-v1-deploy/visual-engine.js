const TAU = Math.PI * 2;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const wrap01 = (value) => ((value % 1) + 1) % 1;

export function resolveVisualCycle(time, frequency, structuralPhase = null) {
  return Number.isFinite(structuralPhase)
    ? wrap01(structuralPhase)
    : wrap01(time * frequency);
}

function lfo01FromCycle(cycle, phaseOffset = 0) {
  return 0.5 + 0.5 * Math.cos(TAU * cycle + phaseOffset);
}

function drawCentered(ctx, layer, width, height, scaleX, scaleY, opacity, blur = 0) {
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(scaleX, scaleY);
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = "screen";
  ctx.filter = blur > 0 ? `blur(${blur}px)` : "none";
  ctx.drawImage(layer, -width / 2, -height / 2, width, height);
  ctx.restore();
}

export async function loadVisualImage(url) {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  return image;
}

export function createTintedLayer(image, color) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "source-over";
  return canvas;
}

export function axisSweep(layer, config, frame) {
  const { ctx, width, height, time, phase } = frame;
  const cycle = resolveVisualCycle(time, config.frequency, phase);
  const scaleAtCycle = (sampleCycle) =>
    config.minScale + (1 - config.minScale) * lfo01FromCycle(sampleCycle);

  for (let index = config.tailSamples; index >= 1; index -= 1) {
    const sampleCycle = cycle - index * config.tailStep * config.frequency;
    const scale = scaleAtCycle(sampleCycle);
    const opacity = config.tailOpacity * Math.pow(config.tailDecay, index - 1);
    const scaleX = config.axis === "vertical" ? scale : 1;
    const scaleY = config.axis === "horizontal" ? scale : 1;
    drawCentered(ctx, layer, width, height, scaleX, scaleY, opacity);
  }

  const currentScale = scaleAtCycle(cycle);
  drawCentered(
    ctx,
    layer,
    width,
    height,
    config.axis === "vertical" ? currentScale : 1,
    config.axis === "horizontal" ? currentScale : 1,
    1,
  );

  return {
    type: config.type,
    axis: config.axis,
    phase: cycle,
    currentScale,
    tailSamples: config.tailSamples,
  };
}

export function aura(layer, config, frame) {
  const { ctx, width, height, time, phase } = frame;
  const cycle = resolveVisualCycle(time, config.frequency, phase);
  const breath = lfo01FromCycle(cycle, Math.PI);
  const screenScale = width / 1260;

  for (let index = config.auraLayers; index >= 1; index -= 1) {
    const depth = index / config.auraLayers;
    const scale = 1 + config.auraScale * depth * (0.45 + breath * 0.55);
    const opacity =
      config.opacity * config.glow * (1 - depth * 0.68) * (0.35 + breath * 0.65);
    const blur = config.blur * depth * screenScale;
    drawCentered(ctx, layer, width, height, scale, scale, opacity, blur);
  }

  drawCentered(ctx, layer, width, height, 1, 1, 0.72 + breath * 0.25);

  return {
    type: config.type,
    breath,
    phase: cycle,
    auraLayers: config.auraLayers,
    source: "layer-alpha",
  };
}

function drawBand(ctx, width, centerY, bandHeight, opacity) {
  const half = Math.max(2, bandHeight / 2);
  const gradient = ctx.createLinearGradient(0, centerY - half, 0, centerY + half);
  gradient.addColorStop(0, "rgba(255, 218, 120, 0)");
  gradient.addColorStop(0.32, `rgba(255, 218, 120, ${opacity * 0.42})`);
  gradient.addColorStop(0.5, `rgba(255, 250, 218, ${opacity})`);
  gradient.addColorStop(0.68, `rgba(255, 218, 120, ${opacity * 0.42})`);
  gradient.addColorStop(1, "rgba(255, 218, 120, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, centerY - half, width, bandHeight);
}

export function convergingGlow(layer, config, frame) {
  const { ctx, width, height, time, phase, buffers } = frame;
  const cycle = resolveVisualCycle(time, config.frequency, phase);
  const eased = cycle * cycle * (3 - 2 * cycle);
  const arrival = clamp((cycle - 0.72) / 0.28, 0, 1);
  const topY = eased * height * 0.5;
  const bottomY = height - eased * height * 0.5;
  const bandHeight =
    height * config.bandWidth * (1 - arrival * config.centerCompression * 0.88);
  const opacity = config.glow * (1 - arrival * config.centerFade);

  const buffer = buffers.effect;
  const bufferCtx = buffers.effectCtx;
  bufferCtx.clearRect(0, 0, width, height);
  bufferCtx.globalCompositeOperation = "source-over";
  drawBand(bufferCtx, width, topY, bandHeight, opacity);
  drawBand(bufferCtx, width, bottomY, bandHeight, opacity);
  bufferCtx.globalCompositeOperation = "destination-in";
  bufferCtx.drawImage(layer, 0, 0, width, height);
  bufferCtx.globalCompositeOperation = "source-over";

  const depthScale = 1 - arrival * config.centerCompression * 0.16;
  drawCentered(ctx, layer, width, height, 1, 1, 0.08);
  drawCentered(
    ctx,
    buffer,
    width,
    height,
    depthScale,
    depthScale,
    0.72,
    Math.max(2, width / 420),
  );
  drawCentered(ctx, buffer, width, height, depthScale, depthScale, 1);

  return {
    type: config.type,
    progress: cycle,
    phase: cycle,
    topFront: topY / height,
    bottomFront: bottomY / height,
    arrival,
    source: "layer-alpha",
  };
}

export function glowLfo(layer, config, frame) {
  const { ctx, width, height, time, phase } = frame;
  const cycle = resolveVisualCycle(time, config.frequency, phase);
  const wave = lfo01FromCycle(cycle, Math.PI);
  const intensity = config.glowMin + (config.glowMax - config.glowMin) * wave;
  const blur = Math.max(3, (width / 1260) * (9 + intensity * 16));

  drawCentered(ctx, layer, width, height, 1, 1, intensity * 0.8, blur);
  drawCentered(ctx, layer, width, height, 1, 1, 0.18 + intensity * 0.68);

  return {
    type: config.type,
    intensity,
    phase: cycle,
    source: "layer-alpha",
  };
}

const effectsByType = {
  axisSweep,
  aura,
  convergingGlow,
  glowLfo,
};

export class VisualEngine {
  constructor(canvas, config, images, { renderBaseImage = true } = {}) {
    this.canvas = canvas;
    this.renderBaseImage = renderBaseImage;
    this.ctx = canvas.getContext("2d", { alpha: !renderBaseImage });
    this.config = config;
    this.images = images;
    this.mode = "CURRENT";
    this.diagnostics = { mode: this.mode, type: "centralityGlow" };

    this.layers = Object.fromEntries(
      ["s1", "s2", "s3", "ent1", "ent2"].map((name) => [
        name,
        createTintedLayer(images[name], config.render.lightColor),
      ]),
    );

    this.effectBuffer = document.createElement("canvas");
    this.effectBufferCtx = this.effectBuffer.getContext("2d");
    this.presenceBuffer = document.createElement("canvas");
    this.presenceBufferCtx = this.presenceBuffer.getContext("2d");
    this.presenceEffectBuffer = document.createElement("canvas");
    this.presenceEffectBufferCtx = this.presenceEffectBuffer.getContext("2d");
  }

  resize(width, height) {
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.effectBuffer.width = width;
    this.effectBuffer.height = height;
    this.presenceBuffer.width = width;
    this.presenceBuffer.height = height;
    this.presenceEffectBuffer.width = width;
    this.presenceEffectBuffer.height = height;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
  }

  setMode(mode) {
    this.mode = mode;
  }

  reset() {
    this.effectBufferCtx.clearRect(0, 0, this.effectBuffer.width, this.effectBuffer.height);
    this.presenceBufferCtx.clearRect(0, 0, this.presenceBuffer.width, this.presenceBuffer.height);
    this.presenceEffectBufferCtx.clearRect(
      0,
      0,
      this.presenceEffectBuffer.width,
      this.presenceEffectBuffer.height,
    );
  }

  compositeOverlay(sourceCanvas) {
    this.ctx.save();
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = "lighter";
    this.ctx.filter = "none";
    this.ctx.drawImage(sourceCanvas, 0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
  }

  renderPresence(layerId, time, phase, opacity) {
    const effectConfig = this.config[layerId];
    const effect = effectsByType[effectConfig?.type];
    if (!effect || !this.layers[layerId]) return null;

    const { width, height } = this.canvas;
    this.presenceBufferCtx.clearRect(0, 0, width, height);
    const diagnostics = effect(this.layers[layerId], effectConfig, {
      ctx: this.presenceBufferCtx,
      width,
      height,
      time,
      phase,
      buffers: {
        effect: this.presenceEffectBuffer,
        effectCtx: this.presenceEffectBufferCtx,
      },
    });

    this.ctx.save();
    this.ctx.globalAlpha = opacity;
    this.ctx.globalCompositeOperation = "lighter";
    this.ctx.filter = "none";
    this.ctx.drawImage(this.presenceBuffer, 0, 0, width, height);
    this.ctx.restore();
    return diagnostics;
  }

  render(time, { phase = null } = {}) {
    const { width, height } = this.canvas;
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = "source-over";
    this.ctx.filter = "none";
    this.ctx.clearRect(0, 0, width, height);

    if (this.renderBaseImage) {
      const { breathingFrequency, breathingDepth, scaleFrequency, scaleDepth } =
        this.config.baseImage;
      const baseBreath = 1 + breathingDepth * Math.sin(TAU * breathingFrequency * time);
      const baseScale =
        1 + scaleDepth * (0.5 + 0.5 * Math.sin(TAU * scaleFrequency * time));
      this.ctx.filter = `brightness(${baseBreath})`;
      this.ctx.translate(width / 2, height / 2);
      this.ctx.scale(baseScale, baseScale);
      this.ctx.drawImage(this.images.original, -width / 2, -height / 2, width, height);
    }
    this.ctx.restore();

    if (this.mode === "CURRENT") {
      this.diagnostics = { mode: this.mode, type: "centralityGlow" };
      return this.diagnostics;
    }

    const effectConfig = this.config[this.mode];
    const effect = effectsByType[effectConfig?.type];
    if (!effect) throw new Error(`No existe un efecto visual para ${this.mode}.`);

    this.diagnostics = {
      mode: this.mode,
      ...effect(this.layers[this.mode], effectConfig, {
        ctx: this.ctx,
        width,
        height,
        time,
        phase,
        buffers: {
          effect: this.effectBuffer,
          effectCtx: this.effectBufferCtx,
        },
      }),
    };
    return this.diagnostics;
  }
}
