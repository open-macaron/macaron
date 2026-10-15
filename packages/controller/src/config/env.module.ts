import { Global, Module } from "@nestjs/common";
import { Clock, SystemClock } from "../common/clock.ts";
import { APP_ENV, parseEnv } from "./env.ts";

@Global()
@Module({
  providers: [
    // The only place in the codebase allowed to read process.env.
    // eslint-disable-next-line no-restricted-syntax
    { provide: APP_ENV, useFactory: () => parseEnv(process.env) },
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [APP_ENV, Clock],
})
export class EnvModule {}
