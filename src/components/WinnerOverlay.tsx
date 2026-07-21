import { LETTERS } from '@/lib/bingo';

interface Props {
  name: string;
  cardNumber: number;
  prize: number;
  pattern: string | null;
  line: number[];
  card: number[][] | null;
  nextIn: number | null;
}

const PATTERN_LABEL: Record<string, string> = {
  HORIZONTAL: 'Horizontal',
  VERTICAL: 'Vertical',
  DIAGONAL: 'Diagonal',
};

// Shown for a few seconds after a win: the winner, their card number, and their card
// with the winning line highlighted.
export function WinnerOverlay({ name, cardNumber, prize, pattern, line, card, nextIn }: Props) {
  const lineSet = new Set(line);

  return (
    <div className="overlay">
      <div className="winner-card">
        <div className="confetti">🎉</div>
        <h1>BINGO!</h1>
        <p className="winner-name">{name}</p>
        <div className="winner-prize">+{prize} birr</div>
        <div className="winner-cardno">
          Card #{cardNumber}
          {pattern && <> · {PATTERN_LABEL[pattern] ?? pattern}</>}
        </div>

        {card && (
          <div className="win-card">
            <div className="win-head">
              {LETTERS.map((l, i) => (
                <div key={l} className={`hc${i}`}>
                  {l}
                </div>
              ))}
            </div>
            <div className="win-grid">
              {card.flatMap((row, r) =>
                row.map((n, c) => {
                  const isFree = n === 0;
                  const inLine = isFree ? lineIncludesFree(card, lineSet) : lineSet.has(n);
                  const cls = ['wcell', inLine ? 'hit' : '', isFree ? 'free' : '']
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <div key={`${r}-${c}`} className={cls}>
                      {isFree ? '★' : n}
                    </div>
                  );
                }),
              )}
            </div>
          </div>
        )}

        {nextIn != null && <p className="winner-next">Next round in {nextIn}s…</p>}
      </div>
    </div>
  );
}

// The FREE centre belongs to the winning line whenever that line runs through the middle
// (i.e. it has only 4 numbered cells).
function lineIncludesFree(card: number[][], lineSet: Set<number>): boolean {
  if (lineSet.size !== 4) return false;
  const middleRow = card[2].filter((n) => n !== 0);
  const middleCol = card.map((r) => r[2]).filter((n) => n !== 0);
  const diagA = [0, 1, 2, 3, 4].map((i) => card[i][i]).filter((n) => n !== 0);
  const diagB = [0, 1, 2, 3, 4].map((i) => card[i][4 - i]).filter((n) => n !== 0);
  return [middleRow, middleCol, diagA, diagB].some(
    (cells) => cells.length === 4 && cells.every((n) => lineSet.has(n)),
  );
}
