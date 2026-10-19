/** Stable routing identity configured by composition, never by the model. */
export type DestinationRole = 'canonical' | 'secondary';

/** App-family audience or one configured secondary inbox. */
export interface Destination {
  id: string;
  adapterId: string;
  role: DestinationRole;
  enabled: boolean;
}

/** Validated explicit delivery selection. */
export interface ResolvedDelivery {
  deliveryDestinationIds: string[];
  notificationDestinationIds: string[];
  secondaryDestinationIds: string[];
}
