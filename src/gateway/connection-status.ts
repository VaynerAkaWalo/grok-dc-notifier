export class ConnectionStatus {
  private connected = false;
  private lastActivity = Date.now();

  isConnected(): boolean {
    return this.connected;
  }

  lastActivityAt(): number {
    return this.lastActivity;
  }

  markActivity() {
    this.lastActivity = Date.now();
  }

  markConnected() {
    this.connected = true;
  }

  markDisconnected() {
    this.connected = false;
  }
}
