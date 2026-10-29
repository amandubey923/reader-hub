"use client";

import React, { useRef } from "react";

export type BodhiMood = "idle" | "thinking" | "speaking" | "happy" | "error";

interface BodhiRobotProps {
  mood: BodhiMood;
  size?: number;
  /** Head follows the pointer when hovering (desktop). */
  interactive?: boolean;
  showBook?: boolean;
}

/**
 * Bodhi — a small CSS-3D robot sitting on an open book (Architect Ivory & Gold).
 * Pure CSS transforms and gradients; animations are paused for prefers-reduced-motion.
 */
export default function BodhiRobot({ mood, size = 92, interactive = true, showBook = true }: BodhiRobotProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  const onPointerMove = (e: React.PointerEvent) => {
    if (!interactive || e.pointerType !== "mouse" || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    rootRef.current.style.setProperty("--look-x", x.toFixed(2));
    rootRef.current.style.setProperty("--look-y", y.toFixed(2));
  };

  const onPointerLeave = () => {
    rootRef.current?.style.setProperty("--look-x", "0");
    rootRef.current?.style.setProperty("--look-y", "0");
  };

  return (
    <div
      ref={rootRef}
      className="bodhi"
      data-mood={mood}
      style={{ ["--s" as string]: `${size}px` }}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      aria-hidden="true"
    >
      <div className="bodhi-stage">
        <div className="bodhi-bot">
          <div className="bodhi-antenna">
            <span className="bodhi-bulb" />
          </div>
          <div className="bodhi-head">
            <div className="bodhi-visor">
              <span className="bodhi-eye bodhi-eye-l" />
              <span className="bodhi-eye bodhi-eye-r" />
              <span className="bodhi-mouth">
                <i />
                <i />
                <i />
              </span>
            </div>
            <span className="bodhi-ear bodhi-ear-l" />
            <span className="bodhi-ear bodhi-ear-r" />
          </div>
          <div className="bodhi-body">
            <span className="bodhi-core" />
          </div>
          <span className="bodhi-arm bodhi-arm-l" />
          <span className="bodhi-arm bodhi-arm-r" />
          <span className="bodhi-leg bodhi-leg-l" />
          <span className="bodhi-leg bodhi-leg-r" />
        </div>
        {showBook && (
          <div className="bodhi-book">
            <span className="bodhi-cover" />
            <span className="bodhi-page bodhi-page-l" />
            <span className="bodhi-page bodhi-page-r" />
            <span className="bodhi-flutter" />
          </div>
        )}
      </div>
    </div>
  );
}
