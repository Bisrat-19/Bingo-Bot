interface Props {
  name: string;
  onClose: () => void;
}

export function WinnerOverlay({ name, onClose }: Props) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="winner-card" onClick={(e) => e.stopPropagation()}>
        <div className="confetti">🎉</div>
        <h1>BINGO!</h1>
        <p className="winner-name">{name}</p>
        <button className="ghost-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
