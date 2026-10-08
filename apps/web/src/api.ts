import { StatsResponse } from "@passerby/shared";

/** Every API call goes through here, so responses are checked against the shared shapes. */
export async function getStats(signal?: AbortSignal): Promise<StatsResponse> {
  const res = await fetch("/api/v1/stats", { signal });
  if (!res.ok) throw new Error(`stats failed: ${res.status}`);
  return StatsResponse.parse(await res.json());
}
