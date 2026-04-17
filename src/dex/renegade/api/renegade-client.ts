import { Network } from '../../../constants';
import { IDexHelper } from '../../../dex-helper/idex-helper';
import { Logger } from '../../../types';
import { generateRenegadeAuthHeaders } from './auth';
import {
  buildRenegadeApiUrl,
  RENEGADE_API_TIMEOUT_MS,
  RENEGADE_ASSEMBLE_ENDPOINT,
} from '../constants';
import {
  AssembleExternalMatchRequest,
  ExternalOrder,
  SponsoredMatchResponse,
} from './types';

const DEFAULT_RENEGADE_HEADERS: Record<string, string> = {
  'content-type': 'application/json',
  accept: 'application/json',
};

export class RenegadeClient {
  private readonly baseUrl: string;

  constructor(
    private readonly dexHelper: IDexHelper,
    private readonly network: Network,
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly logger: Logger,
  ) {
    this.baseUrl = buildRenegadeApiUrl(this.network);
  }

  async requestExternalMatch(
    externalOrder: ExternalOrder,
  ): Promise<SponsoredMatchResponse> {
    const requestBody: AssembleExternalMatchRequest = {
      do_gas_estimation: false,
      order: {
        type: 'direct-order',
        external_order: externalOrder,
      },
    };

    const { url: assembleUrl, path } = this.buildUrl(
      RENEGADE_ASSEMBLE_ENDPOINT,
    );

    const headers = generateRenegadeAuthHeaders(
      path,
      JSON.stringify(requestBody),
      DEFAULT_RENEGADE_HEADERS,
      this.apiKey,
      this.apiSecret,
    );

    try {
      const response = await this.dexHelper.httpRequest.request({
        url: assembleUrl,
        method: 'POST',
        data: requestBody,
        timeout: RENEGADE_API_TIMEOUT_MS,
        headers,
      });

      if (response.status === 204 || !response.data) {
        const err: any = new Error('No match available');
        err.isNoMatchError = true;
        throw err;
      }

      return response.data;
    } catch (e: any) {
      if (e.isNoMatchError) throw e;
      this.logger.error('Renegade direct assemble request failed', {
        url: assembleUrl,
        requestBody,
        status: e?.response?.status,
        responseData: e?.response?.data,
      });
      throw e;
    }
  }

  private buildUrl(endpoint: string): { url: string; path: string } {
    const url = new URL(endpoint, this.baseUrl);
    return {
      url: url.toString(),
      path: url.pathname,
    };
  }
}
