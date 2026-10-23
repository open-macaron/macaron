import { type ArgumentsHost, Catch, type ExceptionFilter, HttpStatus, Logger } from "@nestjs/common";
import type { Response } from "express";
import { DomainError, FieldRefused, Forbidden, FreshSessionRequired, KeyStorageUnavailable, OidcRejected, SignInRequired, SignInUnavailable, TicketAlreadyRedeemed, TicketRejected, TooManyAttempts } from "../common/errors.ts";
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
    // A field refusal is meant for the person filling the form: its message is written for them.
    if (error instanceof FieldRefused) response.status(status).json({ error: code, field: error.field, message: error.message });
    else response.status(status).json({ error: code });
  }
}

/** RFC 8470 "Too Early": not in Nest's HttpStatus enum. */
const TOO_EARLY = 425;

function statusOf(error: DomainError | RunNotBoundYet): readonly [number, string] {
  if (error instanceof RunNotBoundYet) return [TOO_EARLY, "retry_later"];
  if (error instanceof OidcRejected) return [HttpStatus.UNAUTHORIZED, error.code];
  if (error instanceof TicketAlreadyRedeemed) return [HttpStatus.CONFLICT, error.code];
  if (error instanceof TicketRejected) return [HttpStatus.FORBIDDEN, error.code];
  if (error instanceof SignInRequired) return [HttpStatus.UNAUTHORIZED, error.code];
  if (error instanceof Forbidden) return [HttpStatus.FORBIDDEN, error.code];
  if (error instanceof SignInUnavailable) return [HttpStatus.SERVICE_UNAVAILABLE, error.code];
  if (error instanceof FieldRefused) return [HttpStatus.CONFLICT, error.code];
  if (error instanceof FreshSessionRequired) return [HttpStatus.FORBIDDEN, error.code];
  if (error instanceof TooManyAttempts) return [HttpStatus.TOO_MANY_REQUESTS, error.code];
  if (error instanceof KeyStorageUnavailable) return [HttpStatus.SERVICE_UNAVAILABLE, error.code];
  return [HttpStatus.UNPROCESSABLE_ENTITY, error.code];
}
