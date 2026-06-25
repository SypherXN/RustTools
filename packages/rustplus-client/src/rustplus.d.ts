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
    constructor(
      ip: string,
      port: number | string,
      playerId: string | number,
      playerToken: string | number,
      useFacepunchProxy?: boolean,
    );
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
    promoteToLeader(steamId: string, callback: RustPlusCallback): void;
    getCamera(cameraId: string): RustPlusCamera;
  }

  export interface RustPlusCamera extends EventEmitter {
    subscribe(): Promise<void>;
    unsubscribe(): Promise<void>;
    move(buttons: number, mouseDeltaX: number, mouseDeltaY: number): Promise<void>;
    shoot(): Promise<void>;
    isAutoTurret(): boolean;
    on(event: "render", listener: (frame: Buffer) => void): this;
    on(event: "subscribed", listener: () => void): this;
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
