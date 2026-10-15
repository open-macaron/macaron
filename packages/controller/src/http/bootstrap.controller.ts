import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { BootstrapRequest, BootstrapResponse } from "@open-macaron/contracts";
import { OidcRejected } from "../common/errors.ts";
import { RunLauncher } from "../runs/run-launcher.ts";

@ApiTags("runner")
@Controller("v1/bootstrap")
export class BootstrapController {
  constructor(private readonly launcher: RunLauncher) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    operationId: "bootstrap",
    summary: "Exchange a GitHub Actions OIDC token and a one-time ticket for the run's key and context",
  })
  @ApiResponse({ status: 200, standardSchema: BootstrapResponse })
  @ApiResponse({ status: 401, description: "OIDC token missing, invalid, or not from the runner workflow" })
  @ApiResponse({ status: 403, description: "Ticket unknown, or bound to another workflow run" })
  @ApiResponse({ status: 409, description: "Ticket already redeemed" })
  @ApiResponse({ status: 425, description: "The dispatch is not recorded yet; retry shortly" })
  async bootstrap(@Headers("authorization") authorization: string | undefined, @Body({ schema: BootstrapRequest }) body: BootstrapRequest): Promise<BootstrapResponse> {
    const token = /^Bearer (\S+)$/.exec(authorization ?? "")?.[1];
    if (token === undefined) throw new OidcRejected("missing bearer token");
    return this.launcher.bootstrap(token, body.ticket);
  }
}
