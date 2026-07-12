export type VehicleCatalogItem = {
  id: string;
  name: string;
  archivedAt: Date | null;
  usageCount: number;
};

export type VehicleCatalogListResponse = {
  items: VehicleCatalogItem[];
};

export type VehicleCatalogListOptions = {
  includeArchived?: boolean | string;
  search?: string;
};
