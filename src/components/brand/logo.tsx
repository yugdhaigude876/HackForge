import Image from "next/image";
import { cn } from "@/lib/utils";

interface BrandLogoProps {
  /** Rendered edge length of the square tile in px. */
  size?: number;
  className?: string;
  /** Set when the logo is the only label for its link or button. */
  label?: string;
}

/**
 * Reserve Juggler mark on a soft off-white tile. The tile keeps the navy parts of the
 * mark readable in both the dark and the light theme.
 */
export function BrandLogo({ size = 32, className, label }: BrandLogoProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[22%] bg-[#F3F1EC] ring-1 ring-black/10",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Image
        src="/brand/logo-mark-512.png"
        alt={label ?? ""}
        aria-hidden={label ? undefined : true}
        width={512}
        height={493}
        priority
        className="h-[82%] w-[82%] object-contain"
      />
    </span>
  );
}
