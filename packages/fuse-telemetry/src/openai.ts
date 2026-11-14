import {
  TranscriptionFailure,
  type AudioTranscriber,
} from "./transcription.js";

export interface OpenAITranscriberOptions {
  apiKey: string;
  model?: string;
  fetch: typeof fetch;
}
/** Secrets exist only at the composition root; errors never include provider bodies or audio. */
export class OpenAITranscriber implements AudioTranscriber {
  constructor(private options: OpenAITranscriberOptions) {}
  async transcribe(audio: Uint8Array): Promise<string> {
    if (!this.options.apiKey)
      throw new TranscriptionFailure("Transcription is not configured", true);
    const body = new FormData();
    body.set(
      "file",
      new Blob([new Uint8Array(audio)], { type: "audio/wav" }),
      "playtest.wav",
    );
    body.set("model", this.options.model ?? "gpt-transcribe");
    body.append("languages[]", "no");
    body.append("languages[]", "en");
    body.set("response_format", "json");
    let response: Response;
    try {
      response = await this.options.fetch(
        "https://api.openai.com/v1/audio/transcriptions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${this.options.apiKey}` },
          body,
          signal: AbortSignal.timeout(90_000),
        },
      );
    } catch {
      throw new TranscriptionFailure(
        "Transcription provider unavailable",
        false,
      );
    }
    if (!response.ok)
      throw new TranscriptionFailure(
        `Transcription provider HTTP ${response.status}`,
        response.status >= 400 &&
          response.status < 500 &&
          ![408, 409, 429].includes(response.status),
      );
    const reader = response.body?.getReader();
    if (!reader)
      throw new TranscriptionFailure("Empty transcription response", false);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 128_000) {
        await reader.cancel();
        throw new TranscriptionFailure(
          "Transcription response exceeds limit",
          true,
        );
      }
      chunks.push(part.value);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new TranscriptionFailure("Invalid transcription response", true);
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("text" in parsed) ||
      typeof parsed.text !== "string"
    )
      throw new TranscriptionFailure("Invalid transcription response", true);
    const text = parsed.text;
    if (text.length > 32_000)
      throw new TranscriptionFailure(
        "Transcription response exceeds limit",
        true,
      );
    return text;
  }
}
