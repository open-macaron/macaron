import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { Mode, ModelPreference, MyModels, RepoConfig } from "@open-macaron/contracts";
import { eq } from "drizzle-orm";
import { PriceList } from "../budget/price-list.ts";
import { Clock } from "../common/clock.ts";
import { FieldRefused } from "../common/errors.ts";
import type { Db } from "../db/db.module.ts";
import { users } from "../db/schema.ts";

/** The models a run uses: the payer's picks first, the configuration's defaults after. */
export interface RunModels {
  readonly model: string;
  readonly fastModel: string;
}

/**
 * The models each user picks for their runs, among the ones the gateway prices or serves for free:
 * a run's budget or token cap can't bound any other. A pick replaces the configuration's defaults,
 * not a model it sets for a mode (reviews tuned for one); one that loses its price or its free mark
 * refuses the run rather than silently falling back.
 */
@Injectable()
export class ModelPreferencesService {
  constructor(
    @InjectDrizzle() private readonly db: Db,
    private readonly prices: PriceList,
    private readonly clock: Clock,
  ) {}

  /** What the user may pick, and what they picked. */
  async mine(userId: string): Promise<MyModels> {
    return { models: this.prices.billable(), free: this.prices.free(), preference: await this.preference(userId) };
  }

  /** Stores the picks, all of them billable, or refuses the one that isn't. */
  async save(userId: string, preference: ModelPreference): Promise<MyModels> {
    for (const field of ["model", "fastModel"] as const) {
      const model = preference[field];
      if (model !== undefined && this.prices.patch(model) === undefined) throw new FieldRefused(field, `${model} has no pinned price and isn't marked free, so nothing could cap a run on it.`);
    }
    await this.db.update(users).set({ modelPreferences: preference, updatedAt: this.clock.now() }).where(eq(users.id, userId));
    return this.mine(userId);
  }

  /**
   * The models a run uses, or why a pick that lost its price or free mark since it was saved refuses
   * it (`settings` is the key page's address).
   */
  async resolve(userId: string, mode: Mode, config: RepoConfig, settings: string): Promise<{ readonly models: RunModels } | { readonly refusal: string }> {
    const preference = await this.preference(userId);
    const model = config.models[mode] === undefined ? preference.model : undefined;
    const fastModel = preference.fastModel;
    for (const [what, picked] of [["model", model], ["fast model", fastModel]] as const) {
      if (picked !== undefined && this.prices.patch(picked) === undefined) return { refusal: `the ${what} you picked (${picked}) has no pinned price any more and isn't marked free: pick another on macaron (${settings})` };
    }
    return { models: { model: config.models[mode] ?? model ?? config.model, fastModel: fastModel ?? config.fastModel } };
  }

  private async preference(userId: string): Promise<ModelPreference> {
    const [row] = await this.db.select({ preference: users.modelPreferences }).from(users).where(eq(users.id, userId));
    return row?.preference ?? {};
  }
}
