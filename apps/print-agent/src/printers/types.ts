import type { ReportedPrinter } from "@app/types";

/** A printer this computer can reach: what is reported to the server plus how to send bytes to it. */
export interface LocalPrinter extends ReportedPrinter {
  /**
   * Sends raw ESC/POS bytes. Resolves when the printer (network) or the Windows spooler (USB) accepted them.
   * @param docName Name of the document in the Windows queue ("Munch Mate <jobId>").
   * @throws Error with a message in Spanish, shown to the owner.
   */
  send(data: Buffer, docName: string): Promise<void>;
}

/** Runs a program without a shell (tests replace it). */
export type ExecFile = (
  file: string,
  args: string[],
  options: { timeout: number; windowsHide: boolean; maxBuffer?: number },
) => Promise<{ stdout: string; stderr: string }>;

/** Error of an ExecFile call: exit code, killed by the timeout, output. */
export interface ExecError extends Error {
  code?: number | string;
  killed?: boolean;
  signal?: string | null;
  stdout?: string;
  stderr?: string;
}
