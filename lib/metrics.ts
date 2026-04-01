/**
 * Built-in server metrics — lightweight counters with zero external dependencies.
 */

export interface MetricsSnapshot {
  connections: number;
  disconnections: number;
  activeConnections: number;
  upgrades: number;
  bytesReceived: number;
  bytesSent: number;
  errors: number;
  avgRtt: number;
  pollingCount: number;
  websocketCount: number;
}

export class ServerMetrics {
  connections = 0;
  disconnections = 0;
  upgrades = 0;
  bytesReceived = 0;
  bytesSent = 0;
  errors = 0;
  pollingCount = 0;
  websocketCount = 0;

  private rttSum = 0;
  private rttCount = 0;
  private static readonly MAX_RTT_SAMPLES = 1000;

  /** Increments the connection counter. */
  onConnection() {
    this.connections++;
  }

  /** Increments the disconnection counter. */
  onDisconnection() {
    this.disconnections++;
  }

  /** Increments the upgrade counter. */
  onUpgrade() {
    this.upgrades++;
  }

  /** Adds to the total bytes received counter. */
  onBytesReceived(bytes: number) {
    this.bytesReceived += bytes;
  }

  /** Adds to the total bytes sent counter. */
  onBytesSent(bytes: number) {
    this.bytesSent += bytes;
  }

  /** Increments the error counter. */
  onError() {
    this.errors++;
  }

  /** Records a round-trip time sample for average calculation. */
  onRtt(rtt: number) {
    this.rttSum += rtt;
    this.rttCount++;

    // Prevent unbounded growth by resetting after MAX_RTT_SAMPLES
    if (this.rttCount >= ServerMetrics.MAX_RTT_SAMPLES) {
      const avg = this.rttSum / this.rttCount;
      this.rttSum = avg;
      this.rttCount = 1;
    }
  }

  /** Increments the polling transport counter. */
  onPollingConnection() {
    this.pollingCount++;
  }

  /** Decrements the polling transport counter. */
  onPollingDisconnection() {
    this.pollingCount--;
  }

  /** Increments the WebSocket transport counter. */
  onWebSocketConnection() {
    this.websocketCount++;
  }

  /** Decrements the WebSocket transport counter. */
  onWebSocketDisconnection() {
    this.websocketCount--;
  }

  /** Returns a point-in-time snapshot of all metrics. */
  snapshot(): MetricsSnapshot {
    return {
      connections: this.connections,
      disconnections: this.disconnections,
      activeConnections: this.connections - this.disconnections,
      upgrades: this.upgrades,
      bytesReceived: this.bytesReceived,
      bytesSent: this.bytesSent,
      errors: this.errors,
      avgRtt: this.rttCount > 0 ? Math.round(this.rttSum / this.rttCount) : 0,
      pollingCount: this.pollingCount,
      websocketCount: this.websocketCount,
    };
  }
}
