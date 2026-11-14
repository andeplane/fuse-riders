/** Only server configuration belongs here. Never expose these values through a Vite define. */
export interface TelemetryConfiguration {
  rateLimitKey: string;
  bucket?: string;
  openaiKey?: string;
  transcriptionModel: string;
  actionModel: string;
  pushAudience?: string;
  pushServiceAccount?: string;
  recordingEnabled: boolean;
}

export function telemetryConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): TelemetryConfiguration | undefined {
  if (!env.TELEMETRY_ENABLED || env.TELEMETRY_ENABLED === "0") return undefined;
  if (env.TELEMETRY_ENABLED !== "1")
    throw new Error("TELEMETRY_ENABLED must be 0 or 1");
  const rateLimitKey = env.TELEMETRY_RATE_LIMIT_KEY;
  if (!rateLimitKey || rateLimitKey.length < 32)
    throw new Error(
      "TELEMETRY_RATE_LIMIT_KEY must contain at least 32 characters",
    );
  const bucket = env.TELEMETRY_BUCKET;
  if (bucket && !/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(bucket))
    throw new Error("Invalid TELEMETRY_BUCKET");
  const pushAudience = env.TRANSCRIPTION_PUSH_AUDIENCE;
  if (pushAudience) {
    let url: URL;
    try {
      url = new URL(pushAudience);
    } catch {
      throw new Error("Invalid TRANSCRIPTION_PUSH_AUDIENCE");
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Invalid TRANSCRIPTION_PUSH_AUDIENCE");
  }
  const pushServiceAccount = env.TRANSCRIPTION_PUSH_SERVICE_ACCOUNT;
  if (
    pushServiceAccount &&
    !/^[a-z][a-z0-9-]+@[a-z][a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(
      pushServiceAccount,
    )
  )
    throw new Error("Invalid TRANSCRIPTION_PUSH_SERVICE_ACCOUNT");
  const transcriptionModel = env.OPENAI_TRANSCRIPTION_MODEL || "gpt-transcribe";
  const actionModel = env.OPENAI_ACTION_MODEL || "gpt-6.1-sol";
  for (const model of [transcriptionModel, actionModel])
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(model))
      throw new Error("Invalid OpenAI model configuration");
  const openaiKey = env.OPENAI_API_KEY || undefined;
  return {
    rateLimitKey,
    bucket,
    openaiKey,
    transcriptionModel,
    actionModel,
    pushAudience,
    pushServiceAccount,
    recordingEnabled: Boolean(
      bucket && openaiKey && pushAudience && pushServiceAccount,
    ),
  };
}
