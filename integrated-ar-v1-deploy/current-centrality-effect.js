const vertexShaderSource = `#version 300 es
in vec2 aPosition;
out vec2 vUv;

void main() {
  vUv = vec2((aPosition.x + 1.0) * 0.5, (1.0 - aPosition.y) * 0.5);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

function makeFragmentShader(maxFoci) {
  // Port directo del shader de obras_ar_stable/previo.html.
  return `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uTime;
uniform float uGlowGain;
uniform float uBaseGain;
uniform float uAspectCorrection;
uniform float uBreathingFrequency;
uniform float uBreathingDepth;
uniform vec2 uFocusUv[${maxFoci}];
uniform float uFocusW[${maxFoci}];

float gaussian(float x, float width) {
  return exp(-(x*x) / max(0.0001, width*width));
}

void main() {
  vec4 tex = texture(uTex, vUv);
  if (tex.a < 0.008) discard;

  vec2 centered = vUv - vec2(0.5);
  centered.x *= uAspectCorrection;
  float radial = length(centered);

  float pathEnergy = 0.0;
  for (int i = 0; i < ${maxFoci}; i++) {
    vec2 d = vUv - uFocusUv[i];
    d.x *= uAspectCorrection;
    float dst = length(d);
    float head = gaussian(dst, 0.050 + 0.010*sin(uTime*1.2 + float(i)*0.55));
    float halo = gaussian(dst, 0.105);
    float circuit = 0.5 + 0.5*sin(uTime*4.2 - dst*34.0 + vUv.y*9.0 + float(i)*0.45);
    circuit = pow(circuit, 3.5);
    pathEnergy += uFocusW[i] * (head * 1.45 + halo * 0.38 + circuit * halo * 0.68);
  }

  float breathing = 1.0 + uBreathingDepth *
    sin(uTime * 6.28318530718 * uBreathingFrequency);
  float coreSuppression = 1.0 - smoothstep(0.78, 1.05, radial);
  float energy = uBaseGain * (0.08 + pathEnergy * 1.05) *
    coreSuppression * breathing;

  vec3 warm = tex.rgb * vec3(1.12, 1.05, 0.92);
  vec3 color = warm * (1.0 + energy * uGlowGain);
  float alpha = tex.a * clamp(energy, 0.0, 1.75);
  outColor = vec4(color, alpha);
}
`;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`No se pudo compilar CURRENT: ${message}`);
  }
  return shader;
}

function createProgram(gl, maxFoci) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, makeFragmentShader(maxFoci));
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`No se pudo enlazar CURRENT: ${message}`);
  }
  return program;
}

async function loadImage(url) {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  return image;
}

function createTexture(gl, image) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  return texture;
}

export class CurrentCentralityEffect {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    this.gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!this.gl) {
      throw new Error("CURRENT requiere WebGL2 para conservar el shader de la obra anterior.");
    }

    this.program = createProgram(this.gl, config.maxFoci);
    this.focusHistory = [];
    this.focusCoordinates = new Float32Array(config.maxFoci * 2);
    this.focusWeights = new Float32Array(config.maxFoci);
    this.textures = [];
    this.ready = false;
    this.diagnostics = { focusCount: 0, activeWeight: 0 };

    this.locations = {
      position: this.gl.getAttribLocation(this.program, "aPosition"),
      texture: this.gl.getUniformLocation(this.program, "uTex"),
      time: this.gl.getUniformLocation(this.program, "uTime"),
      glowGain: this.gl.getUniformLocation(this.program, "uGlowGain"),
      baseGain: this.gl.getUniformLocation(this.program, "uBaseGain"),
      aspectCorrection: this.gl.getUniformLocation(this.program, "uAspectCorrection"),
      breathingFrequency: this.gl.getUniformLocation(this.program, "uBreathingFrequency"),
      breathingDepth: this.gl.getUniformLocation(this.program, "uBreathingDepth"),
      focusUv: this.gl.getUniformLocation(this.program, "uFocusUv[0]"),
      focusW: this.gl.getUniformLocation(this.program, "uFocusW[0]"),
    };

    const vertices = new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1,
    ]);
    this.vertexBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);
  }

  async initialize(traceUrl, glowUrl) {
    const [traceImage, glowImage] = await Promise.all([
      loadImage(traceUrl),
      loadImage(glowUrl),
    ]);
    this.textures = [
      {
        texture: createTexture(this.gl, traceImage),
        glowGain: this.config.traceGlowGain,
        baseGain: this.config.traceBaseGain,
      },
      {
        texture: createTexture(this.gl, glowImage),
        glowGain: this.config.glowGlowGain,
        baseGain: this.config.glowBaseGain,
      },
    ];
    this.ready = true;
  }

  resize(width, height) {
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  setPointer(u, v, time) {
    const point = { u, v, time };
    const last = this.focusHistory.at(-1);
    const distance = last ? Math.hypot(last.u - u, last.v - v) : Infinity;
    if (!last || distance > 0.012 || time - last.time > 0.07) {
      this.focusHistory.push(point);
    } else {
      Object.assign(last, point);
    }
    while (this.focusHistory.length > this.config.maxFoci) this.focusHistory.shift();
  }

  clearPointer() {
    // El historial se extingue por tiempo como en la obra AR; no se corta en seco.
  }

  reset() {
    this.focusHistory = [];
    this.focusCoordinates.fill(0.5);
    this.focusWeights.fill(0);
  }

  updateFocus(time) {
    while (
      this.focusHistory.length &&
      time - this.focusHistory[0].time > this.config.focusLife
    ) {
      this.focusHistory.shift();
    }

    let activeWeight = 0;
    for (let index = 0; index < this.config.maxFoci; index += 1) {
      const item = this.focusHistory[this.focusHistory.length - 1 - index];
      if (item) {
        const age = Math.max(0, time - item.time);
        const weight = Math.pow(Math.max(0, 1 - age / this.config.focusLife), 1.2);
        this.focusCoordinates[index * 2] = item.u;
        this.focusCoordinates[index * 2 + 1] = item.v;
        this.focusWeights[index] = weight;
        activeWeight += weight;
      } else {
        this.focusCoordinates[index * 2] = 0.5;
        this.focusCoordinates[index * 2 + 1] = 0.5;
        this.focusWeights[index] = 0;
      }
    }
    this.diagnostics = { focusCount: this.focusHistory.length, activeWeight };
  }

  render(time) {
    if (!this.ready) return this.diagnostics;
    const gl = this.gl;
    this.updateFocus(time);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.enableVertexAttribArray(this.locations.position);
    gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(this.locations.texture, 0);
    gl.uniform1f(this.locations.time, time);
    gl.uniform1f(this.locations.aspectCorrection, this.config.aspectCorrection);
    gl.uniform1f(this.locations.breathingFrequency, this.config.breathingFrequency);
    gl.uniform1f(this.locations.breathingDepth, this.config.breathingDepth);
    gl.uniform2fv(this.locations.focusUv, this.focusCoordinates);
    gl.uniform1fv(this.locations.focusW, this.focusWeights);

    for (const pass of this.textures) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, pass.texture);
      gl.uniform1f(this.locations.glowGain, pass.glowGain);
      gl.uniform1f(this.locations.baseGain, pass.baseGain);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.flush();
    return this.diagnostics;
  }

  clear() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}
