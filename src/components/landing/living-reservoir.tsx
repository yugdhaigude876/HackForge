"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";

interface LivingReservoirProps {
  scrollProgress: number; // 0 to 1
  className?: string;
}

// Optimized analytical 3D Simplex noise in GLSL
const SIMPLEX_NOISE_GLSL = `
vec4 permute(vec4 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;

  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3  ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

// Fluid outer vertex shader
const FLUID_VERTEX_SHADER = `
${SIMPLEX_NOISE_GLSL}

uniform float uTime;
uniform float uSpeed;
uniform float uFrequency;
uniform float uAmplitude;
uniform float uPullback;
uniform vec2 uMouse;

varying vec3 vNormal;
varying vec3 vPosition;
varying float vDisplacement;
varying vec3 vViewPosition;

void main() {
  vNormal = normalize(normalMatrix * normal);
  
  // Calculate noise displacement along surface normal
  vec3 noisePos = position * uFrequency + vec3(uMouse * 0.5, uTime * uSpeed);
  float noiseVal = snoise(noisePos);
  
  // Secondary octave for micro-surface ripple turbulence
  float microNoise = snoise(position * (uFrequency * 2.2) - vec3(0.0, uTime * (uSpeed * 1.5), 0.0)) * 0.35;
  float totalNoise = (noiseVal + microNoise);
  vDisplacement = totalNoise;
  
  // Pullback shrinks outer fluid to expose gold reserve nucleus
  float scaleFactor = 1.0 - (uPullback * 0.45);
  vec3 displacedPosition = (position * scaleFactor) + normal * (totalNoise * uAmplitude * scaleFactor);
  
  vec4 mvPosition = modelViewMatrix * vec4(displacedPosition, 1.0);
  vViewPosition = -mvPosition.xyz;
  vPosition = displacedPosition;
  
  gl_Position = projectionMatrix * mvPosition;
}
`;

// Fluid outer fragment shader (Refraction, Fresnel, Crimson pulse veins)
const FLUID_FRAGMENT_SHADER = `
uniform float uTime;
uniform float uCrimsonShock;
uniform float uPullback;
uniform vec2 uMouse;

varying vec3 vNormal;
varying vec3 vPosition;
varying float vDisplacement;
varying vec3 vViewPosition;

