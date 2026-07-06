"use client";

import { useEffect, useRef } from "react";

export type TeacherState = "idle" | "speaking" | "listening" | "thinking" | "happy" | "oops";

/**
 * Sofía — the animated teacher. Hand-built SVG with situational poses
 * (CSS-driven) and real lip-sync: a WebAudio analyser taps the live
 * session audio and drives the mouth viseme + jaw via data attributes,
 * without React re-renders. The state + mouth-level contract maps 1:1
 * onto a Rive state machine if we swap in a .riv character later.
 */
export function Teacher({
  state,
  audioRef,
  size = 128,
}: {
  state: TeacherState;
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  size?: number;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useMouthDriver(audioRef ?? null, rootRef, state === "speaking");

  return (
    <div
      ref={rootRef}
      className={`teacher teacher-${state} shrink-0`}
      data-viseme="0"
      style={{ width: size, height: size * 1.1 }}
      aria-hidden
    >
      <svg viewBox="0 0 200 220" className="h-full w-full">
        {/* torso */}
        <path
          d="M 52 220 Q 54 178 78 168 L 122 168 Q 146 178 148 220 Z"
          fill="var(--primary)"
        />
        <path d="M 92 168 L 100 184 L 108 168 Z" fill="var(--surface)" />
        <circle cx="100" cy="192" r="4" fill="var(--gold)" />

        {/* neck */}
        <rect x="91" y="146" width="18" height="26" rx="8" fill="#e9b58c" />

        {/* head */}
        <g className="t-head">
          {/* hair back + bun */}
          <ellipse cx="100" cy="98" rx="46" ry="50" fill="#4c3226" />
          <circle cx="100" cy="42" r="17" fill="#4c3226" />
          <circle cx="100" cy="42" r="17" fill="none" stroke="#3a251c" strokeWidth="2" opacity="0.5" />

          {/* ears + earrings */}
          <circle cx="58" cy="108" r="7" fill="#f3c9a4" />
          <circle cx="142" cy="108" r="7" fill="#f3c9a4" />
          <circle cx="58" cy="121" r="3.5" fill="var(--gold)" />
          <circle cx="142" cy="121" r="3.5" fill="var(--gold)" />

          {/* face */}
          <ellipse cx="100" cy="106" rx="40" ry="44" fill="#f3c9a4" />

          {/* fringe */}
          <path
            d="M 60 96 Q 62 56 100 52 Q 138 56 140 96 Q 128 68 104 67 Q 112 74 110 82 Q 96 68 78 74 Q 66 80 60 96 Z"
            fill="#4c3226"
          />

          {/* brows */}
          <rect className="t-brow-l" x="74" y="87" width="16" height="4" rx="2" fill="#4c3226" />
          <rect className="t-brow-r" x="110" y="87" width="16" height="4" rx="2" fill="#4c3226" />

          {/* glasses */}
          <g stroke="var(--gold)" strokeWidth="2" fill="none" opacity="0.9">
            <circle cx="83" cy="102" r="12.5" />
            <circle cx="117" cy="102" r="12.5" />
            <path d="M 95.5 102 Q 100 99 104.5 102" />
          </g>

          {/* eyes */}
          <g className="t-eyes">
            <g className="t-pupils">
              <ellipse cx="83" cy="102" rx="4.2" ry="5.2" fill="#2b1d14" />
              <ellipse cx="117" cy="102" rx="4.2" ry="5.2" fill="#2b1d14" />
              <circle cx="84.6" cy="100" r="1.3" fill="#fff" />
              <circle cx="118.6" cy="100" r="1.3" fill="#fff" />
            </g>
          </g>

          {/* blush */}
          <ellipse className="t-blush" cx="72" cy="118" rx="6.5" ry="3.5" fill="var(--primary)" />
          <ellipse className="t-blush" cx="128" cy="118" rx="6.5" ry="3.5" fill="var(--primary)" />

          {/* nose */}
          <path d="M 98 108 Q 100 114 102 108" stroke="#d9a67f" strokeWidth="2.2" fill="none" strokeLinecap="round" />

          {/* mouth — viseme shapes, toggled via data-viseme on the root */}
          <g className="t-mouth" transform="translate(100 130)">
            <path className="t-m t-m0" d="M -10 0 Q 0 8 10 0" stroke="#8a4a33" strokeWidth="2.6" fill="none" strokeLinecap="round" />
            <ellipse className="t-m t-m1" cx="0" cy="2" rx="4.5" ry="3.4" fill="#5d2a22" />
            <g className="t-m t-m2">
              <ellipse cx="0" cy="2.5" rx="6.5" ry="5.5" fill="#5d2a22" />
              <ellipse cx="0" cy="5" rx="3.6" ry="2" fill="#c96b5a" />
            </g>
            <g className="t-m t-m3">
              <ellipse cx="0" cy="2.5" rx="8.5" ry="6.5" fill="#5d2a22" />
              <rect x="-5.5" y="-2.4" width="11" height="3" rx="1.5" fill="#fff" />
              <ellipse cx="0" cy="5.5" rx="4.2" ry="2.2" fill="#c96b5a" />
            </g>
            <path className="t-m t-smile" d="M -13 -1 Q 0 13 13 -1 Q 0 5 -13 -1 Z" fill="#6e352a" />
            <path className="t-m t-flat" d="M -8 2 L 8 2" stroke="#8a4a33" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          </g>
        </g>
      </svg>
    </div>
  );
}

/** Drives data-viseme + --jaw on the root from the live audio stream. */
function useMouthDriver(
  audioRef: React.RefObject<HTMLAudioElement | null> | null,
  rootRef: React.RefObject<HTMLDivElement | null>,
  active: boolean,
) {
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!active || !audioRef) {
      root?.setAttribute("data-viseme", "0");
      return;
    }

    let raf = 0;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let data: Uint8Array<ArrayBuffer> | null = null;
    let currentStream: MediaStream | null = null;
    let lastViseme = "0";

    const tick = () => {
      const stream = (audioRef.current?.srcObject ?? null) as MediaStream | null;
      if (stream && stream !== currentStream && stream.getAudioTracks().length > 0) {
        try {
          ctxRef.current ??= new AudioContext();
          void ctxRef.current.resume();
          source?.disconnect();
          source = ctxRef.current.createMediaStreamSource(stream);
          analyser = ctxRef.current.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.5;
          source.connect(analyser);
          data = new Uint8Array(analyser.frequencyBinCount);
          currentStream = stream;
        } catch {
          // analyser unavailable (very old browser) — mouth falls back to CSS
        }
      }

      if (analyser && data && root) {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        const bins = Math.min(data.length, 40);
        for (let i = 2; i < bins; i++) sum += data[i];
        const level = Math.min(1, sum / (bins - 2) / 130);
        const viseme = level < 0.06 ? "0" : level < 0.22 ? "1" : level < 0.45 ? "2" : "3";
        if (viseme !== lastViseme) {
          lastViseme = viseme;
          root.setAttribute("data-viseme", viseme);
        }
        root.style.setProperty("--jaw", (level * 3).toFixed(2) + "px");
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      source?.disconnect();
      root?.setAttribute("data-viseme", "0");
    };
  }, [active, audioRef, rootRef]);

  useEffect(() => {
    return () => {
      void ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, []);
}
