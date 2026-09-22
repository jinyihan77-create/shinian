import { checkinInputSchema, checkinSummarySchema, type CheckinInput, type CheckinSummary } from "../checkin";
import type { DataClient } from "./data-client";
import { ApiError } from "./http";

function databaseError(error: { message?: string; code?: string }): never {
  if (error.message === "PRIVATE_ACCOUNT_REQUIRED") throw new ApiError(403, "PRIVATE_ACCOUNT_REQUIRED", "当前账号没有这张打卡牌的访问权限。");
  if (error.message === "CHECKIN_DAY_CHANGED") throw new ApiError(409, "DAY_CHANGED", "北京时间已经进入新的一天。你的输入仍在，请刷新打卡日期后再试。");
  if (error.message === "INVALID_CHECKIN_INPUT") throw new ApiError(400, "INVALID_INPUT", "心情或金句过长，请缩短后重试。");
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code ?? "")) {
    throw new ApiError(503, "CHECKIN_NOT_READY", "云端打卡尚未初始化，此次没有确认保存。请完成打卡数据库配置后重试。");
  }
  throw new ApiError(503, "CHECKIN_UNAVAILABLE", "暂时无法连接云端打卡，尚未确认此次保存。请保留输入并刷新核对，重试不会增加重复天数。");
}

async function summary(client: DataClient, name: string, args?: Record<string, unknown>): Promise<CheckinSummary> {
  const { data, error } = await client.rpc(name, args);
  if (error) databaseError(error);
  const parsed = checkinSummarySchema.safeParse(data);
  if (!parsed.success) throw new ApiError(502, "INVALID_CHECKIN_RESPONSE", "云端返回的打卡信息不完整，尚未确认保存。请保留输入并重试。");
  return parsed.data;
}

export const cloudCheckins = {
  get(client: DataClient): Promise<CheckinSummary> { return summary(client, "echo_get_checkin"); },
  async create(client: DataClient, input: CheckinInput): Promise<CheckinSummary> {
    const parsed = checkinInputSchema.safeParse(input);
    if (!parsed.success) throw new ApiError(400, "INVALID_INPUT", "请检查打卡日期、心情和金句后重试。");
    const saved = await summary(client, "echo_create_checkin", {
      p_expected_day: parsed.data.expectedDay, p_mood: parsed.data.mood, p_quote: parsed.data.quote,
    });
    if (!saved.entry || saved.today !== parsed.data.expectedDay) {
      throw new ApiError(502, "INVALID_CHECKIN_RESPONSE", "云端未确认今天的打卡，输入仍为你保留，请刷新核对后重试。");
    }
    return saved;
  },
};
