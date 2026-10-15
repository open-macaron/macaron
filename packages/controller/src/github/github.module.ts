import { Global, Module } from "@nestjs/common";
import { APP_ENV, type AppEnv } from "../config/env.ts";
import { createGitHub, GH_INTERACT, GH_ORG, GH_PUSH } from "./github.ts";

@Global()
@Module({
  providers: [
    { provide: GH_INTERACT, inject: [APP_ENV], useFactory: (env: AppEnv) => createGitHub("interact", env.GH_INTERACT, env.GITHUB_API_VERSION) },
    { provide: GH_PUSH, inject: [APP_ENV], useFactory: (env: AppEnv) => createGitHub("push", env.GH_PUSH, env.GITHUB_API_VERSION) },
    { provide: GH_ORG, inject: [APP_ENV], useFactory: (env: AppEnv) => createGitHub("org", env.GH_ORG, env.GITHUB_API_VERSION) },
  ],
  exports: [GH_INTERACT, GH_PUSH, GH_ORG],
})
export class GitHubModule {}