void main() {
  vec3 viewDir = normalize(vViewPosition);
  vec3 normal = normalize(vNormal);
  
  // Fresnel reflection factor
  float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 2.8);
  
  // Deep sea obsidian base color (#0B1220 to #070B14)
  vec3 baseColor = vec3(0.04, 0.07, 0.14);
  vec3 rimColor = vec3(0.23, 0.51, 0.96); // Electric Treasury Blue (#3B82F6)
  
  // Mouse highlight refraction
  float mouseEffect = clamp(dot(normal, vec3(uMouse, 1.0)), 0.0, 1.0);
  rimColor += vec3(0.1, 0.3, 0.7) * mouseEffect * 0.4;
  
  // Crimson shock veins on displacement ridges when uCrimsonShock > 0
  vec3 crimsonColor = vec3(0.94, 0.27, 0.27); // Signal Crimson (#EF4444)
  float ridge = smoothstep(0.35, 0.85, abs(vDisplacement));
  float crimsonPulse = ridge * uCrimsonShock * (0.6 + 0.4 * sin(uTime * 6.0));
  
  vec3 finalColor = mix(baseColor, rimColor, fresnel * 0.85);
  finalColor = mix(finalColor, crimsonColor, crimsonPulse);
  
  // Translucency decreases as outer fluid pulls back
  float alpha = clamp(0.72 - (uPullback * 0.4), 0.25, 0.85);
  
  gl_FragColor = vec4(finalColor, alpha);
}
`;

export function LivingReservoir({ scrollProgress, className = "" }: LivingReservoirProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [hasWebGL] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const canvas = document.createElement("canvas");
      return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch {
      return false;
    }
  });
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  // Animation & uniform references
  const uniformsRef = useRef({
    uTime: { value: 0 },
    uSpeed: { value: 0.3 },
    uFrequency: { value: 0.85 },
    uAmplitude: { value: 0.28 },
    uCrimsonShock: { value: 0.0 },
    uPullback: { value: 0.0 },
    uMouse: { value: new THREE.Vector2(0, 0) },
  });

  const mouseTargetRef = useRef(new THREE.Vector2(0, 0));
  const mouseDampedRef = useRef(new THREE.Vector2(0, 0));
  const isVisibleRef = useRef(true);
  const lastActiveTimeRef = useRef(0);
  const animationFrameIdRef = useRef<number | null>(null);

  // Check reduced motion media query changes
  useEffect(() => {
    lastActiveTimeRef.current = Date.now();
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  // Update uniforms based on scroll narrative
  useEffect(() => {
    const u = uniformsRef.current;
    
    // 0% -> Hero resting state (speed 0.3)
    // 30% -> Volatility Shock (double frequency, crimson veins)
    // 60% -> Phase Separation (pullback reveals gold core)
    // 85% -> 4-Tier Routing
    if (scrollProgress <= 0.2) {
      const t = scrollProgress / 0.2;
      u.uSpeed.value = 0.3 + t * 0.2;
      u.uFrequency.value = 0.85 + t * 0.4;
      u.uAmplitude.value = 0.28;
      u.uCrimsonShock.value = 0.0;
      u.uPullback.value = 0.0;
    } else if (scrollProgress <= 0.5) {
      // 30% shock: Crimson pulse along ridges, doubled frequency
      const t = (scrollProgress - 0.2) / 0.3;
      u.uSpeed.value = 0.5 + t * 0.6;
      u.uFrequency.value = 1.25 + t * 0.85; // doubles to ~2.1
      u.uAmplitude.value = 0.28 + t * 0.15;
      u.uCrimsonShock.value = Math.sin(t * Math.PI) * 1.0;
      u.uPullback.value = t * 0.2;
    } else if (scrollProgress <= 0.8) {
      // 60% phase separation: outer fluid pulls back to reveal golden nucleus
      const t = (scrollProgress - 0.5) / 0.3;
      u.uSpeed.value = 1.1 - t * 0.5;
      u.uFrequency.value = 2.1 - t * 0.7;
      u.uAmplitude.value = 0.43 - t * 0.12;
      u.uCrimsonShock.value = Math.max(0, 1.0 - t * 2.0);
      u.uPullback.value = 0.2 + t * 0.8; // pullback reaches 1.0
    } else {
      // 85% - 100%: Routing & terminal transition
      u.uSpeed.value = 0.4;
      u.uFrequency.value = 1.1;
      u.uAmplitude.value = 0.25;
      u.uCrimsonShock.value = 0.0;
      u.uPullback.value = 1.0;
    }

    lastActiveTimeRef.current = Date.now();
  }, [scrollProgress]);

  // Pointer event handlers with subtle damping
  const handlePointerMove = useCallback((e: MouseEvent) => {
    const x = (e.clientX / window.innerWidth) * 2 - 1;
    const y = -(e.clientY / window.innerHeight) * 2 + 1;
    mouseTargetRef.current.set(x * 0.8, y * 0.8);
    lastActiveTimeRef.current = Date.now();
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [handlePointerMove]);

  // Three.js scene setup
  useEffect(() => {
    const container = mountRef.current;
    if (!container || !hasWebGL || prefersReducedMotion) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 0, 4.8);

    // Renderer with DPR clamped between 1 and 1.75
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(dpr);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // 1. Inner Nucleus: Basel III Reserve Floor R (dense bioluminescent gold sphere)
    const nucleusGeometry = new THREE.SphereGeometry(0.85, 64, 64);
    const nucleusMaterial = new THREE.MeshStandardMaterial({
      color: 0xFBBF24, // Institutional Gold
      emissive: 0xF59E0B,
      emissiveIntensity: 0.85,
      metalness: 0.3,
      roughness: 0.15,
    });
    const nucleusMesh = new THREE.Mesh(nucleusGeometry, nucleusMaterial);
    scene.add(nucleusMesh);

    // Nucleus point light radiating through outer liquid
    const coreLight = new THREE.PointLight(0xFBBF24, 2.5, 8);
    nucleusMesh.add(coreLight);

    // 2. Outer Liquid: Surplus Cash (high-refraction translucent sphere with noise displacement)
    const outerGeometry = new THREE.SphereGeometry(1.65, 128, 128);
    const outerMaterial = new THREE.ShaderMaterial({
      vertexShader: FLUID_VERTEX_SHADER,
      fragmentShader: FLUID_FRAGMENT_SHADER,
      uniforms: uniformsRef.current,
      transparent: true,
      depthWrite: false,
    });
    const outerMesh = new THREE.Mesh(outerGeometry, outerMaterial);
    scene.add(outerMesh);

    // 3. Particle Streamlines (surplus fluid branching into 3 nodes)
    const particleCount = 120;
    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const particleSpeeds = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2;
      const radius = 1.7 + Math.random() * 1.5;
      particlePositions[i * 3] = Math.cos(angle) * radius;
      particlePositions[i * 3 + 1] = (Math.random() - 0.5) * 1.8;
      particlePositions[i * 3 + 2] = Math.sin(angle) * radius;
      particleSpeeds[i] = 0.5 + Math.random() * 1.0;
    }
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));

    const particleMaterial = new THREE.PointsMaterial({
      color: 0x3B82F6,
      size: 0.04,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
    });
    const particleSystem = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particleSystem);

    // Ambient & Directional Lights
    const ambientLight = new THREE.AmbientLight(0x0B1220, 1.5);
    scene.add(ambientLight);

    const rimLight = new THREE.DirectionalLight(0x3B82F6, 2.0);
    rimLight.position.set(5, 5, 5);
    scene.add(rimLight);

    const goldFillLight = new THREE.DirectionalLight(0xFBBF24, 1.2);
    goldFillLight.position.set(-5, -3, -3);
    scene.add(goldFillLight);

    // IntersectionObserver to throttle when offscreen
    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisibleRef.current = entry.isIntersecting;
      },
      { threshold: 0.05 }
    );
    observer.observe(container);

    // Resize handler
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    // Animation Loop
    const clock = new THREE.Clock();

    const animate = () => {
      animationFrameIdRef.current = requestAnimationFrame(animate);

      if (!isVisibleRef.current) return;

      const elapsedTime = clock.getElapsedTime();

      // Mouse damping
      mouseDampedRef.current.lerp(mouseTargetRef.current, 0.05);
      uniformsRef.current.uMouse.value.copy(mouseDampedRef.current);
      uniformsRef.current.uTime.value = elapsedTime;

      // Rotate meshes gently
      outerMesh.rotation.y = elapsedTime * 0.12 + mouseDampedRef.current.x * 0.3;
      outerMesh.rotation.x = mouseDampedRef.current.y * 0.2;

      // Nucleus breathing pulse
      const pulse = 1.0 + Math.sin(elapsedTime * 2.0) * 0.04;
      nucleusMesh.scale.set(pulse, pulse, pulse);
      nucleusMesh.rotation.y = -elapsedTime * 0.08;

      // Animate particles along radius
      const positions = particleGeometry.attributes.position.array as Float32Array;
      for (let i = 0; i < particleCount; i++) {
        const idx = i * 3;
        positions[idx + 1] += Math.sin(elapsedTime * particleSpeeds[i] + i) * 0.003;
      }
      particleGeometry.attributes.position.needsUpdate = true;
      particleSystem.rotation.y = elapsedTime * 0.05;

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleResize);
      if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
      renderer.dispose();
      nucleusGeometry.dispose();
      nucleusMaterial.dispose();
      outerGeometry.dispose();
      outerMaterial.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
      if (container && renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [hasWebGL, prefersReducedMotion]);

  if (!hasWebGL || prefersReducedMotion) {
    // Clean CSS fallback with layered radial gradients
    return (
      <div className={`relative flex items-center justify-center overflow-hidden ${className}`}>
        <div className="absolute h-72 w-72 rounded-full bg-gradient-to-tr from-accent-gold/40 to-accent-blue/40 blur-[80px] animate-pulse" />
        <div className="relative h-48 w-48 rounded-full border border-border-strong bg-surface/80 p-4 shadow-2xl backdrop-blur-xl flex flex-col items-center justify-center text-center">
          <div className="h-20 w-20 rounded-full bg-accent-gold/20 border border-accent-gold/50 flex items-center justify-center shadow-[0_0_25px_rgba(251,191,36,0.5)]">
            <span className="font-mono text-xs font-bold text-accent-gold">BASEL III</span>
          </div>
          <span className="mt-2 text-[10px] font-mono text-muted uppercase">Liquid Reservoir Core</span>
        </div>
      </div>
    );
  }

  return <div ref={mountRef} className={`relative w-full h-full ${className}`} />;
}
