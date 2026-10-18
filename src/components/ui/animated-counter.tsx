"use client";

import React, { useEffect, useRef, useState } from "react";

interface AnimatedCounterProps {
  value: number | bigint;
  formatter?: (val: number) => string;
  prefix?: string;
  suffix?: string;
  durationMs?: number;
  className?: string;
}

export function AnimatedCounter({
  value,
  formatter,
  prefix = "",
  suffix = "",
  durationMs = 600,
  className = "",
}: AnimatedCounterProps) {
  const targetNumber = typeof value === "bigint" ? Number(value) : value;
  const [displayValue, setDisplayValue] = useState<number>(targetNumber);
  const previousValueRef = useRef<number>(targetNumber);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const startValue = previousValueRef.current;
    const endValue = targetNumber;
    const diff = endValue - startValue;

    if (prefersReducedMotion || Math.abs(diff) < 0.001) {
      previousValueRef.current = targetNumber;
      animationFrameRef.current = requestAnimationFrame(() => {
        setDisplayValue(endValue);
      });
      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      };
    }

    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      
      // Quartic ease-out curve
      const easeOut = 1 - Math.pow(1 - progress, 4);
      const current = startValue + diff * easeOut;

      setDisplayValue(current);

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayValue(endValue);
        previousValueRef.current = endValue;
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [targetNumber, durationMs]);

  const formatted = formatter
    ? formatter(displayValue)
    : displayValue.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <span className={`inline-block font-mono tabular-nums ${className}`}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
