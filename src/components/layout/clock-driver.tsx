"use client";

import { useClockDriver } from "@/hooks/use-clock";

/** Mounts the clock driver for the whole app. Renders nothing. */
export function ClockDriver() {
  useClockDriver();
  return null;
}
