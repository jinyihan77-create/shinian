"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import styles from "./star-curtain.module.css";
import { SEVEN_STAR_POINTS, starMaterial } from "@/lib/star-materials";

export type StarCurtainProps = {
  theme: number;
  onPick: (index: number) => void;
  paused?: boolean;
  reduceMotion?: boolean;
};

const STARS = [
  { left: 22, top: 73, size: 118, depth: 0.86 },
  { left: 50, top: 39, size: 154, depth: 1 },
  { left: 78, top: 82, size: 124, depth: 0.9 },
];
const PICK_DISTANCE = 72;
const PICK_DURATION = 780;

function noise(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

// The hanging and picked faces share one broad, five-point silhouette.
const STAR_PATH = `${SEVEN_STAR_POINTS.map((point, index) => `${index ? "L" : "M"}${120 + point.x * 113} ${120 + point.y * 113}`).join(" ")}Z`;

function StarFace({ id, seed, material, prominent }: { id: string; seed: number; material: ReturnType<typeof starMaterial>; prominent: boolean }) {
  const { kind, accent: tint, base, ink, halo } = material;
  const glow = `rgb(${material.glow})`;
  const secondary = `rgb(${material.secondary})`;
  const points = useMemo(() => {
    const random = noise(seed);
    return Array.from({ length: 145 }, (_, index) => ({
      x: 18 + random() * 205,
      y: 18 + random() * 205,
      radius: index % 23 === 0 ? 0.72 : 0.17 + random() * 0.36,
      opacity: 0.2 + random() * 0.58,
    }));
  }, [seed]);
  return <svg viewBox="0 0 240 240" className={styles.starFace} data-material={kind} aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-body`} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor={tint} stopOpacity=".98" />
        <stop offset=".3" stopColor={base} stopOpacity={material.opacity} />
        <stop offset=".64" stopColor={secondary} stopOpacity={kind === "ice" || kind === "aurora" ? ".66" : ".83"} />
        <stop offset="1" stopColor={glow} stopOpacity=".95" />
      </linearGradient>
      <linearGradient id={`${id}-edge`} x1="0" y1="0" x2=".85" y2="1">
        <stop stopColor="#fffafb" stopOpacity=".95" />
        <stop offset=".23" stopColor={tint} stopOpacity=".48" />
        <stop offset=".5" stopColor={secondary} stopOpacity=".92" />
        <stop offset=".72" stopColor={glow} stopOpacity=".32" />
        <stop offset="1" stopColor="#fff8f2" stopOpacity=".9" />
      </linearGradient>
      <radialGradient id={`${id}-cloud`} cx=".31" cy=".3" r=".75">
        <stop stopColor="#ffffff" stopOpacity={kind === "frost" ? ".45" : ".32"} />
        <stop offset=".46" stopColor={tint} stopOpacity=".075" />
        <stop offset="1" stopColor={tint} stopOpacity="0" />
      </radialGradient>
      <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2=".5">
        <stop stopColor="#fffafd" stopOpacity="0" />
        <stop offset=".4" stopColor="#fffafd" stopOpacity=".36" />
        <stop offset=".5" stopColor="#fffafd" stopOpacity=".035" />
        <stop offset="1" stopColor="#fffafd" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={`${id}-ribbon`} x1="0" y1="1" x2="1" y2="0"><stop stopColor={glow} stopOpacity=".12" /><stop offset=".48" stopColor={tint} stopOpacity=".7" /><stop offset=".75" stopColor={secondary} stopOpacity=".5" /><stop offset="1" stopColor="#fffaff" stopOpacity=".13" /></linearGradient>
      <linearGradient id={`${id}-orbit`} x1="0" y1="0" x2="1" y2="1"><stop stopColor={secondary} stopOpacity=".06" /><stop offset=".28" stopColor={tint} stopOpacity=".75" /><stop offset=".66" stopColor="#fff9ed" stopOpacity=".9" /><stop offset="1" stopColor={glow} stopOpacity=".25" /></linearGradient>
      <clipPath id={`${id}-clip`}><path d={STAR_PATH} /></clipPath>
    </defs>
    {halo && <g transform="rotate(-19 120 128)" fill="none"><ellipse cx="120" cy="128" rx="132" ry="35" stroke={glow} strokeOpacity=".18" strokeWidth="7" /><ellipse cx="120" cy="128" rx="132" ry="35" stroke={`url(#${id}-orbit)`} strokeWidth="1.1" /><ellipse cx="120" cy="128" rx="140" ry="39" stroke={tint} strokeOpacity=".25" strokeWidth=".55" /></g>}
    <path d={STAR_PATH} fill={base} fillOpacity=".38" transform="translate(1.3 3)" stroke={ink} strokeWidth="2.3" strokeOpacity=".62" strokeLinejoin="round" />
    <path d={STAR_PATH} fill={`url(#${id}-body)`} stroke={`url(#${id}-edge)`} strokeWidth="1.8" strokeLinejoin="round" />
    <g clipPath={`url(#${id}-clip)`}>
      <rect width="240" height="240" fill={`url(#${id}-cloud)`} />
      {(kind === "crystal" || kind === "ice") && <>
        <path d="M120 7L113 119L13 85Z M228 85L113 119L186 211Z M53 211L113 119L120 177Z" fill="#fffaff" fillOpacity={kind === "ice" ? ".24" : ".16"} />
        <path d="M120 7L113 119L53 211 M13 85L113 119L228 85" fill="none" stroke={tint} strokeOpacity=".38" strokeWidth=".8" />
        <path d="M136 30L135 121L198 199L175 127Z" fill={ink} fillOpacity=".055" />
      </>}
      {(kind === "pearl" || kind === "aurora") && <g fill="none" stroke={`url(#${id}-ribbon)`}>
        <path d="M-15 172C59 202 116 18 258 76" strokeWidth={kind === "pearl" ? "21" : "35"} opacity=".6" />
        <path d="M-10 199C58 220 139 52 255 110" strokeWidth="12" opacity=".38" />
        <path d="M-15 171C59 201 116 17 258 75" strokeWidth=".7" opacity=".6" />
      </g>}
      {kind === "frost" && <>
        <ellipse cx="96" cy="74" rx="64" ry="76" fill="#eff8ff" fillOpacity=".1" />
        <path d="M17 118C65 76 113 63 229 115" fill="none" stroke="#ffffff" strokeOpacity=".12" strokeWidth="38" />
      </>}
      {kind === "sand" && <g fill={tint} opacity=".34">{points.slice(0, 65).map((point, index) => <path key={index} d={`M${point.x} ${point.y - .8}l.65 .8-.65 .8-.65-.8Z`} />)}</g>}
      <path d={STAR_PATH} fill="none" stroke={tint} strokeOpacity=".45" strokeWidth=".85" transform="translate(7.2 7.2) scale(.94)" />
      {points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={point.radius} fill={index % 5 === 0 ? ink : "#fffafa"} opacity={index % 5 === 0 ? point.opacity * .2 : point.opacity} className={index % 23 === 0 ? styles.glint : undefined} style={{ animationDelay: `${index * -.37}s` }} />)}
      <g stroke={ink} strokeWidth=".55" fill="none" opacity=".28">
        <path d="M87 130L106 105L141 118L151 153" />
        <circle cx="106" cy="105" r="1.7" fill={ink} />
        <circle cx="87" cy="130" r="1" fill={ink} />
        <circle cx="141" cy="118" r="1.5" fill={ink} />
        <circle cx="151" cy="153" r="1" fill={ink} />
      </g>
      <rect className={styles.sheen} x="-100" y="-80" width="370" height="390" fill={`url(#${id}-sheen)`} transform="rotate(-28 120 120)" />
      {prominent && <text x="120" y="165" textAnchor="middle" fill={ink} opacity=".65" fontSize="5.5" letterSpacing="3">SHINIAN</text>}
    </g>
    {halo && <g transform="rotate(-19 120 128)" fill="none"><path d="M-12 128C-12 175 252 175 252 128" stroke={glow} strokeWidth="5" strokeOpacity=".15" /><path d="M-12 128C-12 175 252 175 252 128" stroke={`url(#${id}-orbit)`} strokeWidth="1.7" /></g>}
    {[0, 4, 10].map((tip, index) => <g key={tip} className={styles.edgeGlint} style={{ animationDelay: `${index * -1.7}s` }} transform={`translate(${120 + SEVEN_STAR_POINTS[tip].x * 112} ${120 + SEVEN_STAR_POINTS[tip].y * 112})`} fill="#fffdf8">
      <path d="M0-5.2L.65-.65 5.2 0 .65.65 0 5.2-.65.65-5.2 0-.65-.65Z" opacity=".78" />
      <circle r="1.25" opacity=".62" />
    </g>)}
    <ellipse cx="120" cy="23" rx="2.4" ry="3.3" fill={ink} fillOpacity=".35" stroke={tint} strokeOpacity=".85" strokeWidth="1" />
  </svg>;
}

type Pendulum = { x: number; y: number; vx: number; vy: number; targetX: number; targetY: number; angle: number; yaw: number; scale: number; opacity: number };
type Gesture = { index: number; pointerId: number; startX: number; startY: number; moved: boolean };

export function StarCurtain({ theme, onPick, paused = false, reduceMotion = false }: StarCurtainProps) {
  const uniqueId = useId().replace(/:/g, "");
  const stage = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const cords = useRef<(SVGPathElement | null)[]>([]);
  const bodies = useRef<Pendulum[]>(STARS.map(() => ({ x: 0, y: 0, vx: 0, vy: 0, targetX: 0, targetY: 0, angle: 0, yaw: 0, scale: 1, opacity: 1 })));
  const gesture = useRef<Gesture | null>(null);
  const picked = useRef<number | null>(null);
  const pickTime = useRef(0);
  const pickStart = useRef({ x: 0, y: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPickRef = useRef(onPick);
  const suppressClickUntil = useRef(0);
  const wake = useRef(() => {});
  const [selection, setSelection] = useState<number | null>(null);
  const [pulling, setPulling] = useState(false);
  const [readyToPick, setReadyToPick] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => { onPickRef.current = onPick; }, [onPick]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  function pick(index: number) {
    if (picked.current !== null || paused) return;
    picked.current = index;
    pickTime.current = performance.now();
    pickStart.current = { x: bodies.current[index].x, y: bodies.current[index].y };
    setSelection(index);
    setPulling(false);
    setReadyToPick(false);
    if (reduceMotion) onPickRef.current(index);
    else timer.current = setTimeout(() => onPickRef.current(index), PICK_DURATION);
  }

  function release(event: PointerEvent<HTMLButtonElement>, canceled = false) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const deltaY = event.clientY - active.startY;
    const distance = Math.hypot(event.clientX - active.startX, deltaY);
    gesture.current = null;
    setPulling(false);
    setReadyToPick(false);
    suppressClickUntil.current = performance.now() + 450;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!canceled && (deltaY >= PICK_DISTANCE || (!active.moved && distance < 8))) pick(active.index);
    wake.current();
  }

  useEffect(() => {
    let frame = 0;
    let last = 0;
    const cancelGesture = () => {
      if (gesture.current) suppressClickUntil.current = performance.now() + 450;
      gesture.current = null;
      setPulling(false);
      setReadyToPick(false);
      wake.current();
    };
    const animate = (now: number) => {
      frame = 0;
      const dt = Math.min((now - (last || now - 16)) / 1000, 0.035);
      last = now;
      const width = stage.current?.clientWidth ?? 800;
      const height = stage.current?.clientHeight ?? 310;
      bodies.current.forEach((body, index) => {
        const button = buttons.current[index];
        const cord = cords.current[index];
        if (!button || !cord || button.offsetWidth === 0) return;
        const active = gesture.current?.index === index;
        const isPicked = picked.current === index;
        let scale = 1;
        let opacity = 1;
        let yaw = reduceMotion ? 0 : Math.sin(now / 4100 + index * 1.7) * 7;
        if (isPicked) {
          const progress = Math.min(1, (now - pickTime.current) / PICK_DURATION);
          const ease = 1 - (1 - progress) ** 3;
          body.x = pickStart.current.x + (width / 2 - button.offsetLeft - pickStart.current.x) * ease;
          body.y = pickStart.current.y + (height * 0.4 - button.offsetTop - pickStart.current.y) * ease;
          scale = 1 + ease * 0.34;
          yaw = Math.sin(progress * Math.PI) * 32;
          opacity = 1 - Math.max(0, (progress - 0.72) / 0.28);
          cord.style.opacity = String(Math.max(0, 1 - progress * 4));
        } else {
          if (!active) {
            body.targetX = reduceMotion ? 0 : Math.sin(now / (1700 + index * 180) + index * 1.3 + theme) * (3 + STARS[index].depth * 2.5);
            body.targetY = reduceMotion ? 0 : Math.cos(now / 2100 + index) * 1.1;
          }
          if (reduceMotion) {
            body.x = body.targetX; body.y = body.targetY; body.vx = 0; body.vy = 0;
          } else {
            body.vx = (body.vx + (body.targetX - body.x) * 100 * dt) * Math.exp(-11 * dt);
            body.vy = (body.vy + (body.targetY - body.y) * 100 * dt) * Math.exp(-11 * dt);
            body.x += body.vx * dt;
            body.y += body.vy * dt;
          }
          if (active) yaw = Math.max(-19, Math.min(19, body.x * 0.23));
        }
        const angle = isPicked ? 0 : Math.max(-17, Math.min(17, body.x * 0.28 - body.vx * 0.012));
        body.angle = angle;
        body.yaw = yaw;
        body.scale = scale;
        body.opacity = opacity;
        button.style.transform = `translate3d(calc(-50% + ${body.x.toFixed(2)}px), ${body.y.toFixed(2)}px, 0) rotateZ(${angle.toFixed(2)}deg) rotateY(${yaw.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
        button.style.setProperty("--pick-opacity", String(opacity));
        const anchorX = button.offsetLeft;
        const attachment = button.offsetWidth * 23 / 240;
        const endY = button.offsetTop + attachment + body.y;
        const endX = anchorX + body.x;
        cord.setAttribute("d", `M ${anchorX} -8 C ${anchorX} ${endY * 0.35}, ${endX - body.vx * 0.13} ${endY * 0.74}, ${endX} ${endY}`);
      });
      if (!paused && !reduceMotion && !document.hidden) frame = requestAnimationFrame(animate);
    };
    const requestDraw = () => { if (!frame && !document.hidden) frame = requestAnimationFrame(animate); };
    wake.current = requestDraw;
    const visibility = () => {
      cancelAnimationFrame(frame); frame = 0;
      cancelGesture();
      last = 0;
      requestDraw();
    };
    if (paused) cancelGesture();
    requestDraw();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(requestDraw);
    if (stage.current) observer?.observe(stage.current);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", cancelGesture);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect(); wake.current = () => {};
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", cancelGesture);
    };
  }, [paused, reduceMotion, theme]);

  return <section className={styles.curtain} aria-label="摘星打卡" data-selecting={selection !== null} data-paused={paused || reduceMotion}>
    <div className={styles.atmosphere} aria-hidden="true" />
    <header className={styles.heading}>
      <span>A LITTLE LIGHT FOR TODAY</span>
      <h2>给今天，<em>摘一颗星。</em></h2>
      <p>总有一颗微光，刚好属于此刻的你。</p>
    </header>
    <div ref={stage} className={styles.stage}>
      <div className={styles.horizon} aria-hidden="true" />
      <svg className={styles.cords} aria-hidden="true">
        <defs><linearGradient id={`${uniqueId}-cord`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="220"><stop stopColor="#c8b4dc" stopOpacity="0" /><stop offset=".35" stopColor="#bca8cd" stopOpacity=".24" /><stop offset="1" stopColor="#e7d5ee" stopOpacity=".55" /></linearGradient></defs>
        {STARS.map((star, index) => <path key={index} ref={(node) => { cords.current[index] = node; }} className={index === 0 || index === 6 ? styles.outerStar : undefined} d={`M 0 0 L 0 0`} fill="none" stroke={`url(#${uniqueId}-cord)`} strokeWidth={star.depth > 0.8 ? 1.15 : 0.7} />)}
      </svg>
      {STARS.map((star, index) => <button
        key={index}
        ref={(node) => { buttons.current[index] = node; }}
        type="button"
        aria-label={`摘下第 ${index + 1} 颗星：${starMaterial(theme + index).name}`}
        aria-describedby={`${uniqueId}-hint`}
        className={`${styles.star} ${index === 0 || index === 6 ? styles.outerStar : ""}`}
        data-index={index}
        data-picked={selection === index}
        disabled={selection !== null || paused}
        style={{ "--star-left": `${star.left}%`, "--star-top": `${star.top}px`, "--star-size": `${star.size}px`, "--star-depth": .72 + star.depth * .28, "--star-color": starMaterial(theme + index).accent } as CSSProperties}
        onPointerDown={(event) => {
          if (event.button !== 0 || gesture.current || picked.current !== null || paused) return;
          gesture.current = { index, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
          bodies.current[index].targetX = bodies.current[index].x;
          bodies.current[index].targetY = bodies.current[index].y;
          event.currentTarget.setPointerCapture(event.pointerId);
          setPulling(true);
          wake.current();
        }}
        onPointerMove={(event) => {
          const active = gesture.current;
          if (!active || active.pointerId !== event.pointerId) return;
          const x = event.clientX - active.startX;
          const y = event.clientY - active.startY;
          if (Math.hypot(x, y) > 7) active.moved = true;
          bodies.current[index].targetX = Math.max(-125, Math.min(125, x));
          bodies.current[index].targetY = Math.max(-18, Math.min(160, y));
          setReadyToPick(y >= PICK_DISTANCE);
          wake.current();
        }}
        onPointerUp={(event) => release(event)}
        onPointerCancel={(event) => release(event, true)}
        onLostPointerCapture={(event) => release(event, true)}
        onMouseEnter={() => setHovered(index)}
        onMouseLeave={() => setHovered(current => current === index ? null : current)}
        onFocus={() => setHovered(index)}
        onBlur={() => setHovered(current => current === index ? null : current)}
        onClick={() => { if (performance.now() >= suppressClickUntil.current) pick(index); }}
      >
        <span className={styles.starHalo} />
        <StarFace id={`${uniqueId}-star-${index}`} seed={theme * 31 + index * 718 + 1} material={starMaterial(theme + index)} prominent={index === 1} />
      </button>)}
    </div>
    <div className={styles.footer}>
      <span className={styles.guideMark} aria-hidden="true">↓</span>
      <p id={`${uniqueId}-hint`} aria-live="polite">{selection !== null ? "这一颗光，就留给今天。" : readyToPick ? "松开手，这颗星就属于你了。" : pulling ? "再向下一点，接住这束微光。" : "往下轻轻一拉，把喜欢的光带走。"}</p>
      <span className={styles.secondaryHint}>{selection !== null ? "愿每一个念头，都被温柔收藏" : "也可以轻点一颗星"}</span>
    </div>
  </section>;
}

export default StarCurtain;
