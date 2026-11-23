import {
  SIZE, BLACK, WHITE, DEFAULT_SETTINGS, sideAt, opposite, cellIndex, coordinate,
  onBoard, positionOf, winningMoves, undoTo, parseRecord,
} from "./game.js";
import { RapfiEngine } from "./engine.js";

const ui = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
const $ = (id) => ui[id];
const engine = new RapfiEngine();
const STORAGE_KEY = "rapfi-gomoku-v1";
const colorName = { [BLACK]: "黑棋", [WHITE]: "白棋" };
const stars = new Set([cellIndex(3, 3), cellIndex(11, 3), cellIndex(7, 7), cellIndex(3, 11), cellIndex(11, 11)]);
const modeOptions = [...document.querySelectorAll("[data-mode]")];
const sideOptions = [...document.querySelectorAll("[data-side]")];

let game = { settings: { ...DEFAULT_SETTINGS }, moves: [] };
let showNumbers = false;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const data = JSON.parse(saved);
    game = parseRecord(data);
    showNumbers = data.showNumbers === true;
  }
} catch {
  // A saved game may have been cleared or edited outside the app.
}

let cursor = null;
let focusIndex = cellIndex(7, 7);
let pending = null;
let hint = null;
let note = "";
let engineState = "loading";
let failedMove = false;
let replaceAction = null;
let listedMoves = null;
let historyButtons = [];
let evaluation = null;
let evaluationTimer;
let legalityCheck = null;

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...game, showNumbers }));
    $("save-state").textContent = "棋局自动保存于此浏览器";
  } catch {
    $("save-state").textContent = "浏览器无法自动保存，可导出棋谱。";
  }
}

const aiSide = () => opposite(game.settings.side);
const isAiGame = () => game.settings.mode === "ai";
const isFinished = (position) => position.winner || position.draw;
const sideLabel = (side) => isAiGame() ? (side === game.settings.side ? "你" : "Rapfi") : colorName[side];

function playedPosition() {
  const position = positionOf(game.moves, game.settings.renju);
  if (!game.settings.renju || position.turn !== BLACK || isFinished(position)) return position;
  const check = legalityCheck?.moves === game.moves ? legalityCheck : null;
  if (check?.error) return { ...position, forbidError: true };
  if (!check?.points) return { ...position, checking: true };
  if (check.points.size === SIZE * SIZE - game.moves.length) {
    return { ...position, winner: WHITE, noLegalMove: true, forbidden: check.points };
  }
  return { ...position, forbidden: check.points };
}

async function checkLegality(position) {
  if (!position.checking || legalityCheck?.moves === game.moves) return;
  const check = { moves: game.moves };
  legalityCheck = check;
  try {
    const points = await engine.forbidden(check.moves);
    if (legalityCheck !== check) return;
    check.points = new Set(points.map(({ x, y }) => cellIndex(x, y)));
    engineState = "ready";
  } catch (error) {
    if (legalityCheck !== check) return;
    check.error = true;
    engineState = engine.worker ? "ready" : "error";
    console.error(error);
  }
  render();
  maybeAiMove();
}

function isAiTurn(position) {
  return isAiGame() && !isFinished(position) && position.turn === aiSide();
}

function takeWinPoints(position) {
  if (isFinished(position) || position.checking || position.forbidError) return [];
  return winningMoves(position.cells, position.turn, game.settings.renju);
}

function canDecline(moves, winPoints, forbidden) {
  return SIZE * SIZE - moves.length > winPoints.length + (forbidden?.size ?? 0);
}

function canPlay(position) {
  return cursor === null && !isFinished(position) && !["move", "spare"].includes(pending?.type)
    && !position.checking && !position.forbidError
    && (!isAiGame() || position.turn === game.settings.side);
}

