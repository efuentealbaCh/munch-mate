"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PaperWidth, Ticket } from "@/lib/print";

/**
 * Prints tickets on a receipt printer through the browser's print dialog (phase 8). Tickets are queued: the
 * next one prints after the previous dialog closes (`afterprint`), so two orders arriving together both print.
 * With Chrome started with `--kiosk-printing`, printing goes straight to the default printer without a dialog.
 * @returns `print(ticket)` and the element to render once (a portal into <body>).
 */
export function useTicketPrinter(paper: PaperWidth): { print(ticket: Ticket): void; element: React.ReactNode } {
  const [current, setCurrent] = useState<Ticket | null>(null);
  const queue = useRef<Ticket[]>([]);
  const busy = useRef(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const next = useCallback(() => {
    const ticket = queue.current.shift() ?? null;
    busy.current = ticket !== null;
    setCurrent(ticket);
  }, []);

  const print = useCallback(
    (ticket: Ticket) => {
      queue.current.push(ticket);
      if (!busy.current) next();
    },
    [next],
  );

  // Once the ticket is on the page, open the print dialog; when it closes, print the next one.
  useEffect(() => {
    if (!current) return;
    const done = () => {
      window.removeEventListener("afterprint", done);
      next();
    };
    window.addEventListener("afterprint", done);
    const frame = requestAnimationFrame(() => window.print());
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("afterprint", done);
    };
  }, [current, next]);

  const element = mounted
    ? createPortal(
        <div id="print-root" data-paper={paper} data-printing={current ? "" : undefined} aria-hidden>
          {/* @page cannot depend on an attribute: the paper size goes in a style tag while printing. */}
          {current ? <style>{`@page { size: ${paper}mm auto; margin: 2mm; }`}</style> : null}
          {current ? <TicketView ticket={current} /> : null}
        </div>,
        document.body,
      )
    : null;

  return { print, element };
}

/** The ticket itself: plain black text, sized by the paper (see the print rules in globals.css). */
export function TicketView({ ticket }: { ticket: Ticket }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2mm" }} data-testid="ticket">
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "1.9em", fontWeight: 900, lineHeight: 1.1 }}>{ticket.headline}</div>
        <div style={{ fontWeight: 700 }}>{ticket.title}</div>
        {ticket.meta.map((row) => (
          <div key={row}>{row}</div>
        ))}
      </div>
      <hr style={{ border: 0, borderTop: "1px dashed #000", margin: 0 }} />
      {ticket.lines.map((line, index) => (
        <div key={`${line.name}-${index}`}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "2mm", fontWeight: 700 }}>
            <span>
              {line.quantity} × {line.name}
            </span>
            {line.amount ? <span style={{ whiteSpace: "nowrap" }}>{line.amount}</span> : null}
          </div>
          {line.details.map((detail) => (
            <div key={detail} style={{ paddingLeft: "3mm" }}>
              {detail}
            </div>
          ))}
        </div>
      ))}
      {ticket.totals.length > 0 ? (
        <>
          <hr style={{ border: 0, borderTop: "1px dashed #000", margin: 0 }} />
          {ticket.totals.map((total) => (
            <div key={total.label} style={{ display: "flex", justifyContent: "space-between", fontWeight: total.strong ? 900 : 400 }}>
              <span>{total.label}</span>
              <span>{total.amount}</span>
            </div>
          ))}
        </>
      ) : null}
      {ticket.footer.length > 0 ? (
        <div style={{ textAlign: "center", marginTop: "1mm" }}>
          {ticket.footer.map((row) => (
            <div key={row}>{row}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
