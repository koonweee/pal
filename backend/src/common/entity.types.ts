export interface Entity {
  id: string;
  createdAt: string;
}
export interface MutableEntity extends Entity {
  updatedAt: string;
  version: number;
}
