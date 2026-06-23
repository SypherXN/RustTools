import type { WebSocket } from "ws";

export class WsHub {
  private clients = new Set<WebSocket>();

  add(socket: WebSocket): void {
    this.clients.add(socket);
    socket.on("close", () => this.clients.delete(socket));
  }

  broadcast(event: string, payload: unknown): void {
    const message = JSON.stringify({ event, payload });
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }
  }

  size(): number {
    return this.clients.size;
  }
}