function createBoard() {
  const intersections = document.createDocumentFragment();
  const cells = [];
  for (let number = 0; number < SIZE; number++) {
    const column = document.createElement("span");
    column.textContent = String.fromCharCode(65 + number);
    $("columns").append(column);
    const row = document.createElement("span");
    row.textContent = SIZE - number;
    $("rows").append(row);
  }

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const index = cellIndex(x, y);
      const button = document.createElement("button");
      const stone = document.createElement("span");
      button.type = "button";
      button.className = "intersection";
      if (stars.has(index)) button.classList.add("star");
      button.addEventListener("click", () => playHuman(x, y));
      button.addEventListener("focus", () => {
        if (index === focusIndex) return;
        cells[focusIndex].button.tabIndex = -1;
        focusIndex = index;
        button.tabIndex = 0;
      });
      button.addEventListener("keydown", (event) => {
        const directions = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
        const movement = directions[event.key];
        if (!movement) return;
        event.preventDefault();
        const [dx, dy] = movement;
        if (onBoard(x + dx, y + dy)) cells[cellIndex(x + dx, y + dy)].button.focus();
      });
      stone.setAttribute("aria-hidden", "true");
      button.append(stone);
      cells.push({ button, stone, label: coordinate(x, y) });
      intersections.append(button);
    }
  }
  $("intersections").append(intersections);
  return cells;
}
const boardCells = createBoard();

function drawBoard(position, ply, winPoints) {
  const playable = canPlay(position);
  const markedWins = new Set(winPoints.map(({ x, y }) => cellIndex(x, y)));
  if (playable) $("intersections").dataset.turn = position.turn;
  else delete $("intersections").dataset.turn;
  $("intersections").classList.toggle("show-numbers", showNumbers);

  boardCells.forEach(({ button, stone, label }, index) => {
    const mark = position.cells[index];
    const isHint = cursor === null && hint === index;
    const forbidden = Boolean(position.forbidden?.has(index));
    button.tabIndex = index === focusIndex ? 0 : -1;
    button.dataset.empty = String(!mark);
    button.setAttribute("aria-disabled", String(!playable || Boolean(mark) || forbidden));
    const description = mark ? `${label}，${colorName[mark.side]}，第 ${mark.number} 手` : label;
    const suffix = forbidden ? "，黑棋禁手" : markedWins.has(index) ? "，AI 成五点" : isHint ? "，推荐落点" : "";
    button.setAttribute("aria-label", description + suffix);
    button.classList.toggle("last", mark?.number === ply);
    button.classList.toggle("winning", position.wins.has(index));
    button.classList.toggle("hint", isHint);
    button.classList.toggle("win-point", markedWins.has(index));
    button.classList.toggle("forbidden", forbidden);
    stone.hidden = !mark;
    stone.className = mark ? `stone ${mark.side}` : "stone";
    stone.textContent = showNumbers && mark ? mark.number : "";
  });
}

function setText(element, value) {
  if (element.textContent !== value) element.textContent = value;
}

