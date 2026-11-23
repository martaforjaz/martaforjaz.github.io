"use strict";

const initial = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
const pieces = {p:"♟",n:"♞",b:"♝",r:"♜",q:"♛",k:"♚",P:"♙",N:"♘",B:"♗",R:"♖",Q:"♕",K:"♔"};
const board = document.querySelector("#board");
const previous = document.querySelector("#previous");
const next = document.querySelector("#next");
const label = document.querySelector("#move-label");
let moves = [];
let step = 0;

function draw() {
  const record = moves[step - 1];
  const fen = record ? record.fen.split(" ")[0] : initial;
  const squares = fen.replaceAll("/", "").replace(/[1-8]/g, n => ".".repeat(Number(n)));
  board.replaceChildren(...[...squares].map((piece, index) => {
    const cell = document.createElement("span");
    const col = index % 8;
    const row = Math.floor(index / 8);
    const square = "abcdefgh"[col] + (8 - row);
    const moved = record && [record.move.slice(0, 2), record.move.slice(2, 4)].includes(square);
    cell.className = "square " + ((col + row) % 2 ? "dark" : "light") + (moved ? " last" : "");
    cell.setAttribute("aria-hidden", "true");
    cell.textContent = pieces[piece] || "";
    return cell;
  }));
  label.textContent = record ? `${step}/${moves.length} · ${record.move}${record.verification_retries ? " · camera retry" : ""}` : "Starting position";
  board.setAttribute("aria-label", record ? `Board after ${record.move}` : "Chess starting position");
  previous.disabled = step === 0;
  next.disabled = step >= moves.length;
}

previous.addEventListener("click", () => { if (step > 0) { step -= 1; draw(); } });
next.addEventListener("click", () => { if (step < moves.length) { step += 1; draw(); } });
draw();
fetch("assets/chess.json").then(response => {
  if (!response.ok) throw Error("Replay unavailable");
  return response.json();
}).then(records => { moves = records; draw(); }).catch(() => {
  label.textContent = "Replay unavailable. See the repository for the recorded moves.";
});
