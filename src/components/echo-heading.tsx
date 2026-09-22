import type { CSSProperties, ReactNode } from "react";

type EchoHeadingProps = {
  children: ReactNode;
  className?: string;
};

const TRAIL_LAYERS = 7;

/** A restrained Echo Text treatment: layered copies create a soft rose light trail. */
export function EchoHeading({ children, className = "" }: EchoHeadingProps) {
  return <span className={`echo-heading ${className}`.trim()}>
    {Array.from({ length: TRAIL_LAYERS }, (_, index) => <span
      aria-hidden="true"
      className="echo-heading__echo"
      key={index}
      style={{ "--echo-depth": index + 1 } as CSSProperties}
    >{children}</span>)}
    <span className="echo-heading__front">{children}</span>
  </span>;
}