function renderStatus(position, ply, aiWinPoints) {
  const controls = {
    "decline-win": false, "accept-win": false, spare: false, "win-undo": false, retry: false, "return-live": false,
  };
  let stage = "play";
  let kicker = "对弈中";
  let title;
  let description;

  if (cursor !== null) {
    stage = "review";
    kicker = "复盘中";
    const move = game.moves[ply - 1];
    title = move ? `第 ${ply} 手 · ${coordinate(move.x, move.y)}` : "开局";
    description = `已走 ${ply} / ${game.moves.length} 手。回到最新可继续对弈。`;
    controls["return-live"] = true;
  } else if (position.winner) {
    stage = "end";
    kicker = "对局结束";
    const aiWon = isAiGame() && position.winner === aiSide();
    title = aiWon ? "Rapfi 获胜" : isAiGame() ? "你赢了！" : `${colorName[position.winner]}获胜`;
    description = position.noLegalMove ? "黑棋已无合法落点，白棋获胜。" : aiWon
      ? "可以让 AI 换一个落点，或退回到你上一手之前。"
      : `${colorName[position.winner]}连成五子。`;
    controls.spare = aiWon && !position.noLegalMove;
    controls["win-undo"] = undoTo(game.moves, game.settings) < game.moves.length;
  } else if (position.draw) {
    stage = "end";
    kicker = "对局结束";
    title = "和棋";
    description = "棋盘已满，双方均未连成五子。";
    controls["win-undo"] = true;
  } else if (position.forbidError) {
    stage = "error";
    kicker = "引擎异常";
    title = "暂时无法判定禁手";
    description = "当前棋局已保留。重试引擎可继续。";
    controls.retry = true;
  } else if (position.checking) {
    title = "正在判定黑棋禁手";
    description = "稍候即可落子。";
  } else if (aiWinPoints.length) {
    stage = "choice";
    kicker = "等待你的选择";
    title = "Rapfi 一手可胜";
    const points = aiWinPoints.map(({ x, y }) => coordinate(x, y)).join("、");
    description = canDecline(game.moves, aiWinPoints, position.forbidden)
      ? `${points} 可成五。你可以让 AI 改下其他位置。`
      : `${points} 可成五。其他落点均不可选，可以悔棋重下。`;
    controls["decline-win"] = controls["accept-win"] = true;
  } else if (isAiTurn(position)) {
    if (failedMove) {
      stage = "error";
      kicker = "引擎异常";
      title = "Rapfi 暂未落子";
      description = "当前棋局已保留。重试引擎可继续。";
      controls.retry = true;
    } else {
      title = engineState === "loading" ? "Rapfi 正在加载" : "Rapfi 正在思考";
      description = `轮到 ${colorName[position.turn]}。`;
    }
  } else {
    title = isAiGame() ? "轮到你落子" : `轮到${colorName[position.turn]}落子`;
    description = ply === 0 ? "黑棋先手，落子开始这局棋。" : `${colorName[position.turn]}行棋。`;
  }

  if (cursor === null && pending?.type === "spare") {
    title = "Rapfi 正在换一手";
    description = "正在搜索这手不会连成五子的落点。";
  }

  $("game-stage").dataset.stage = stage;
  setText($("game-stage").lastElementChild, kicker);
  setText($("game-title"), title);
  setText($("game-description"), description);
  $("status-actions").hidden = !Object.values(controls).some(Boolean);
  for (const [id, visible] of Object.entries(controls)) $(id).hidden = !visible;
  $("spare").disabled = pending?.type === "spare";
  $("decline-win").disabled = !canDecline(game.moves, aiWinPoints, position.forbidden) || Boolean(pending);
  $("accept-win").disabled = Boolean(pending);
  $("retry").disabled = Boolean(pending);
  $("action-note").hidden = !note || cursor !== null;
  setText($("action-note"), note);
}

function showWinrate(black, source) {
  const known = Number.isFinite(black);
  const format = (rate) => `${Number((rate * 100).toFixed(1))}%`;
  setText($("black-rate"), known ? format(black) : "—");
  setText($("white-rate"), known ? format(1 - black) : "—");
  setText($("winrate-source"), source);
  const track = $("winrate-track");
  track.dataset.known = String(known);
  if (known) track.firstElementChild.style.width = `${black * 100}%`;
}

function updateWinrate(position, ply, winPoints) {
  if (position.checking || position.forbidError) {
    clearTimeout(evaluationTimer);
    evaluation = null;
    showWinrate(null, position.checking ? "判定禁手中" : "暂无评估");
    return;
  }
  if (evaluation?.moves === game.moves && evaluation.ply === ply) return;
  const snapshot = { moves: game.moves, ply, renju: game.settings.renju };
  evaluation = snapshot;
  clearTimeout(evaluationTimer);

  if (position.winner) {
    showWinrate(position.winner === BLACK ? 1 : 0, "对局结果");
  } else if (position.draw) {
    showWinrate(null, "对局结果 · 和棋");
  } else if (winPoints.length) {
    showWinrate(position.turn === BLACK ? 1 : 0, "一手成五");
  } else {
    showWinrate(null, "Rapfi 评估中");
    evaluationTimer = setTimeout(async () => {
      try {
        const rate = await engine.evaluate(snapshot.moves.slice(0, ply), snapshot.renju);
        if (evaluation === snapshot) {
          showWinrate(rate, Number.isFinite(rate) ? "Rapfi 估计" : "暂无评估");
        }
      } catch {
        if (evaluation === snapshot) {
          evaluation = null;
          showWinrate(null, "暂无评估");
        }
      }
    }, 35);
  }
}

