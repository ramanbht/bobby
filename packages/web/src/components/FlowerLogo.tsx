import { useId } from "react";

/**
 * Bobby's mark: a small four-petal flower with shaded purple petals, a yellow
 * center, and a green stem with two leaves. Gradient ids are namespaced per
 * instance so multiple logos on a page don't clash.
 */
export function FlowerLogo({ size = 28 }: { size?: number }) {
  const uid = useId().replace(/:/g, "");
  const petal = `petal-${uid}`;
  const center = `center-${uid}`;
  const leaf = `leaf-${uid}`;
  const petals = [45, 135, 225, 315];

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className="flower">
      <defs>
        {/* Shaded petals: dark near the center, light toward the tips. */}
        <radialGradient id={petal} cx="50" cy="35" r="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#581c9c" />
          <stop offset="55%" stopColor="#8b2fe6" />
          <stop offset="100%" stopColor="#b15cff" />
        </radialGradient>
        <radialGradient id={center} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#fff0a6" />
          <stop offset="100%" stopColor="#f2c200" />
        </radialGradient>
        <linearGradient id={leaf} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5bbf5f" />
          <stop offset="100%" stopColor="#2f7d39" />
        </linearGradient>
      </defs>

      {/* stem */}
      <path d="M50 40 C 47 60, 53 74, 50 94" stroke="#2f7d39" strokeWidth="3.4" fill="none" strokeLinecap="round" />
      {/* two leaves */}
      <ellipse cx="37" cy="63" rx="10.5" ry="5" fill={`url(#${leaf})`} transform="rotate(-38 37 63)" />
      <ellipse cx="63" cy="73" rx="10.5" ry="5" fill={`url(#${leaf})`} transform="rotate(38 63 73)" />
      {/* four shaded petals */}
      {petals.map((a) => (
        <ellipse
          key={a}
          cx="50"
          cy="21"
          rx="8"
          ry="13.5"
          fill={`url(#${petal})`}
          stroke="#6d28d9"
          strokeOpacity="0.25"
          strokeWidth="0.5"
          transform={`rotate(${a} 50 35)`}
        />
      ))}
      {/* yellow center */}
      <circle cx="50" cy="35" r="6.5" fill={`url(#${center})`} stroke="#e0a800" strokeWidth="0.5" />
    </svg>
  );
}
