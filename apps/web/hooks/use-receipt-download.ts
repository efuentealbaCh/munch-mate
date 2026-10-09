"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { useSocketEvent } from "@/hooks/use-realtime";
import { ApiError } from "@/lib/api";
import { type DownloadedFile, RECEIPT_TIMEOUT_MS, receiptRetryDelay, saveBlob } from "@/lib/download";
import { errorMessage } from "@/lib/errors";
import type { AppSocket } from "@/lib/realtime";

interface Waiter {
  /** Order the download is for; undefined = any event on this socket (the customer's socket only joins one order). */
  orderId: string | undefined;
  wake(): void;
}

/**
 * Downloads order receipts. Right after an order is accepted the workers are still generating the PDF and
 * the api answers 202: the download then waits for `order.receipt-ready` on the given socket (the staff's
 * restaurant room or the customer's order room), with a short backoff as fallback, up to 60 s.
 * @returns `working`: keys of the downloads in progress; `download(key, fetchOnce, orderId?)`.
 */
export function useReceiptDownload(socket: AppSocket | null) {
  const [working, setWorking] = useState<ReadonlySet<string>>(new Set());
  const waiters = useRef(new Set<Waiter>());

  useSocketEvent(socket, "order.receipt-ready", ({ orderId }) => {
    for (const waiter of waiters.current) {
      if (waiter.orderId === undefined || waiter.orderId === orderId) waiter.wake();
    }
  });

  const wait = (orderId: string | undefined, ms: number) =>
    new Promise<void>((resolve) => {
      const waiter: Waiter = {
        orderId,
        wake: () => {
          clearTimeout(timer);
          waiters.current.delete(waiter);
          resolve();
        },
      };
      const timer = setTimeout(waiter.wake, ms);
      waiters.current.add(waiter);
    });

  const mark = (key: string, on: boolean) =>
    setWorking((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  /**
   * @param key Identifies the download for `working` (order id, or anything stable).
   * @param fetchOnce One request: the file, or null while it is still being generated.
   * @param orderId Only events for this order wake the wait (staff sockets receive every order's events).
   * @returns Whether the file was saved (errors are shown as a toast).
   */
  async function download(key: string, fetchOnce: () => Promise<DownloadedFile | null>, orderId?: string): Promise<boolean> {
    if (working.has(key)) return false;
    mark(key, true);
    try {
      const deadline = Date.now() + RECEIPT_TIMEOUT_MS;
      let file = await fetchOnce();
      for (let attempt = 0; !file; attempt++) {
        if (Date.now() > deadline) {
          throw new ApiError(0, "RECEIPT_TIMEOUT", "El comprobante está tardando más de lo normal. Intenta de nuevo en un rato.");
        }
        await wait(orderId, receiptRetryDelay(attempt));
        file = await fetchOnce();
      }
      saveBlob(file.blob, file.filename);
      toast.success("Comprobante descargado");
      return true;
    } catch (failure) {
      toast.error(errorMessage(failure));
      return false;
    } finally {
      mark(key, false);
    }
  }

  return { working, download };
}