function renderHistory(ply) {
  const moves = game.moves;
  const list = $("move-list");
  $("move-count").textContent = `${moves.length} 手`;
  $("history-empty").hidden = Boolean(moves.length);
  list.hidden = !moves.length;
  if (listedMoves !== moves) {
    listedMoves = moves;
    historyButtons = [];
    const items = moves.map((move, i) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.className = "button button-subtle";
      button.type = "button";
      const point = coordinate(move.x, move.y);
      button.setAttribute("aria-label", `第 ${i + 1} 手，${colorName[sideAt(i)]} ${point}${move.assisted ? "，AI 换手" : ""}`);

      const number = document.createElement("span");
      number.className = "move-index";
      number.textContent = i + 1;
      const stone = document.createElement("i");
      stone.className = `stone ${sideAt(i)}`;
      stone.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "move-coordinate";
      label.textContent = point;
      button.append(number, stone, label);
      if (move.assisted) {
        const edited = document.createElement("span");
        edited.className = "move-assist";
        edited.textContent = "换手";
        button.append(edited);
      }
      button.addEventListener("click", () => review(i + 1));
      item.append(button);
      historyButtons.push(button);
      return item;
    });
    list.replaceChildren(...items);
  }
  historyButtons.forEach((button, i) => {
    if (i + 1 === ply) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  });
  const active = historyButtons[ply - 1];
  if (active) {
    const top = active.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + active.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + active.offsetHeight - list.clientHeight;
    }
  } else {
    list.scrollTop = 0;
  }
  $("first-move").disabled = $("prev-move").disabled = ply === 0;
  $("next-move").disabled = $("last-move").disabled = cursor === null;
  $("export").disabled = !moves.length;
}

function render() {
  const ply = cursor ?? game.moves.length;
  const live = playedPosition();
  void checkLegality(live);
  const position = cursor === null ? live : positionOf(game.moves, game.settings.renju, ply);
  const winPoints = takeWinPoints(position);
  const aiWinPoints = cursor === null && isAiTurn(position) && !pending ? winPoints : [];
  $("engine-state").dataset.state = engineState;
  setText($("engine-state").lastElementChild,
    { loading: "Rapfi 加载中", ready: "Rapfi 已就绪", error: "Rapfi 加载异常" }[engineState]);
  const showTurn = cursor === null && !isFinished(position);
  $("black-player").dataset.active = String(showTurn && position.turn === BLACK);
  $("white-player").dataset.active = String(showTurn && position.turn === WHITE);
  $("black-name").textContent = isAiGame() ? sideLabel(BLACK) : "玩家一";
  $("white-name").textContent = isAiGame() ? sideLabel(WHITE) : "玩家二";
  $("undo").disabled = cursor !== null || undoTo(game.moves, game.settings) === game.moves.length;
  $("hint").disabled = !canPlay(position) || Boolean(pending);
  $("hint").textContent = pending?.type === "hint" ? "计算中…" : "落子提示";
  $("numbers").checked = showNumbers;
  $("renju").checked = game.settings.renju;
  $("renju-note").hidden = !game.settings.renju;
  const ruleName = game.settings.renju ? "黑棋禁手" : "自由规则";
  setText($("rule-name"), ruleName);
  $("rule-badge").setAttribute("aria-label", `十五路棋盘，${ruleName}`);
  $("side-row").hidden = $("difficulty-row").hidden = !isAiGame();
  $("difficulty").value = game.settings.difficulty;
  for (const button of modeOptions) button.setAttribute("aria-pressed", String(button.dataset.mode === game.settings.mode));
  for (const button of sideOptions) button.setAttribute("aria-pressed", String(button.dataset.side === game.settings.side));

  drawBoard(position, ply, aiWinPoints);
  renderStatus(position, ply, aiWinPoints);
  updateWinrate(position, ply, winPoints);
  renderHistory(ply);
}

