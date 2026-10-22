/**
 * @license MIT
 * Compact, transparent Schwarzschild ray tracer for the TruthLens wordmark.
 * Adapted from GARGANTUA's geodesic and blackbody implementations:
 * https://github.com/Matrix4096/gargantua/blob/main/js/shaders/geodesic.glsl.js
 * https://github.com/Matrix4096/gargantua/blob/main/js/shaders/common.glsl.js
 * Physics: https://github.com/Matrix4096/gargantua/blob/main/docs/PHYSICS.md
 *
 * MIT License
 * Copyright (c) 2026 player4086
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * Contract: GLSL ES 1.00; a_position is a fullscreen vec2 triangle/quad.
 * u_resolution is drawing-buffer size; u_time is elapsed seconds; u_tint is
 * the theme accent in sRGB [0,1]; u_isDark is 0 for light / 1 for dark surfaces.
 * Output is PREMULTIPLIED alpha. Use premultipliedAlpha:true, transparent clear,
 * and no GL blending for this fullscreen pass. No textures or Three.js needed.
 * The wrapper should choose its static fallback if fragment highp is unavailable.
 */

export const vertexShader = /* glsl */ `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const fragmentShader = /* glsl */ `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_tint;
uniform float u_isDark;

// G = c = 1; r_s = 2M = 1. Photon sphere: 1.5; ISCO: 3.
const float MASS = 0.5;
const float DISK_INNER = 3.0;
const float DISK_OUTER = 8.2;
const int MAX_STEPS = 160;

float hash3(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
  vec3 cell = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(cell), hash3(cell + vec3(1,0,0)), f.x),
        mix(hash3(cell + vec3(0,1,0)), hash3(cell + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash3(cell + vec3(0,0,1)), hash3(cell + vec3(1,0,1)), f.x),
        mix(hash3(cell + vec3(0,1,1)), hash3(cell + vec3(1,1,1)), f.x), f.y), f.z);
}

// Planckian locus -> XYZ -> linear sRGB, normalised separately from radiance.
// Work in inverse temperature to avoid unnecessarily large intermediate values.
vec3 blackbody(float temperature) {
  float t = clamp(temperature, 1800.0, 14000.0);
  float q = 1000.0 / t;
  float x;
  if (t < 4000.0) {
    x = -0.2661239*q*q*q - 0.2343580*q*q + 0.8776956*q + 0.179910;
  } else {
    x = -3.0258469*q*q*q + 2.1070379*q*q + 0.2226347*q + 0.240390;
  }
  float y;
  if (t < 2222.0) {
    y = -1.1063814*x*x*x - 1.34811020*x*x + 2.18555832*x - 0.20219683;
  } else if (t < 4000.0) {
    y = -0.9549476*x*x*x - 1.37418593*x*x + 2.09137015*x - 0.16748867;
  } else {
    y = 3.0817580*x*x*x - 5.87338670*x*x + 3.75112997*x - 0.37001483;
  }
  y = max(y, 0.001);
  float X = x/y;
  float Z = (1.0-x-y)/y;
  vec3 rgb = max(vec3(
    3.2404542*X - 1.5371385 - 0.4985314*Z,
    -0.9692660*X + 1.8760108 + 0.0415560*Z,
    0.0556434*X - 0.2040259 + 1.0572252*Z), vec3(0.0));
  return rgb / max(max(rgb.r, rgb.g), max(rgb.b, 0.0001));
}

vec3 toSRGB(vec3 color) {
  color = max(color, vec3(0.0));
  return mix(color * 12.92,
    1.055 * pow(max(color, vec3(0.00001)), vec3(1.0/2.4)) - 0.055,
    step(vec3(0.0031308), color));
}

vec2 derivative(vec2 state) {
  return vec2(state.y, -state.x + 1.5 * state.x * state.x);
}

vec2 rk4(vec2 state, float h) {
  vec2 k1 = derivative(state);
  vec2 k2 = derivative(state + 0.5*h*k1);
  vec2 k3 = derivative(state + 0.5*h*k2);
  vec2 k4 = derivative(state + h*k3);
  return state + (h/6.0) * (k1 + 2.0*k2 + 2.0*k3 + k4);
}

