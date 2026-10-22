import { useEffect, useId, useRef } from "react";
import { createCanvasAnimation } from "@/hooks/canvas-animation";
import { vertexShader, fragmentShader } from "./black-hole-shader";

function rgb(hex: string, fallback: [number, number, number]): [number, number, number] {
  const value = hex.trim().replace(/^#/, "");
  const expanded = value.length === 3 ? [...value].map((c) => c + c).join("") : value;
  if (!/^[a-f\d]{6}$/i.test(expanded)) return fallback;
  return [0, 2, 4].map((offset) => parseInt(expanded.slice(offset, offset + 2), 16) / 255) as [number, number, number];
}

/** Transparent Schwarzschild ray tracing, with a static illustration when WebGL is unavailable. */
export default function BlackHoleMark({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const id = useId().replace(/:/g, "");

  useEffect(() => {
    const canvas = ref.current;
    const element = mark.current;
    if (!canvas || !element) return;
    const gl = canvas.getContext("webgl", {
      alpha: true, premultipliedAlpha: true, antialias: false,
      depth: false, stencil: false, powerPreference: "low-power",
    });
    if (!gl || !gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision) return;

    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    let timeLocation: WebGLUniformLocation | null = null;
    let resolutionLocation: WebGLUniformLocation | null = null;
    let tintLocation: WebGLUniformLocation | null = null;
    let darkLocation: WebGLUniformLocation | null = null;
    let elapsed = 8;
    let lost = false;
    let disposed = false;
    let tint: [number, number, number] = [1, 0.72, 0.42];
    let isDark = 0;
    const compact = window.matchMedia("(pointer: coarse)").matches;

    const release = () => {
      if (program) gl.deleteProgram(program);
      if (buffer) gl.deleteBuffer(buffer);
      program = null;
      buffer = null;
    };
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn("Black hole shader unavailable:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };
    const initialize = () => {
      release();
      const vertex = compile(gl.VERTEX_SHADER, vertexShader);
      const fragment = compile(gl.FRAGMENT_SHADER, fragmentShader);
      if (!vertex || !fragment) {
        if (vertex) gl.deleteShader(vertex);
        if (fragment) gl.deleteShader(fragment);
        return;
      }
      program = gl.createProgram();
      if (program) {
        gl.attachShader(program, vertex);
        gl.attachShader(program, fragment);
        gl.linkProgram(program);
      }
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!program || !gl.getProgramParameter(program, gl.LINK_STATUS)) { release(); return; }
      buffer = gl.createBuffer();
      if (!buffer) { release(); return; }
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, "a_position");
      if (position < 0) { release(); return; }
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      timeLocation = gl.getUniformLocation(program, "u_time");
      resolutionLocation = gl.getUniformLocation(program, "u_resolution");
      tintLocation = gl.getUniformLocation(program, "u_tint");
      darkLocation = gl.getUniformLocation(program, "u_isDark");
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
    };

    const draw = (delta: number) => {
      if (lost || disposed || !program) return false;
      elapsed += delta / 1000;
      gl.useProgram(program);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.uniform1f(timeLocation, elapsed);
      gl.uniform3f(tintLocation, ...tint);
      gl.uniform1f(darkLocation, isDark);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (element.dataset.renderer !== "webgl") element.dataset.renderer = "webgl";
    };
    const animation = createCanvasAnimation(canvas, draw, compact ? 18 : 24);
    const resize = () => {
      if (disposed) return;
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      if (!cssWidth || !cssHeight) return;
      // Bound work even on high-DPR monitors; the logo never needs a full-resolution scene.
      const scale = Math.min(window.devicePixelRatio || 1, 1.5, (compact ? 240 : 320) / Math.max(cssWidth, cssHeight));
      const width = Math.max(1, Math.round(cssWidth * scale));
      const height = Math.max(1, Math.round(cssHeight * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      animation.requestRender();
    };
    const updateTheme = () => {
      const style = getComputedStyle(element);
      tint = rgb(style.getPropertyValue("--black-hole-tint"), [1, 0.72, 0.42]);
      const bg = rgb(style.getPropertyValue("--c-bg"), [1, 0.15, 0.25]);
      isDark = bg[0] * 0.2126 + bg[1] * 0.7152 + bg[2] * 0.0722 < 0.25 ? 1 : 0;
      animation.requestRender();
    };
    const onLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      delete element.dataset.renderer;
    };
    const onRestored = () => {
      if (disposed) return;
      lost = false;
      initialize();
      resize();
      updateTheme();
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    initialize();
    resize();
    updateTheme();
    const sizes = new ResizeObserver(resize);
    sizes.observe(canvas);
    const themes = new MutationObserver(updateTheme);
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      disposed = true;
      animation.dispose();
      sizes.disconnect();
      themes.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      delete element.dataset.renderer;
      release();
    };
  }, []);

  return (
    <span ref={mark} className={"black-hole-mark " + className} aria-hidden="true">
      <svg className="black-hole-fallback" viewBox="0 0 320 220" focusable="false">
        <defs>
          <linearGradient id={id + "-disk"} x1="0" x2="1">
            <stop offset="0" stopColor="#fff5d6" />
            <stop offset="0.35" stopColor="#ffd695" />
            <stop offset="1" stopColor="var(--black-hole-tint, #d98650)" />
          </linearGradient>
          <radialGradient id={id + "-halo"}>
            <stop offset="0.32" stopColor="var(--black-hole-tint, #fbbf86)" stopOpacity="0.24" />
            <stop offset="1" stopColor="var(--black-hole-tint, #fbbf86)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="160" cy="110" rx="146" ry="83" fill={"url(#" + id + "-halo)"} />
        <path d="M25 117 C83 108 109 108 118 87 C136 42 181 42 201 87 C211 109 239 110 295 117" fill="none" stroke={"url(#" + id + "-disk)"} strokeWidth="9" opacity="0.88" />
        <circle cx="160" cy="108" r="39" fill="#080706" />
        <circle cx="160" cy="108" r="40.5" fill="none" stroke={"url(#" + id + "-disk)"} strokeWidth="1.2" opacity="0.8" />
        <path d="M25 117 Q160 146 295 117 Q160 127 25 117" fill={"url(#" + id + "-disk)"} />
        <path d="M115 124 Q160 181 205 124" fill="none" stroke={"url(#" + id + "-disk)"} strokeWidth="2" opacity="0.55" />
      </svg>
      <canvas ref={ref} className="black-hole-canvas" />
    </span>
  );
}