function resetTransient() {
  cursor = null;
  pending = null;
  hint = null;
  note = "";
  failedMove = false;
  legalityCheck = null;
}

function recordMove(move) {
  game.moves = [...game.moves, move];
  hint = null;
  save();
}

async function loadEngine() {
  try {
    await engine.ready();
    engineState = "ready";
  } catch (error) {
    engineState = "error";
    console.error(error);
  }
  render();
}

async function requestMove(type, moves = game.moves, excluded = []) {
  const job = { type };
  pending = job;
  failedMove = false;
  note = "";
  hint = null;
  if (engineState === "error" && !engine.worker) engineState = "loading";
  render();
  try {
    const move = await engine.find(moves, game.settings.difficulty, excluded, game.settings.renju);
    if (pending !== job) return;
    const { cells } = positionOf(moves, game.settings.renju);
    if (!onBoard(move?.x, move?.y) || cells[cellIndex(move.x, move.y)]
      || excluded.some(({ x, y }) => move.x === x && move.y === y)) {
      throw new Error("Rapfi returned an unavailable coordinate.");
    }
    pending = null;
    engineState = "ready";
    if (type === "hint") {
      hint = cellIndex(move.x, move.y);
      note = `推荐落点 ${coordinate(move.x, move.y)}。`;
    } else if (type === "spare") {
      game.moves = moves;
      recordMove({ ...move, assisted: true });
      note = `AI 改下 ${coordinate(move.x, move.y)}。继续对弈。`;
    } else {
      recordMove(move);
    }
  } catch (error) {
    if (pending !== job) return;
    console.error(error);
    pending = null;
    engineState = engine.worker ? "ready" : "error";
    failedMove = type === "move";
    if (type === "hint") note = "暂时无法给出提示，可以再试一次。";
    if (type === "spare") {
      note = error.message === "NO_LEGAL_MOVE"
        ? "已经没有其他合法落点。你可以选择悔棋重下。"
        : "暂时无法换手。可以重试，或悔棋重下。";
    }
  }
  render();
}

function maybeAiMove() {
  const position = playedPosition();
  if (isAiTurn(position) && !position.checking && !position.forbidError
    && !failedMove && !pending && !takeWinPoints(position).length) {
    void requestMove("move");
  }
}

function playHuman(x, y) {
  const position = playedPosition();
  const index = cellIndex(x, y);
  if (!canPlay(position) || position.cells[index]) return;
  if (position.forbidden?.has(index)) {
    note = `${coordinate(x, y)} 是黑棋禁手，请换一个位置。`;
    render();
    return;
  }
  resetTransient();
  recordMove({ x, y });
  render();
  maybeAiMove();
}

function undo() {
  const length = undoTo(game.moves, game.settings);
  if (cursor !== null || length === game.moves.length) return;
  resetTransient();
  game.moves = game.moves.slice(0, length);
  save();
  render();
}

function spare() {
  const position = playedPosition();
  if (pending || cursor !== null || !isAiGame() || position.winner !== aiSide() || !position.wins.size) return;
  const moves = game.moves.slice(0, -1);
  const excluded = takeWinPoints(positionOf(moves, game.settings.renju));
  if (!canDecline(moves, excluded)) {
    note = "已经没有其他合法落点。你可以选择悔棋重下。";
    render();
    return;
  }
  void requestMove("spare", moves, excluded);
}

function decideWinningMove(accept) {
  const position = playedPosition();
  if (cursor !== null || pending || !isAiTurn(position)) return;
  const winPoints = takeWinPoints(position);
  if (!winPoints.length) return;
  if (accept) {
    resetTransient();
    recordMove(winPoints[0]);
    render();
  } else if (canDecline(game.moves, winPoints, position.forbidden)) {
    void requestMove("spare", game.moves, winPoints);
  }
}

