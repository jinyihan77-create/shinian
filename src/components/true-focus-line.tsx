"use client";

import { useEffect, useState, type PointerEvent } from "react";

type TrueFocusLineProps = {
  children: string;
};

/** A quiet, pointer-aware focus line for the capture hero. */
export function TrueFocusLine({ children }: TrueFocusLineProps) {
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const characters = Array.from(children);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  function updateFocus(event: PointerEvent<HTMLSpanElement>) {
    if (reducedMotion) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    const progress = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    setFocusIndex(Math.min(characters.length - 1, Math.round(progress * (characters.length - 1))));
  }

  return <span
    className="true-focus-line"
    data-active={focusIndex === null ? "false" : "true"}
    aria-label={children}
    onPointerMove={event => { if (event.pointerType !== "touch") updateFocus(event); }}
    onPointerDown={updateFocus}
    onPointerLeave={() => setFocusIndex(null)}
  >
    {characters.map((character, index) => {
      const distance = focusIndex === null ? 99 : Math.abs(index - focusIndex);
      const className = distance === 0 ? "is-focus" : distance === 1 ? "is-near" : distance === 2 ? "is-soft" : "";
      return <span key={`${character}-${index}`} className={`true-focus-line__character ${className}`} aria-hidden="true">{character === " " ? "\u00a0" : character}</span>;
    })}
  </span>;
}
