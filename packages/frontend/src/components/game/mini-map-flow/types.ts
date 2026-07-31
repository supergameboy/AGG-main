export interface ChildLocationNodeData {
  [key: string]: unknown;
  id: string;
  name: string;
  type?: string;
  isCurrentLocation: boolean;
  parentLocationId?: string;
}

export interface EntryPointNodeData {
  [key: string]: unknown;
  id: string;
  name: string;
  regionName: string;
  direction: string;
}
