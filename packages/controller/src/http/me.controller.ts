import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Put, Query, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  FieldError,
  GitHubLogin,
  type LlmKeyEvents,
  LlmKeyEvents as LlmKeyEventsSchema,
  LlmKeyEventsQuery,
  type Me,
  Me as MeSchema,
  type MyLlmKey,
  MyLlmKey as MyLlmKeySchema,
  type MyMonth,
  MyMonth as MyMonthSchema,
  type SavedLlmKey,
  SavedLlmKey as SavedLlmKeySchema,
  SaveLlmKey,
  SetMonthlyCap,
  type UsagePage,
  UsagePage as UsagePageSchema,
  UsageQuery,
} from "@open-macaron/contracts";
import type { Request } from "express";
import { MonthlyCapService } from "../accounts/monthly-cap.service.ts";
import { SessionsService } from "../accounts/sessions.service.ts";
import { UsageService } from "../accounts/usage.service.ts";
import { UsersService } from "../accounts/users.service.ts";
import { SignInRequired } from "../common/errors.ts";
import { LlmKeysService } from "../keys/llm-keys.service.ts";

/** The signed-in user's own data. Reached only by the web app (the edge never routes /v1/me). */
@ApiTags("me")
@ApiCookieAuth()
@Controller("v1/me")
export class MeController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly users: UsersService,
    private readonly usage: UsageService,
    private readonly keys: LlmKeysService,
    private readonly caps: MonthlyCapService,
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

  @Get("llm-key")
  @ApiOperation({ operationId: "getMyLlmKey", summary: "The signed-in user's LLM key (never the key itself) and the endpoints they may pick" })
  @ApiResponse({ status: 200, standardSchema: MyLlmKeySchema })
  @ApiResponse({ status: 401, description: "No valid session" })
  async myLlmKey(@Req() request: Request): Promise<MyLlmKey> {
    const user = await this.sessions.user(request.headers);
    return this.keys.mine(user);
  }

  @Put("llm-key")
  @ApiOperation({ operationId: "saveMyLlmKey", summary: "Check a key against its endpoint, then seal and store it, replacing the previous one" })
  @ApiResponse({ status: 200, standardSchema: SavedLlmKeySchema })
  @ApiResponse({ status: 401, description: "No valid session" })
  @ApiResponse({ status: 403, description: "fresh_session_required: signed in over 10 minutes ago" })
  @ApiResponse({ status: 409, standardSchema: FieldError, description: "The endpoint refused the key or couldn't check it, or isn't available" })
  @ApiResponse({ status: 429, description: "too_many_attempts: 5 per hour" })
  @ApiResponse({ status: 503, description: "key_storage_unavailable: no key-encryption key on this deployment" })
  async saveMyLlmKey(@Req() request: Request, @Body({ schema: SaveLlmKey }) body: SaveLlmKey): Promise<SavedLlmKey> {
    const user = await this.sessions.user(request.headers);
    return this.keys.save(user, body);
  }

  @Delete("llm-key")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: "deleteMyLlmKey", summary: "Delete the signed-in user's LLM key" })
  @ApiResponse({ status: 204, description: "Deleted, or there was none" })
  @ApiResponse({ status: 401, description: "No valid session" })
  @ApiResponse({ status: 403, description: "fresh_session_required: signed in over 10 minutes ago" })
  async deleteMyLlmKey(@Req() request: Request): Promise<void> {
    const user = await this.sessions.user(request.headers);
    await this.keys.remove(user);
  }

  @Get("llm-key/events")
  @ApiOperation({ operationId: "getMyLlmKeyEvents", summary: "The history of the signed-in user's key, newest first" })
  @ApiResponse({ status: 200, standardSchema: LlmKeyEventsSchema })
  @ApiResponse({ status: 401, description: "No valid session" })
  async myLlmKeyEvents(@Req() request: Request, @Query({ schema: LlmKeyEventsQuery }) query: LlmKeyEventsQuery): Promise<LlmKeyEvents> {
    const user = await this.sessions.user(request.headers);
    return this.keys.events(user.id, query.limit, query.before);
  }

  @Get("month")
  @ApiOperation({ operationId: "getMyMonth", summary: "The signed-in user's monthly cap, and what their key was billed this month" })
  @ApiResponse({ status: 200, standardSchema: MyMonthSchema })
  @ApiResponse({ status: 401, description: "No valid session" })
  async myMonth(@Req() request: Request): Promise<MyMonth> {
    const user = await this.sessions.user(request.headers);
    return this.caps.month(user.id);
  }

  @Put("monthly-cap")
  @ApiOperation({ operationId: "setMyMonthlyCap", summary: "Set or clear the signed-in user's monthly cap" })
  @ApiResponse({ status: 200, standardSchema: MyMonthSchema })
  @ApiResponse({ status: 401, description: "No valid session" })
  async setMyMonthlyCap(@Req() request: Request, @Body({ schema: SetMonthlyCap }) body: SetMonthlyCap): Promise<MyMonth> {
    const user = await this.sessions.user(request.headers);
    return this.caps.set(user.id, body.monthlyCapUsd);
  }
}
