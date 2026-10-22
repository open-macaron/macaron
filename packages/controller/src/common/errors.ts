import { inspect } from "node:util";

/** Base class for failures the controller expects and handles explicitly. */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class BudgetExceeded extends DomainError {
  readonly code = "budget_exceeded";
}

export class TicketRejected extends DomainError {
  readonly code = "ticket_rejected";
}

export class TicketAlreadyRedeemed extends DomainError {
  readonly code = "ticket_already_redeemed";
}

export class OidcRejected extends DomainError {
  readonly code = "oidc_rejected";
}

export class PolicyViolation extends DomainError {
  readonly code = "policy_violation";

  constructor(readonly violations: readonly string[]) {
    super(`policy violation: ${violations.join("; ")}`);
  }
}

export class UpstreamError extends DomainError {
  readonly code = "upstream_error";

  constructor(
    readonly service: "github" | "openrouter" | "bifrost" | "knowledge" | "config",
    message: string,
    readonly status: number | undefined,
    options?: ErrorOptions,
  ) {
    super(`${service}: ${message}`, options);
  }
}

/** Formats any thrown value for logs. Non-Error values (some libraries emit plain objects) are inspected. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  return `non-Error value thrown: ${inspect(error, { depth: 3, breakLength: Number.POSITIVE_INFINITY }).slice(0, 2_000)}`;
}
