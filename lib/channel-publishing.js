import { readJsonResponse } from "./client-api.js";
import { parseAwsCredential, redactSensitiveText } from "./validation.js";

export async function* publishChannelsToInstances(channel, targets, signal) {
  const secrets = channel.channelKind === "aws"
    ? [...channel.keys, ...channel.keys.flatMap((key) => parseAwsCredential(key)?.secrets ?? [])]
    : channel.keys;
  for (const { instanceId, group } of targets) {
    if (signal?.aborted) return;

    const result = { instanceId, status: "unknown", success: 0, failure: 0, details: [] };
    let response;
    try {
      response = await fetch(`/api/instances/${instanceId}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...channel, group }),
        signal,
      });
      if (!response.ok) {
        if (response.status < 500) result.status = "rejected";
        await readJsonResponse(response, { notifySessionExpired: false });
      }
      if (!response.body || !response.headers.get("content-type")?.startsWith("application/x-ndjson")) {
        throw new Error("未收到有效的推送结果");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let remainder = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          const lines = (remainder + decoder.decode(value, { stream: !done })).split("\n");
          remainder = done ? "" : lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (event.type === "item-result") {
              if (event.success) result.success += 1;
              else result.failure += 1;
              if (!event.success || event.warning) {
                result.details.push({
                  index: event.index,
                  warning: event.warning === true,
                  message: redactSensitiveText(event.message, secrets),
                });
              }
            } else if (event.type === "complete") {
              result.status = "complete";
            } else if (event.type === "fatal") {
              result.status = "stopped";
              result.message = redactSensitiveText(event.message, secrets);
            }
          }
          if (done) break;
        }
      } finally {
        reader.releaseLock();
      }
      if (result.status === "unknown") result.message = "连接已结束，但未收到完成确认。";
    } catch (error) {
      if (signal?.aborted) return;
      result.message = redactSensitiveText(error.message, secrets);
    }
    yield result;
    if (response?.status === 401) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("application-session-expired"));
      }
      return;
    }
  }
}
