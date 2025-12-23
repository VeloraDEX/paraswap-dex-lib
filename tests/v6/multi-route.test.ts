import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { testPriceRoute } from '../utils-e2e';
import { OptimalRate } from '@paraswap/core';

// timeout to 60 seconds
jest.setTimeout(60000);

const multiRouteDir = path.join(__dirname, 'multi-route');
const jsonFiles = fs
  .readdirSync(multiRouteDir)
  .filter(file => file.endsWith('.json'));

describe('Multi-route tests', () => {
  for (const jsonFile of jsonFiles) {
    const testName = jsonFile.replace('.json', '');
    if (testName.includes('test')) continue;
    // if (testName !== 'multi-route-eth-first-and-1-single') continue;

    console.log(`Running multi-route test: ${testName}`);

    it(`should pass for ${testName}`, async () => {
      const filePath = path.join(multiRouteDir, jsonFile);
      const priceRouteData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      await testPriceRoute(priceRouteData.priceRoute as OptimalRate);
    });
  }
});
