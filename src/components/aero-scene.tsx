"use client";

import { lazy, Suspense, useEffect, useId, useState } from "react";
import { Pause, Play } from "lucide-react";
import "./aero-scene.css";

const AeroShards = lazy(() => import("./aero-shards"));

function StillShards() {
  const id = useId();
  const fixed = (value: number) => Number(value.toFixed(3));
  return <svg className="echo-shards-still" viewBox="0 0 1200 680" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
    <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff4ff" /><stop offset=".3" stopColor="#d7b9ec" /><stop offset=".56" stopColor="#6670ad" /><stop offset=".77" stopColor="#20234e" /><stop offset="1" stopColor="#c9d2ff" /></linearGradient></defs>
    {Array.from({ length: 76 }, (_, i) => {
      const t = i / 75;
      const x = 190 + t * 980;
      const y = 168 - Math.sin(t * Math.PI * 1.7) * 80 + Math.sin(i * 2.17) * (18 + t * 25);
      const size = 8 + (i * 17 % 31) * (.35 + t * .85);
      return <g key={i} transform={"translate(" + fixed(x) + " " + fixed(y) + ") rotate(" + fixed(-32 + Math.sin(t * 5) * 42 + i * 7 % 25) + ")"} opacity={fixed(.22 + t * .65)}>
        <path d={"M" + (-size * 1.8) + " 0 L" + (size * .6) + " " + (-size * .48) + " L" + (size * 1.4) + " " + (size * .09) + " L" + (-size * .3) + " " + (size * .36) + "Z"} fill={"url(#" + id + ")"} />
        <path d={"M" + (-size * 1.8) + " 0 L" + (size * .6) + " " + (-size * .48) + " L" + (-size * .3) + " " + (size * .08) + "Z"} fill="#f2dcff" opacity=".3" />
      </g>;
    })}
  </svg>;
}

export function AeroScene({ quiet = false }: { quiet?: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(true);
  const [visible, setVisible] = useState(true);
  const [finePointer, setFinePointer] = useState(false);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => { setReduced(preference.matches); setFinePointer(pointer.matches); };
    const visibility = () => setVisible(!document.hidden);
    update(); visibility();
    preference.addEventListener("change", update); pointer.addEventListener("change", update);
    document.addEventListener("visibilitychange", visibility);
    const lowPowerDevice = navigator.hardwareConcurrency <= 4 || (navigator.maxTouchPoints > 0 && window.innerWidth <= 900);
    setEnabled("gpu" in navigator && !lowPowerDevice);
    return () => { preference.removeEventListener("change", update); pointer.removeEventListener("change", update); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  const animate = enabled && !failed && !reduced;
  return <div className="echo-shards-scene" data-quiet={quiet} data-motion={animate ? paused || quiet || !visible ? "paused" : "playing" : "still"}>
    <div className="echo-shards-stage" aria-hidden="true"><StillShards />
      {animate && <Suspense fallback={null}><AeroShards backgroundColor="#120f1b" shardColor="#7888c7" accentColor="#dca9df" placement="full" flow="stream" material="pearl" detail="balanced" scale={1} spread={1} depth={1} speed={.24} spin={.2} density={.78} shardSize={.78} stretch={1} turbulence={.38} glow={.92} edgeSoftness={2} bloom={.65} grain={.012} chromaticAberration={.002} transitionDuration={1} interactionRadius={1.5} interaction={finePointer && !quiet ? "repel" : "none"} interactionStrength={.25} rippleIntensity={.5} holdToGather={true} paused={paused || quiet || !visible} onError={() => setFailed(true)} /></Suspense>}
    </div>
    {animate && <button className="scene-pause" type="button" aria-label={paused ? "播放碎片动效" : "暂停碎片动效"} aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? <Play size={14} /> : <Pause size={14} />}</button>}
  </div>;
}
