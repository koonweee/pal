import { Inject, Injectable } from '@nestjs/common';
import { DestinationRepository } from '../../delivery/destination.repository.js';
import type { SecondaryDriver } from './secondary-driver.js';
import { SecondaryRepository } from './secondary.repository.js';

/**
 * Narrow host capabilities available to provider drivers. Drivers register one
 * configured binding and persist only opaque provider state through this seam.
 */
@Injectable()
export class SecondaryDriverHostService {
  private readonly drivers = new Map<string, SecondaryDriver>();

  constructor(
    @Inject(SecondaryRepository)
    private readonly repository: SecondaryRepository,
    @Inject(DestinationRepository)
    private readonly destinations: DestinationRepository,
  ) {}

  async configure(driver: SecondaryDriver, enabled: boolean) {
    const destination = await this.destinations.get(driver.destinationId);
    if (
      !destination ||
      destination.adapterId !== driver.adapterId ||
      destination.role !== 'secondary'
    )
      throw new Error(
        `Secondary destination ${driver.destinationId} is not provisioned for ${driver.adapterId}`,
      );
    await this.destinations.setEnabled(driver.destinationId, enabled);
    if (enabled) this.register(driver);
  }

  /** Registers one validated destination binding at application composition. */
  register(driver: SecondaryDriver) {
    const current = this.drivers.get(driver.destinationId);
    if (current && current !== driver)
      throw new Error(
        `Duplicate secondary destination ${driver.destinationId}`,
      );
    this.drivers.set(driver.destinationId, driver);
  }

  get(destinationId: string) {
    return this.drivers.get(destinationId);
  }

  all() {
    return [...this.drivers.values()];
  }

  state(driver: SecondaryDriver, key: string) {
    return this.repository.state(driver.adapterId, driver.destinationId, key);
  }

  setState(
    driver: SecondaryDriver,
    key: string,
    value: Record<string, unknown>,
  ) {
    return this.repository.setState(
      driver.adapterId,
      driver.destinationId,
      key,
      value,
    );
  }
}
