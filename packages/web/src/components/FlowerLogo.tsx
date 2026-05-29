/** Bobby's mark: the 🌸 cherry-blossom emoji, sized to fit wherever it's used. */
export function FlowerLogo({ size = 28 }: { size?: number }) {
  return (
    <span
      className="flower"
      style={{ fontSize: size, lineHeight: 1, display: "inline-block" }}
      role="img"
      aria-label="Bobby"
    >
      🌸
    </span>
  );
}
