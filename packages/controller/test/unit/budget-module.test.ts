import "reflect-metadata";
import { fileURLToPath } from "node:url";
import { Test } from "@nestjs/testing";
import { afterEach, expect, it, vi } from "vitest";
import { PriceList } from "../../src/budget/price-list.ts";
import { RunKeys } from "../../src/budget/run-keys.ts";
import { APP_ENV } from "../../src/config/env.ts";
import { RepoConfigService } from "../../src/config/repo-config.service.ts";
import { ModelPreferencesService } from "../../src/keys/model-preferences.service.ts";
import { AccountsModule, BudgetModule, RunsModule } from "../../src/modules.ts";
import { RunLauncher } from "../../src/runs/run-launcher.ts";
import { testEnv } from "../support/env.ts";

afterEach(() => vi.restoreAllMocks());

it("reads prices once for key minting, model preferences and run launching", async () => {
  const read = vi.spyOn(PriceList, "fromFile");
  const addCheck = vi.fn();
  const env = testEnv({ LLM_PRICING_FILE: fileURLToPath(new URL("../../../../deploy/bifrost/pricing.json", import.meta.url)) });
  const module = await Test.createTestingModule({ imports: [RunsModule] })
    .useMocker((token) => {
      if (token === APP_ENV) return env;
      if (token === RepoConfigService) return { addCheck };
      if (token === PriceList) throw new Error("PriceList must come from BudgetModule");
      return {};
    })
    .compile();

  try {
    expect(read).toHaveBeenCalledExactlyOnceWith(env.bifrost.pricingFile);
    const prices = module.select(BudgetModule).get(PriceList, { strict: true });
    expect(module.get(RunLauncher)).toBeInstanceOf(RunLauncher);
    expect(addCheck).toHaveBeenCalledOnce();

    const unbillable = vi.spyOn(prices, "unbillable");
    await expect(module.get(RunKeys).unbillable(["missing-model"])).resolves.toEqual(["missing-model"]);
    expect(unbillable).toHaveBeenCalledWith(["missing-model"]);

    const patch = vi.spyOn(prices, "patch");
    await expect(module.select(AccountsModule).get(ModelPreferencesService, { strict: true }).save("user", { model: "missing-model" }))
      .rejects.toThrow(/missing-model has no pinned price/);
    expect(patch).toHaveBeenCalledWith("missing-model");
  } finally {
    await module.close();
  }
});
