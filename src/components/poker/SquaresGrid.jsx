"use client";
import { PlayingCard } from "./PlayingCard.jsx";
import { scoreGrid } from "@/lib/squares-engine/scoring.js";
import { RANK_CHARS, SUIT_GLYPHS } from "@/lib/poker-engine/cards";

function LineLabel({ line, t, col = false }) {
    return (<div className={`sq-label ${col ? "sq-label-col" : ""}`}>
      {line ? (<>
          <span className="truncate">{t(`line.${line.key}`)}</span>
          <b className="tabular-nums">{line.points}</b>
        </>) : null}
    </div>);
}

// A player's 5x5 grid with each full row and column's hand and points.
// When onPlace is given, empty cells are buttons.
export function SquaresGrid({ grid, t, onPlace = null, testid = "squares-grid" }) {
    const cells = grid ?? new Array(25).fill(null);
    const score = scoreGrid(cells);
    const items = [];
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            const i = r * 5 + c;
            const card = cells[i];
            if (card !== null && card !== undefined) {
                items.push(<div key={i} className="sq-cell sq-cell-filled" data-cell={i}>
            <PlayingCard card={card} size="grid" animate={false}/>
          </div>);
            }
            else if (onPlace) {
                items.push(<button key={i} type="button" className="sq-cell sq-open" onClick={() => onPlace(i)} aria-label={t("table.placeAt", { row: r + 1, col: c + 1 })} data-cell={i} data-testid={`cell-${i}`}/>);
            }
            else {
                items.push(<div key={i} className="sq-cell" data-cell={i}/>);
            }
        }
        items.push(<LineLabel key={`r${r}`} line={score.rows[r]} t={t}/>);
    }
    for (let c = 0; c < 5; c++)
        items.push(<LineLabel key={`c${c}`} line={score.cols[c]} t={t} col/>);
    items.push(<div key="corner"/>);
    return (<div className="sq-grid" data-testid={testid}>
      {items}
    </div>);
}

// Small read-only grid for results lists.
export function MiniGrid({ grid }) {
    return (<div className="sq-grid sq-grid-mini" aria-hidden>
      {(grid ?? []).map((card, i) => {
            const cell = card === null || card === undefined
                ? <div key={i} className="sq-cell"/>
                : (<div key={i} className={`sq-mini-card ${(card & 3) === 1 || (card & 3) === 2 ? "sq-mini-red" : ""}`}>
            {RANK_CHARS[card >> 2]}{SUIT_GLYPHS[card & 3]}
          </div>);
            return (i % 5 === 4) ? [cell, <div key={`l${i}`}/>] : cell;
        })}
    </div>);
}

export function gridTotal(grid) {
    return grid ? scoreGrid(grid).total : 0;
}
