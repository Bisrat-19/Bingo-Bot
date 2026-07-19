export const LETTERS = ['B', 'I', 'N', 'G', 'O'] as const;

export const letterFor = (n: number): string => LETTERS[Math.floor((n - 1) / 15)];
export const callLabel = (n: number): string => `${letterFor(n)}-${n}`;

// Column index (0..4) for a number, used to pick its color.
export const columnOf = (n: number): number => Math.floor((n - 1) / 15);
