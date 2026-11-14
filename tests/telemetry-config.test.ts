import assert from "node:assert/strict";
import test from "node:test";
import { telemetryConfiguration } from "../service/telemetry-config.js";

const enabled = {
  TELEMETRY_ENABLED: "1",
  TELEMETRY_RATE_LIMIT_KEY: "test-only-key-not-a-secret-32-characters",
};
test("telemetry is opt-in and production recording needs every durable dependency", () => {
  assert.equal(telemetryConfiguration({}), undefined);
  assert.equal(telemetryConfiguration({ TELEMETRY_ENABLED: "0" }), undefined);
  assert.equal(telemetryConfiguration(enabled)?.recordingEnabled, false);
  const configured = telemetryConfiguration({
    ...enabled,
    TELEMETRY_BUCKET: "example-private-recordings",
    OPENAI_API_KEY: "injected-test-value",
    TRANSCRIPTION_PUSH_AUDIENCE:
      "https://worker.example/api/internal/telemetry/transcribe",
    TRANSCRIPTION_PUSH_SERVICE_ACCOUNT:
      "telemetry-push@example-project.iam.gserviceaccount.com",
  });
  assert.equal(configured?.recordingEnabled, true);
  assert.equal(configured?.transcriptionModel, "gpt-transcribe");
  assert.equal(configured?.actionModel, "gpt-6.1-sol");
});
test("invalid server config fails without echoing secret values", () => {
  for (const env of [
    { ...enabled, TELEMETRY_ENABLED: "true" },
    { ...enabled, TELEMETRY_RATE_LIMIT_KEY: "secret" },
    { ...enabled, TELEMETRY_BUCKET: "../public" },
    { ...enabled, TRANSCRIPTION_PUSH_AUDIENCE: "invalid" },
    { ...enabled, TRANSCRIPTION_PUSH_AUDIENCE: "http://worker.example/" },
    {
      ...enabled,
      TRANSCRIPTION_PUSH_AUDIENCE: "https://user:secret@worker.example/",
    },
    {
      ...enabled,
      TRANSCRIPTION_PUSH_AUDIENCE: "https://worker.example/?token=secret",
    },
    { ...enabled, TRANSCRIPTION_PUSH_SERVICE_ACCOUNT: "user@example.com" },
    { ...enabled, OPENAI_ACTION_MODEL: "model\nsecret" },
  ])
    assert.throws(
      () => telemetryConfiguration(env),
      (error: unknown) =>
        error instanceof Error && !error.message.includes("secret"),
    );
});
