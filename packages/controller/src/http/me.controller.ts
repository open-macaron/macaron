import { Controller, Get, Query, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { GitHubLogin, type Me, Me as MeSchema, type UsagePage, UsagePage as UsagePageSchema, UsageQuery } from "@open-macaron/contracts";
import type { Request } from "express";
import { SessionsService } from "../accounts/sessions.service.ts";
import { UsageService } from "../accounts/usage.service.ts";
import { UsersService } from "../accounts/users.service.ts";
import { SignInRequired } from "../common/errors.ts";

/** The signed-in user's own data. Reached only by the web app (the edge never routes /v1/me). */
@ApiTags("me")
@ApiCookieAuth()
@Controller("v1/me")
export class MeController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly users: UsersService,
    private readonly usage: UsageService,
  ) {}

  @Get()
  @ApiOperation({ operationId: "getMe", summary: "The signed-in user, with their capabilities" })
  @ApiResponse({ status: 200, standardSchema: MeSchema })
  @ApiResponse({ status: 401, description: "No valid session" })
  async me(@Req() request: Request): Promise<Me> {
    const user = await this.sessions.user(request.headers);
    const account = await this.users.get(user.id);
    if (account === undefined) throw new SignInRequired("the session's user no longer exists");
    return { githubId: user.githubId, githubLogin: GitHubLogin.parse(user.githubLogin), name: user.name, avatarUrl: user.image, role: user.role, capabilities: account.capabilities };
  }

  @Get("usage")
  @ApiOperation({ operationId: "getMyUsage", summary: "The runs the signed-in user asked for, newest first" })
  @ApiResponse({ status: 200, standardSchema: UsagePageSchema })
  @ApiResponse({ status: 401, description: "No valid session" })
  async myUsage(@Req() request: Request, @Query({ schema: UsageQuery }) query: UsageQuery): Promise<UsagePage> {
    const user = await this.sessions.user(request.headers);
    return this.usage.page(user.githubId, query.limit, query.before);
  }
}
