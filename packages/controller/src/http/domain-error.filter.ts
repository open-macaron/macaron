import { type ArgumentsHost, Catch, type ExceptionFilter, HttpStatus, Logger } from "@nestjs/common";
import type { Response } from "express";
import { DomainError, OidcRejected, TicketAlreadyRedeemed, TicketRejected } from "../common/errors.ts";
import { RunNotBoundYet } from "../runs/runs.repository.ts";

/**
 * Maps expected failures to HTTP statuses at the edge. Messages stay generic: the caller is an
 * untrusted runner, it learns what to do (retry, give up), not why in detail.
 */
@Catch(DomainError, RunNotBoundYet)
export class DomainErrorFilter implements ExceptionFilter<DomainError | RunNotBoundYet> {
  private readonly logger = new Logger(DomainErrorFilter.name);

  catch(error: DomainError | RunNotBoundYet, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const [status, code] = statusOf(error);
    this.logger.warn(`${String(status)} ${code}: ${error.message}`);
    response.status(status).json({ error: code });
  }
}

/** RFC 8470 "Too Early": not in Nest's HttpStatus enum. */
const TOO_EARLY = 425;

function statusOf(error: DomainError | RunNotBoundYet): readonly [number, string] {
  if (error instanceof RunNotBoundYet) return [TOO_EARLY, "retry_later"];
  if (error instanceof OidcRejected) return [HttpStatus.UNAUTHORIZED, error.code];
  if (error instanceof TicketAlreadyRedeemed) return [HttpStatus.CONFLICT, error.code];
  if (error instanceof TicketRejected) return [HttpStatus.FORBIDDEN, error.code];
  return [HttpStatus.UNPROCESSABLE_ENTITY, error.code];
}
