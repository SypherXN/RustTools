declare module "rustworld" {
  export class WorldData {
    size: number;
    maps: Array<{ name: string; data: Uint8Array }>;
    prefabs: unknown[];
    paths: unknown[];
    static decode(payload: Uint8Array): WorldData;
    getMapAsTerrain(map: string): unknown;
  }
}
