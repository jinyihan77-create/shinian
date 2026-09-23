"use client";

import { lazy, Suspense, useEffect, useId, useState } from "react";
import { Pause, Play } from "lucide-react";
import "./aero-scene.css";

const AeroShards = lazy(() => import("./aero-shards"));

function StillShards() {
  const id = useId();
  const fixed = (value: number) => Number(value.toFixed(3));
  return <svg className="echo-shards-still" viewBox="0 0 1200 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff4ff" /><stop offset=".3" stopColor="#d7b9ec" /><stop offset=".56" stopColor="#6670ad" /><stop offset=".77" stopColor="#20234e" /><stop offset="1" stopColor="#c9d2ff" /></linearGradient></defs>
    {Array.from({ length: 112 }, (_, i) => {
      const lane = i % 4;
      const t = Math.floor(i / 4) / 27;
      const x = -90 + t * 1380 + Math.sin(i * 1.73) * 46;
      const y = 72 + lane * 218 + Math.sin(t * Math.PI * 2.4 + lane * 1.1) * (58 + lane * 13) + t * (lane % 2 ? 52 : -18);
      const size = 7 + (i * 17 % 29) * (.42 + t * .58);
      return <g key={i} transform={"translate(" + fixed(x) + " " + fixed(y) + ") rotate(" + fixed(-34 + Math.sin(t * 6 + lane) * 38 + i * 7 % 23) + ")"} opacity={fixed(.2 + ((i * 13) % 47) / 82)}>
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
    // AeroShards already chooses a low quality preset and adapts at runtime on
    // smaller devices. Let every WebGPU-capable device render the real scene.
    setEnabled("gpu" in navigator);
    return () => { preference.removeEventListener("change", update); pointer.removeEventListener("change", update); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  const animate = enabled && !failed && !reduced;
  return <div className="echo-shards-scene" data-quiet={quiet} data-motion={animate ? paused || quiet || !visible ? "paused" : "playing" : "still"}>
    <div className="echo-shards-stage" aria-hidden="true"><StillShards />
      {animate && <Suspense fallback={null}><AeroShards backgroundColor="#100d16" shardColor="#8e9fe6" accentColor="#f0a0ca" placement="full" flow="stream" material="pearl" detail="balanced" scale={1} spread={1} depth={1} speed={.24} spin={.2} density={.84} shardSize={.82} stretch={1.06} turbulence={.38} glow={1.06} edgeSoftness={1.7} bloom={.82} grain={.01} chromaticAberration={.0045} transitionDuration={1} interactionRadius={1.5} interaction={finePointer && !quiet ? "repel" : "none"} interactionStrength={.25} rippleIntensity={.5} holdToGather={true} paused={paused || quiet || !visible} onError={() => setFailed(true)} /></Suspense>}
    </div>
    {animate && <button className="scene-pause" type="button" aria-label={paused ? "播放碎片动效" : "暂停碎片动效"} aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? <Play size={14} /> : <Pause size={14} />}</button>}
  </div>;
}
