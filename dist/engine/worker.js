const settings = {
  easy:   { time: 120, depth: 5, strength: 25 },
  normal: { time: 460, depth: 14, strength: 80 },
  hard:   { time: 1500, depth: 32, strength: 100 },
};
const lastResortSearch = 5;
const regularSearch = 3;

let output = [];
let engine;
let configured = false;
let candidateRange = regularSearch;

function send(command) {
  output = [];
  engine.sendCommand(command);
  const error = output.find((line) => /^(ERROR|UNKNOWN)/.test(line));
  if (error) throw new Error(error);
  return output;
}

function readMove(lines) {
  for (const line of lines) {
    const match = /^(\d+),(\d+)$/.exec(line.trim());
    if (match) return { x: Number(match[1]), y: Number(match[2]) };
  }
  return null;
}

function configureSearch({ time, depth, strength }, excluded) {
  send(`INFO timeout_turn ${time}`);
  send(`INFO max_depth ${depth}`);
  send(`INFO strength ${strength}`);
  send("YXBLOCKRESET");
  if (excluded.length) send(`YXBLOCK \n${excluded.map(({ x, y }) => `${x},${y}`).join("\n")}\nDONE`);
}

function positionCommand(command, moves) {
  // BOARD takes the move history from the side-to-move's perspective.
  const history = moves.map(({ x, y }, i) => `${x},${y},${i % 2 === moves.length % 2 ? 1 : 2}`);
  return [command, ...history, "DONE"].join("\n");
}

function forbidden(moves) {
  send(positionCommand("YXBOARD", moves));
  const line = send("YXSHOWFORBID").find((line) => /^FORBID \d*\.$/.test(line));
  if (!line) throw new Error("Rapfi did not report forbidden points.");
  const points = line.slice(7, -1).match(/\d{4}/g) ?? [];
  return points.map((point) => ({ x: Number(point.slice(0, 2)), y: Number(point.slice(2)) }));
}

function validateRenju(moves) {
  for (let i = 0; i < moves.length; i += 2) {
    const { x, y } = moves[i];
    if (forbidden(moves.slice(0, i)).some((point) => point.x === x && point.y === y)) return i + 1;
  }
  return null;
}

function search(moves, level, excluded, renju) {
  const restricted = renju && moves.length % 2 === 0 ? forbidden(moves) : [];
  const blocked = [...excluded, ...restricted];
  if (blocked.length >= 15 * 15 - moves.length) throw new Error("NO_LEGAL_MOVE");
  const options = excluded.length ? { ...settings[level], strength: 100 } : settings[level];
  configureSearch(options, blocked);
  const command = positionCommand("BOARD", moves);
  const play = () => {
    const move = readMove(send(command));
    return move && move.x < 15 && move.y < 15
      && !blocked.some(({ x, y }) => x === move.x && y === move.y)
      && !moves.some(({ x, y }) => x === move.x && y === move.y) ? move : null;
  };
  let move = play();
  if (!move && blocked.length) {
    // When all nearby candidates are winning moves, consider the whole board.
    send(`INFO caution_factor ${lastResortSearch}`);
    candidateRange = lastResortSearch;
    move = play();
  }
  if (candidateRange !== regularSearch) {
    send(`INFO caution_factor ${regularSearch}`);
    candidateRange = regularSearch;
  }
  if (!move) throw new Error("Rapfi did not return a playable move.");
  return move;
}

function evaluate(moves) {
  configureSearch({ time: 110, depth: 12, strength: 100 }, []);
  send("INFO show_detail 2");
  let lines;
  try {
    lines = send(positionCommand("BOARD", moves));
  } finally {
    send("INFO show_detail 0");
  }
  const rates = lines.flatMap((line) => {
    const match = /^INFO WINRATE ([\d.]+(?:e[+-]?\d+)?)$/i.exec(line.trim());
    return match ? [Number(match[1])] : [];
  });
  if (rates.length) {
    const rate = rates.at(-1);
    return moves.length % 2 === 0 ? rate : 1 - rate;
  }

  // Some openings are played directly and have no search output.
  send(positionCommand("YXBOARD", moves));
  for (const line of send("TRACESEARCH")) {
    const match = /^MESSAGE Static Eval\[Black\]: -?\d+ \(WDL ([\d.]+)/.exec(line);
    if (match) return Number(match[1]) / 100;
  }
  return null;
}

async function start() {
  importScripts("./rapfi-single-simd128.js");
  engine = await Rapfi({
    onReceiveStdout: (line) => {
      output.push(line);
      if (line.includes("Evaluator set to mix9svq.")) configured = true;
    },
    onReceiveStderr: (line) => console.error(line),
  });
  if (!configured) throw new Error(`Rapfi could not initialize the NNUE evaluator. ${output.join(" ")}`);
  send("INFO rule 0");
  send("INFO show_detail 0");
  send("INFO timeout_match 2147483647");
  send("START 15");
}

const ready = start();
ready.then(() => postMessage({ ready: true }), (error) => postMessage({ startupError: error.message }));

const operations = {
  search: ({ moves, level, excluded, renju }) => search(moves, level, excluded, renju),
  evaluate: ({ moves }) => evaluate(moves),
  forbidden: ({ moves }) => forbidden(moves),
  "validate-renju": ({ moves }) => validateRenju(moves),
};

self.onmessage = async ({ data }) => {
  const { id, type, renju } = data;
  try {
    await ready;
    send(`INFO rule ${renju ? 4 : 0}`);
    postMessage({ id, result: operations[type](data) });
  } catch (error) {
    postMessage({ id, error: error.message });
  }
};
