declare module "@liamcottle/rustplus.js" {
  import { EventEmitter } from "node:events";

  export interface RustPlusMessage {
    response?: {
      error?: { error?: string };
      info?: unknown;
      teamInfo?: unknown;
      time?: unknown;
      map?: { jpgImage?: Uint8Array | Buffer; width?: number; height?: number };
      mapMarkers?: unknown;
      entityInfo?: unknown;
    };
    broadcast?: Record<string, unknown>;
  }

  export type RustPlusCallback = (message: RustPlusMessage) => void;

  export default class RustPlus extends EventEmitter {
    constructor(ip: string, port: number | string, playerId: string, playerToken: string);
    connect(): void;
    disconnect(): void;
    getInfo(callback: RustPlusCallback): void;
    getTeamInfo(callback: RustPlusCallback): void;
    getTime(callback: RustPlusCallback): void;
    getMap(callback: RustPlusCallback): void;
    getMapMarkers(callback: RustPlusCallback): void;
    getEntityInfo(entityId: number, callback: RustPlusCallback): void;
    setEntityValue(entityId: number, value: boolean, callback: RustPlusCallback): void;
    sendTeamMessage(message: string, callback: RustPlusCallback): void;
  }
}

declare module "@liamcottle/push-receiver/src/client" {
  import { EventEmitter } from "node:events";
  export default class PushReceiverClient extends EventEmitter {
    constructor(androidId: string, securityToken: string, persistentIds: string[]);
    connect(): Promise<void>;
    destroy(): void;
  }
}
