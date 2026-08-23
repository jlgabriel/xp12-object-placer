/**
 * Drawing one object into a small square.
 *
 * WebGL directly rather than a scene library: this draws a single mesh with one light from a fixed
 * camera, and the framing — the part that is actually hard — is solved arithmetically next door in
 * `core/thumbnail/framing.ts`, where it can be tested without a GPU.
 *
 * The context is reused across every thumbnail. Creating one per object would be the slow way to
 * do this and would also run into the browser's limit on live contexts, which is somewhere around
 * sixteen and produces the delightful failure of older thumbnails going black as new ones appear.
 */

import type { Bounds, Obj8Mesh } from '../../core/obj8/parse.js';
import { frameBounds, multiply, type FramingOptions } from '../../core/thumbnail/framing.js';

export interface ThumbnailTexture {
  readonly format: 'BC1' | 'BC3';
  readonly width: number;
  readonly height: number;
  /** Compressed blocks, straight out of the DDS. */
  readonly data: Uint8Array;
}

export interface ThumbnailRequest {
  readonly mesh: Obj8Mesh;
  readonly bounds: Bounds;
  readonly texture?: ThumbnailTexture;
  readonly framing?: FramingOptions;
}

const VERTEX_SHADER = `#version 300 es
in vec3 position;
in vec3 normal;
in vec2 uv;
uniform mat4 modelViewProjection;
out vec3 vNormal;
out vec2 vUv;
void main() {
  vNormal = normal;
  vUv = uv;
  gl_Position = modelViewProjection * vec4(position, 1.0);
}`;

/**
 * Two lights and an alpha cutout.
 *
 * The cutout is not a refinement. Fences, ladders, radio masts and every tree in the library are a
 * few quads with most of the texture transparent, and without `discard` each one renders as an
 * opaque rectangle — the thumbnail of a chain-link fence would be a grey square. 0.5 is X-Plane's
 * own default cutoff.
 *
 * The normal is flipped for back faces rather than culled. Stock objects are not reliably wound the
 * same way, and culling turns the wrong ones inside out, which reads as holes in the model. Drawing
 * both sides costs nothing at this size and cannot produce a hole.
 */
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec2 vUv;
uniform sampler2D albedo;
uniform bool hasTexture;
out vec4 colour;

const vec3 KEY = normalize(vec3(-0.5, 0.8, 0.35));
const vec3 FILL = normalize(vec3(0.6, 0.25, -0.5));

void main() {
  // ⚠️ The v flip is not a preference. OBJ8 texture coordinates put v=0 at the BOTTOM, while a
  // DDS stores its first row at the TOP, and UNPACK_FLIP_Y_WEBGL is ignored for compressed
  // textures — so the only place left to correct it is here. Without it every object samples the
  // mirror image of its own atlas: an orange barrier comes out grey because it is reading the
  // white one, and a chair reads a transparent strip and vanishes entirely.
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec4 base = hasTexture ? texture(albedo, uv) : vec4(0.72, 0.73, 0.75, 1.0);
  if (base.a < 0.5) discard;

  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  if (dot(n, n) < 0.001) n = vec3(0.0, 1.0, 0.0);

  float key = max(dot(n, KEY), 0.0);
  float fill = max(dot(n, FILL), 0.0);
  float light = 0.38 + 0.62 * key + 0.16 * fill;

  colour = vec4(base.rgb * light, 1.0);
}`;

const S3TC = {
  BC1: 0x83f1, // COMPRESSED_RGBA_S3TC_DXT1_EXT — the 1-bit alpha variant, for the cutout
  BC3: 0x83f3, // COMPRESSED_RGBA_S3TC_DXT5_EXT
} as const;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`thumbnail shader failed to compile: ${log ?? 'no reason given'}`);
  }
  return shader;
}

export interface ThumbnailRenderer {
  /** Draw one object. The pixels are the canvas's until the next call. */
  render(request: ThumbnailRequest): void;
  readonly canvas: OffscreenCanvas | HTMLCanvasElement;
  readonly supportsCompressedTextures: boolean;
  dispose(): void;
}

export function createThumbnailRenderer(
  canvas: OffscreenCanvas | HTMLCanvasElement,
): ThumbnailRenderer {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  }) as WebGL2RenderingContext | null;
  if (!gl) throw new Error('this machine cannot draw thumbnails: no WebGL 2');

  const s3tc = gl.getExtension('WEBGL_compressed_texture_s3tc');

  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`thumbnail program failed to link: ${gl.getProgramInfoLog(program)}`);
  }

  const attribute = {
    position: gl.getAttribLocation(program, 'position'),
    normal: gl.getAttribLocation(program, 'normal'),
    uv: gl.getAttribLocation(program, 'uv'),
  };
  const uniform = {
    modelViewProjection: gl.getUniformLocation(program, 'modelViewProjection'),
    albedo: gl.getUniformLocation(program, 'albedo'),
    hasTexture: gl.getUniformLocation(program, 'hasTexture'),
  };

  const buffers = {
    position: gl.createBuffer()!,
    normal: gl.createBuffer()!,
    uv: gl.createBuffer()!,
    index: gl.createBuffer()!,
  };
  const texture = gl.createTexture()!;
  const vao = gl.createVertexArray()!;

  gl.bindVertexArray(vao);
  for (const [name, buffer] of [
    ['position', buffers.position],
    ['normal', buffers.normal],
    ['uv', buffers.uv],
  ] as const) {
    const location = attribute[name];
    if (location < 0) continue;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, name === 'uv' ? 2 : 3, gl.FLOAT, false, 0, 0);
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
  gl.bindVertexArray(null);

  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);

  return {
    canvas,
    supportsCompressedTextures: s3tc !== null,

    render(request) {
      const { mesh, bounds } = request;
      const width = canvas.width;
      const height = canvas.height;

      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (mesh.indices.length === 0) return;

      gl.useProgram(program);
      gl.bindVertexArray(vao);

      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STREAM_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normal);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STREAM_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.uv);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.uvs, gl.STREAM_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STREAM_DRAW);

      const usable = request.texture !== undefined && s3tc !== null;
      if (usable) {
        const { format, width: textureWidth, height: textureHeight, data } = request.texture!;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.compressedTexImage2D(
          gl.TEXTURE_2D, 0, S3TC[format], textureWidth, textureHeight, 0, data,
        );
        // One level only, so no mipmapping: a thumbnail never minifies far enough to need it, and
        // asking for mipmaps from a single compressed level is an incomplete-texture black square.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.uniform1i(uniform.albedo, 0);
      }
      gl.uniform1i(uniform.hasTexture, usable ? 1 : 0);

      const framing = frameBounds(bounds, { aspect: width / height, ...request.framing });
      gl.uniformMatrix4fv(
        uniform.modelViewProjection,
        false,
        multiply(framing.projection, framing.view),
      );

      gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
    },

    dispose() {
      for (const buffer of Object.values(buffers)) gl.deleteBuffer(buffer);
      gl.deleteTexture(texture);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    },
  };
}
