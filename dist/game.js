export const SIZE = 15;
export const BLACK = "black";
export const WHITE = "white";
export const DIFFICULTIES = ["easy", "normal", "hard"];
export const DEFAULT_SETTINGS = { mode: "ai", side: BLACK, difficulty: "normal", renju: false };

export const sideAt = (ply) => ply % 2 === 0 ? BLACK : WHITE;
export const opposite = (side) => side === BLACK ? WHITE : BLACK;
export const cellIndex = (x, y) => y * SIZE + x;
export const coordinate = (x, y) => String.fromCharCode(65 + x) + (SIZE - y);
export const onBoard = (x, y) =>
  Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < SIZE && y < SIZE;

const axes = [[1, 0], [0, 1], [1, 1], [1, -1]];

export function winningCells(cells, x, y, side, renju) {
  const wins = new Set();
  for (const [dx, dy] of axes) {
    const line = [cellIndex(x, y)];
    for (const direction of [-1, 1]) {
      let nx = x + dx * direction;
      let ny = y + dy * direction;
      while (onBoard(nx, ny) && cells[cellIndex(nx, ny)]?.side === side) {
        line.push(cellIndex(nx, ny));
        nx += dx * direction;
        ny += dy * direction;
      }
    }
    if (renju && side === BLACK ? line.length === 5 : line.length >= 5) {
      for (const index of line) wins.add(index);
    }
  }
  return wins;
}

export function positionOf(moves, renju, plies = moves.length) {
  const cells = Array(SIZE * SIZE).fill(null);
  for (let i = 0; i < plies; i++) {
    const { x, y } = moves[i];
    cells[cellIndex(x, y)] = { side: sideAt(i), number: i + 1 };
  }
  const last = moves[plies - 1];
  const wins = last ? winningCells(cells, last.x, last.y, sideAt(plies - 1), renju) : new Set();
  return {
    cells,
    wins,
    winner: wins.size ? sideAt(plies - 1) : null,
    draw: !wins.size && plies === cells.length,
    turn: sideAt(plies),
  };
}

export function winningMoves(cells, side, renju) {
  const moves = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!cells[cellIndex(x, y)] && winningCells(cells, x, y, side, renju).size) {
        moves.push({ x, y });
      }
    }
  }
  return moves;
}

export function undoTo(moves, settings) {
  if (settings.mode === "local") return Math.max(0, moves.length - 1);
  for (let i = moves.length - 1; i >= 0; i--) {
    if (sideAt(i) === settings.side) return i;
  }
  return moves.length;
}

export function parseRecord(record) {
  if (!record || record.version !== 1 || !record.settings || !Array.isArray(record.moves)
    || record.moves.length > SIZE * SIZE) throw new Error("无法读取这份棋谱。");
  const { mode, side, difficulty, renju = false } = record.settings;
  if (!["ai", "local"].includes(mode) || ![BLACK, WHITE].includes(side)
    || !DIFFICULTIES.includes(difficulty) || typeof renju !== "boolean") throw new Error("棋谱的对局设置无效。");

  const cells = Array(SIZE * SIZE).fill(null);
  let finished = false;
  const moves = record.moves.map((move, i) => {
    if (!move || !onBoard(move.x, move.y)) throw new Error(`棋谱第 ${i + 1} 手超出棋盘。`);
    const { x, y } = move;
    const index = cellIndex(x, y);
    if (finished || cells[index]) throw new Error(`棋谱第 ${i + 1} 手无效。`);
    cells[index] = { side: sideAt(i) };
    finished = winningCells(cells, x, y, sideAt(i), renju).size > 0;
    return move.assisted === true && mode === "ai" && sideAt(i) !== side ? { x, y, assisted: true } : { x, y };
  });
  return { settings: { mode, side, difficulty, renju }, moves };
}