function review(ply) {
  cursor = ply >= game.moves.length ? null : Math.max(0, ply);
  render();
}

function replaceGame(next, importing = false) {
  const commit = () => {
    resetTransient();
    game = next;
    if (importing) note = "棋谱已载入。";
    $("file-note").hidden = true;
    save();
    render();
    maybeAiMove();
  };
  if (!game.moves.length) {
    commit();
    return;
  }
  replaceAction = commit;
  const dialog = $("replace-dialog");
  dialog.returnValue = "";
  $("dialog-title").textContent = importing ? "导入棋谱？" : "开始新对局？";
  $("dialog-description").textContent = importing ? "导入的棋谱将替换当前棋局。" : "当前棋局将被清空。你可以先导出棋谱。";
  $("dialog-confirm").textContent = importing ? "导入棋谱" : "开始新对局";
  dialog.showModal();
}

function newGame(changes = {}) {
  replaceGame({ settings: { ...game.settings, ...changes }, moves: [] });
}

function exportRecord() {
  if (!game.moves.length) return;
  const blob = new Blob([JSON.stringify({ version: 1, ...game }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `五子棋-${game.moves.length}手.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("new-game").addEventListener("click", () => newGame());
$("replace-dialog").addEventListener("close", () => {
  const action = replaceAction;
  replaceAction = null;
  if ($("replace-dialog").returnValue === "confirm") action?.();
});
for (const button of modeOptions) button.addEventListener("click", () => {
  if (button.dataset.mode !== game.settings.mode) newGame({ mode: button.dataset.mode });
});
for (const button of sideOptions) button.addEventListener("click", () => {
  if (button.dataset.side !== game.settings.side) newGame({ side: button.dataset.side });
});
$("difficulty").addEventListener("change", () => {
  game.settings.difficulty = $("difficulty").value;
  save();
});
$("renju").addEventListener("change", () => {
  const renju = $("renju").checked;
  $("renju").checked = game.settings.renju;
  newGame({ renju });
});
$("numbers").addEventListener("change", () => {
  showNumbers = $("numbers").checked;
  save();
  render();
});

$("undo").addEventListener("click", undo);
$("win-undo").addEventListener("click", undo);
$("spare").addEventListener("click", spare);
$("decline-win").addEventListener("click", () => decideWinningMove(false));
$("accept-win").addEventListener("click", () => decideWinningMove(true));
$("retry").addEventListener("click", () => {
  if (playedPosition().forbidError) {
    legalityCheck = null;
    render();
  } else {
    void requestMove("move");
  }
});
$("hint").addEventListener("click", () => {
  if (!pending && canPlay(playedPosition())) void requestMove("hint");
});
$("return-live").addEventListener("click", () => review(game.moves.length));
$("first-move").addEventListener("click", () => review(0));
$("prev-move").addEventListener("click", () => review((cursor ?? game.moves.length) - 1));
$("next-move").addEventListener("click", () => review((cursor ?? game.moves.length) + 1));
$("last-move").addEventListener("click", () => review(game.moves.length));

$("export").addEventListener("click", exportRecord);
$("import").addEventListener("click", () => $("record-file").click());
$("record-file").addEventListener("change", async () => {
  const input = $("record-file");
  const file = input.files[0];
  input.value = "";
  if (!file) return;
  try {
    const next = parseRecord(JSON.parse(await file.text()));
    if (next.settings.renju) {
      const invalid = await engine.validateRenju(next.moves);
      if (invalid !== null) throw new Error(`棋谱第 ${invalid} 手落在黑棋禁手点。`);
    }
    replaceGame(next, true);
  } catch (error) {
    $("file-note").textContent = error instanceof SyntaxError ? "请选择本棋室导出的 JSON 棋谱。" : error.message;
    $("file-note").hidden = false;
  }
});

render();
void loadEngine();
maybeAiMove();
