import { fixtureClient } from '../tests/support/fixtures';
import { seedDemoInventory } from './demo-inventory';

const client = await fixtureClient();
try {
  await seedDemoInventory(client, 7);
} finally {
  await client.end();
}
