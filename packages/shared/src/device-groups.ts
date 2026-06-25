export interface SwitchGroupRecord {
  id: string;
  serverId: string;
  name: string;
  displayName: string | null;
  chatCommand: string | null;
  memberEntityIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SwitchGroupInput {
  name: string;
  displayName?: string | null;
  chatCommand?: string | null;
  memberEntityIds?: string[];
}

export interface DeviceLibraryGroupRecord {
  id: string;
  serverId: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  memberEntityIds: string[];
  childGroupIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DeviceLibraryGroupInput {
  name: string;
  parentId?: string | null;
  sortOrder?: number;
  memberEntityIds?: string[];
}

export interface SavedCameraRecord {
  id: string;
  serverId: string;
  cameraId: string;
  label: string;
  libraryGroupId: string | null;
  createdAt: string;
}
