/** Bobby's mark: a cherry-blossom (sakura) on a leafy green sprig. */
const PETAL = "M32 24 C25 19 25 9 29 6 Q32 10 35 6 C39 9 39 19 32 24Z";
const PETAL_ANGLES = [0, 72, 144, 216, 288];

export function FlowerLogo({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="flower"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Bobby"
      style={{ display: "inline-block", flex: "none" }}
    >
      {/* stem */}
      <path
        d="M32 26 C32 40 32 47 32 59"
        stroke="#54b56b"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      {/* leaves */}
      <path d="M32 45 C41 41 49 45 51 51 C43 53 35 51 32 45Z" fill="#6bd98e" />
      <path d="M32 50 C23 47 16 50 14 56 C22 58 30 56 32 50Z" fill="#4caf6a" />
      {/* blossom */}
      {PETAL_ANGLES.map((a) => (
        <path key={a} d={PETAL} fill="#f08fc8" transform={`rotate(${a} 32 24)`} />
      ))}
      <circle cx="32" cy="24" r="4" fill="#ffd45e" />
    </svg>
  );
}
