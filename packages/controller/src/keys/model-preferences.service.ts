import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { type Mode, type ModelPreference, type MyModels, type RepoConfig, ruleReviewModes } from "@open-macaron/contracts";
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
  /** What checks the knowledge rules: a review's `model`, and a full review's rule sessions. */
  readonly reviewModel: string;
}

const PICKS = ["model", "fastModel", "reviewModel"] as const;
const PICK_NAMES: Readonly<Record<(typeof PICKS)[number], string>> = { model: "model", fastModel: "fast model", reviewModel: "review model" };

/**
 * The models each user picks for their runs, among the ones the gateway prices or serves for free:
 * a run's budget or token cap can't bound any other. A pick replaces the configuration's defaults;
 * one that loses its price or its free mark refuses the run rather than silently falling back.
 * Rules are checked on the review model, the user's default model unless they pick another: the
 * configuration's per-mode `models` are deprecated and ignored.
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
    for (const field of PICKS) {
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
    // Only the picks this run uses: a review model gone stale doesn't refuse a plan.
    const used = PICKS.filter((field) => (field === "reviewModel" ? ruleReviewModes.has(mode) : field !== "model" || mode !== "review" || preference.reviewModel === undefined));
    for (const field of used) {
      const picked = preference[field];
      if (picked !== undefined && this.prices.patch(picked) === undefined) {
        return { refusal: `the ${PICK_NAMES[field]} you picked (${picked}) has no pinned price any more and isn't marked free: pick another on macaron (${settings})` };
      }
    }
    const model = preference.model ?? config.model;
    const reviewModel = preference.reviewModel ?? model;
    return { models: { model: mode === "review" ? reviewModel : model, fastModel: preference.fastModel ?? config.fastModel, reviewModel } };
  }

  private async preference(userId: string): Promise<ModelPreference> {
    const [row] = await this.db.select({ preference: users.modelPreferences }).from(users).where(eq(users.id, userId));
    return row?.preference ?? {};
  }
}