void main() {
  // Scale by width, so the physical disk occupies ~80% of the canvas width.
  // A 1.6--1.9:1 canvas comfortably contains the entire lensed upper arc.
  vec2 screen = (gl_FragCoord.xy - 0.5*u_resolution) / max(u_resolution.x, 1.0) * 21.0;
  screen = mat2(0.9976, -0.0698, 0.0698, 0.9976) * screen;
  vec3 ro = vec3(0.0, 4.3, 36.0);
  float cameraRadius = length(ro);
  vec3 a = ro / cameraRadius;
  vec3 right = vec3(1.0, 0.0, 0.0);
  vec3 up = normalize(cross(a, right));
  vec3 rd = normalize(-a + (right*screen.x + up*screen.y) / cameraRadius);
  vec3 perpendicular = rd - a * dot(rd, a);
  float perpendicularLength = length(perpendicular);

  // Exactly radial rays have no orbital plane and hit the horizon directly.
  if (perpendicularLength < 0.00001) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec3 b = perpendicular / perpendicularLength;
  float initialU = 1.0 / cameraRadius;
  vec2 state = vec2(initialU, -initialU * dot(rd, a) / perpendicularLength);
  float impact = inversesqrt(max(state.y*state.y + initialU*initialU*(1.0-initialU), 0.00000001));
  // Photon angular momentum has opposite sign to our backward-traced ray.
  float bPhi = -impact * cross(a, b).y;
  float phi = 0.0;
  float previousHeight = a.y;
  float transmittance = 1.0;
  float captured = 0.0;
  float photonDwell = 0.0;
  vec3 radiance = vec3(0.0);
  int diskHits = 0;

  for (int i = 0; i < MAX_STEPS; i++) {
    // Outside the emitting disk and heading out: no sky/background to sample.
    if (state.x < 1.0/24.0 && state.y < 0.0) break;

    float h = clamp(0.035 / max(state.x, 0.001), 0.028, 0.14);
    // Never step across u=0 in the far field; this is essential for escaping rays.
    h = min(h, 0.42 * state.x / max(abs(state.y), 0.000001));
    h = max(h, 0.00002);
    vec2 next = rk4(state, h);
    float nextPhi = phi + h;

    // A pathological numerical step must not paint an opaque rectangular background.
    if (!(next.x > 0.000001) || next.x > 1000.0 || abs(next.y) > 10000.0) break;

    float c = cos(nextPhi);
    float s = sin(nextPhi);
    // Only the sign is needed: omit the expensive position / u until a crossing.
    float nextHeight = c*a.y + s*b.y;
    if (previousHeight*nextHeight < 0.0 && diskHits < 4) {
      float fraction = clamp(previousHeight / (previousHeight-nextHeight), 0.0, 1.0);
      vec2 hit = mix(state, next, fraction);
      float hitPhi = mix(phi, nextPhi, fraction);
      float r = 1.0 / max(hit.x, 0.000001);
      if (r > DISK_INNER && r < DISK_OUTER) {
        diskHits++;
        vec3 radial = cos(hitPhi)*a + sin(hitPhi)*b;
        vec3 angular = -sin(hitPhi)*a + cos(hitPhi)*b;
        vec3 position = r * radial;
        vec3 direction = normalize(-hit.y * radial + hit.x * angular);
        float cosIncidence = max(abs(direction.y), 0.035);
        float omega = sqrt(MASS / (r*r*r));
        // Disk basis (e1=+Z, e2=+X) follows +Y angular momentum, matching bPhi.
        float azimuth = atan(position.x, position.z);
        // Time only advects a fixed texture. There is no frame-wise/random flicker.
        float orbit = azimuth - omega*u_time*3.2;
        vec3 flow = vec3(cos(orbit), sin(orbit), r*0.28);
        float coarse = noise3(flow*3.8);
        float fine = noise3(flow*10.2 + vec3(13.1, 4.7, 7.3));
        float filaments = 0.5 + 0.5*sin(38.0*log(r) + 3.0*sin(2.0*orbit) + 5.0*coarse);
        float density = (0.62 + 0.50*coarse + 0.25*fine) * (0.72 + 0.28*filaments);
        float rim = smoothstep(DISK_INNER, DISK_INNER+0.20, r)
                  * (1.0-smoothstep(DISK_OUTER-1.25, DISK_OUTER, r));
        density *= rim;

        float innerRatio = DISK_INNER/r;
        float profile = pow(innerRatio, 0.75)
          * pow(max(1.0-sqrt(innerRatio), 0.0), 0.25) / 0.4848;
        profile = clamp(profile, 0.0, 1.0);
        // Exact circular-emitter shift at infinity: redshift and Doppler together.
        float shift = sqrt(max(1.0-1.5/r, 0.02)) / max(1.0-omega*bPhi, 0.08);
        shift = clamp(shift, 0.30, 2.20);
        float flux = pow(profile*shift, 4.0);
        vec3 heat = blackbody(4800.0*profile*shift);
        // The incandescent core stays thermal; theme color only touches cooler edges.
        float edgeTint = (1.0-profile) * 0.10;
        vec3 themeLinear = pow(clamp(u_tint, 0.0, 1.0), vec3(2.2));
        heat = mix(heat, themeLinear, edgeTint);

        float thickness = 0.045 + 0.035*r/DISK_OUTER;
        float tau = 8.5*density*thickness/cosIncidence;
        float opacity = 1.0-exp(-tau);
        vec3 emission = heat * flux * density * mix(2.8, 3.5, clamp(u_isDark, 0.0, 1.0));
        radiance += transmittance * emission * opacity;
        transmittance *= 1.0-opacity;
      }
    }

    // A subpixel photon glow depends on actual residence near the unstable orbit,
    // not a hand-drawn ellipse. Multiple disk crossings create the principal ring.
    float radius = 1.0/next.x;
    photonDwell += (1.0-smoothstep(0.035, 0.16, abs(radius-1.5))) * h;

    if (next.x >= 1.0) { captured = 1.0; break; }
    if (transmittance < 0.015) break;
    state = next;
    phi = nextPhi;
    previousHeight = nextHeight;
  }

  float ringOpacity = 0.38*smoothstep(0.35, 1.8, photonDwell);
  radiance += transmittance * blackbody(6200.0) * ringOpacity * 1.35;
  transmittance *= 1.0-ringOpacity;
  float emissionCoverage = 1.0-transmittance;
  float alpha = emissionCoverage + transmittance*captured;
  if (alpha < 0.0001) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Tone-map the emitting surface before alpha composition; otherwise transparent
  // fringes become black halos against the red/paper/warning theme backgrounds.
  vec3 surface = radiance / max(emissionCoverage, 0.0001);
  surface = surface / (vec3(1.0) + surface);
  vec3 premultiplied = toSRGB(surface) * emissionCoverage;
  gl_FragColor = vec4(premultiplied, clamp(alpha, 0.0, 1.0));
}
`;
