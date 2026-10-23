import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  CreateInvitation,
  FieldError,
  type Invitation,
  Invitation as InvitationSchema,
  type Invitations,
  Invitations as InvitationsSchema,
  SetCapabilities,
  type UserAccount,
  UserAccount as UserAccountSchema,
  type UserAccounts,
  UserAccounts as UserAccountsSchema,
} from "@open-macaron/contracts";
import type { Request } from "express";
import { z } from "zod";
import { InvitationsService } from "../accounts/invitations.service.ts";
import { SessionsService } from "../accounts/sessions.service.ts";
import { UsersService } from "../accounts/users.service.ts";

/**
 * Invitations and capabilities. Admins only: every handler checks the session's role first. Reached
 * only by the web app (the edge never routes /v1/admin).
 */
@ApiTags("admin")
@ApiCookieAuth()
@Controller("v1/admin")
export class AdminController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly invitations: InvitationsService,
    private readonly users: UsersService,
  ) {}

  @Get("invitations")
  @ApiOperation({ operationId: "listInvitations", summary: "Every invitation, newest first" })
  @ApiResponse({ status: 200, standardSchema: InvitationsSchema })
  @ApiResponse({ status: 403, description: "Not an admin" })
  async listInvitations(@Req() request: Request): Promise<Invitations> {
    await this.sessions.admin(request.headers);
    return { invitations: await this.invitations.list() };
  }

  @Post("invitations")
  @ApiOperation({ operationId: "createInvitation", summary: "Invite a GitHub account, with the capabilities it will have" })
  @ApiResponse({ status: 201, standardSchema: InvitationSchema })
  @ApiResponse({ status: 409, standardSchema: FieldError, description: "Unknown login, an account or a pending invitation already" })
  async createInvitation(@Req() request: Request, @Body({ schema: CreateInvitation }) body: CreateInvitation): Promise<Invitation> {
    const admin = await this.sessions.admin(request.headers);
    return this.invitations.invite(body.githubLogin, body.capabilities, admin);
  }

  @Post("invitations/:id/revoke")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: "revokeInvitation", summary: "Revoke a pending invitation" })
  @ApiResponse({ status: 204, description: "Revoked, or not pending anymore" })
  async revokeInvitation(@Req() request: Request, @Param("id", { schema: z.uuid() }) id: string): Promise<void> {
    const admin = await this.sessions.admin(request.headers);
    await this.invitations.revoke(id, admin);
  }

  @Get("users")
  @ApiOperation({ operationId: "listUsers", summary: "Every account, oldest first" })
  @ApiResponse({ status: 200, standardSchema: UserAccountsSchema })
  async listUsers(@Req() request: Request): Promise<UserAccounts> {
    await this.sessions.admin(request.headers);
    return { users: await this.users.list() };
  }

  @Put("users/:id/capabilities")
  @ApiOperation({ operationId: "setUserCapabilities", summary: "Replace what a user may ask the bot for" })
  @ApiResponse({ status: 200, standardSchema: UserAccountSchema })
  @ApiResponse({ status: 409, standardSchema: FieldError, description: "Unknown user, or an admin" })
  async setCapabilities(@Req() request: Request, @Param("id", { schema: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }) id: string, @Body({ schema: SetCapabilities }) body: SetCapabilities): Promise<UserAccount> {
    const admin = await this.sessions.admin(request.headers);
    return this.users.setCapabilities(id, body.capabilities, admin);
  }
}
