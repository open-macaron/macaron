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
    readonly service: "github" | "openrouter",
    message: string,
    readonly status: number | undefined,
    options?: ErrorOptions,
  ) {
    super(`${service}: ${message}`, options);
  }
}

/** Formats any thrown value for logs without leaking non-Error payloads blindly. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return typeof error === "string" ? error : "non-Error value thrown";
}
