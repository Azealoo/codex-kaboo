import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { authedMutation, authedQuery } from "./lib/auth";
import type { MachineRow } from "./lib/types";

export function toMachineRow(doc: Doc<"machines">): MachineRow {
  const rl = doc.lastRateLimit;
  return {
    _id: doc._id,
    machineId: doc.machineId,
    userId: doc.userId,
    label: doc.label,
    hostname: doc.hostname ?? null,
    platform: doc.platform,
    arch: doc.arch ?? null,
    nodeVersion: doc.nodeVersion ?? null,
    cliVersion: doc.cliVersion,
    codexVersion: doc.codexVersion ?? null,
    codexLatestVersion: doc.codexLatestVersion ?? null,
    tz: doc.tz ?? null,
    firstSeenAt: doc.firstSeenAt,
    lastSyncAt: doc.lastSyncAt,
    lastRateLimit: rl
      ? {
          usedPercent: rl.usedPercent,
          windowMinutes: rl.windowMinutes,
          resetsAt: rl.resetsAt ?? null,
          planType: rl.planType ?? null,
          observedAt: rl.observedAt,
          receivedAt: rl.receivedAt,
        }
      : null,
  };
}

export const list = authedQuery({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, args): Promise<MachineRow[]> => {
    const userId = args.userId;
    const docs =
      userId !== undefined
        ? await ctx.db
            .query("machines")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .collect()
        : await ctx.db.query("machines").collect();
    return docs
      .map(toMachineRow)
      .sort((a, b) => b.lastSyncAt - a.lastSyncAt || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  },
});

export const rename = authedMutation({
  args: { machineId: v.string(), label: v.string() },
  handler: async (ctx, { machineId, label }): Promise<null> => {
    const trimmed = label.trim();
    if (trimmed.length === 0 || trimmed.length > 64) throw new ConvexError({ code: "bad_label" });
    const machine = await ctx.db
      .query("machines")
      .withIndex("by_machineId", (q) => q.eq("machineId", machineId))
      .unique();
    if (!machine || machine.userId !== ctx.user._id) throw new ConvexError({ code: "forbidden" });
    await ctx.db.patch(machine._id, { label: trimmed });
    return null;
  },
});
