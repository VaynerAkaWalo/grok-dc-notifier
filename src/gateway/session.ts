import type { Ready } from "./protocol.ts";

export class GatewaySession {
  botUserId = "";
  private sessionId = "";
  private resumeUrl = "";
  private sequence = 0;

  get resumable(): boolean {
    return this.sessionId !== "";
  }

  get lastSequence(): number {
    return this.sequence;
  }

  get heartbeatSequence(): number | null {
    return this.sequence > 0 ? this.sequence : null;
  }

  connectUrl(defaultUrl: string): string {
    return this.resumable && this.resumeUrl ? this.resumeUrl : defaultUrl;
  }

  trackSequence(sequence: number | null | undefined) {
    if (typeof sequence === "number") {
      this.sequence = sequence;
    }
  }

  ready(ready: Ready) {
    this.sessionId = ready.session_id ?? "";
    this.resumeUrl = ready.resume_gateway_url?.trim() ?? "";
    this.botUserId = ready.user?.id ?? "";
  }

  reset() {
    this.sessionId = "";
    this.resumeUrl = "";
    this.sequence = 0;
  }

  identifyPayload(token: string, intents: number) {
    return {
      token,
      intents,
      properties: {
        os: "linux",
        browser: "grok-dc-notifier",
        device: "grok-dc-notifier",
      },
    };
  }

  resumePayload(token: string) {
    return { token, session_id: this.sessionId, seq: this.sequence };
  }
}
