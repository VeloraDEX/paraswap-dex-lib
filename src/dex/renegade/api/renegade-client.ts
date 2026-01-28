// RenegadeClient - Client for Renegade match endpoint API
// Handles authentication and HTTP requests to Renegade's external match endpoint.

import { Network } from '../../../constants';
import { IDexHelper } from '../../../dex-helper/idex-helper';
import { Logger } from '../../../types';
import { generateRenegadeAuthHeaders } from './auth';
import {
  buildRenegadeApiUrl,
  RENEGADE_API_TIMEOUT_MS,
  RENEGADE_QUOTE_ENDPOINT,
  RENEGADE_ASSEMBLE_ENDPOINT,
} from '../constants';
import {
  AssembleExternalMatchRequest,
  ExternalOrder,
  ExternalQuoteRequest,
  QuoteQueryParams,
  SignedExternalQuote,
  SponsoredMatchResponse,
  SponsoredQuoteResponse,
} from './types';

// Default headers for Renegade API requests
const DEFAULT_RENEGADE_HEADERS: Record<string, string> = {
  'content-type': 'application/json',
  accept: 'application/json;number=string',
};

// Client for interacting with Renegade match endpoint API
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

  // Request a quote from Renegade API
  async requestQuote(
    externalOrder: ExternalOrder,
    queryParams?: QuoteQueryParams,
  ): Promise<SponsoredQuoteResponse> {
    const requestBody: ExternalQuoteRequest = {
      external_order: externalOrder,
    };

    const { url: quoteUrl, pathWithQuery } = this.buildUrlWithQueryParams(
      RENEGADE_QUOTE_ENDPOINT,
      queryParams,
    );

    const headers = generateRenegadeAuthHeaders(
      pathWithQuery,
      JSON.stringify(requestBody),
      DEFAULT_RENEGADE_HEADERS,
      this.apiKey,
      this.apiSecret,
    );

    this.logger.debug('Requesting quote from Renegade API', {
      url: quoteUrl,
      order: externalOrder,
      queryParams,
    });

    const response: SponsoredQuoteResponse =
      await this.dexHelper.httpRequest.post(
        quoteUrl,
        requestBody,
        RENEGADE_API_TIMEOUT_MS,
        headers,
      );

    return response;
  }

  // Assemble an external match from a signed quote
  async assembleExternalMatch(
    signedQuote: SignedExternalQuote,
    queryParams?: QuoteQueryParams & {
      updated_order?: ExternalOrder | null;
    },
  ): Promise<SponsoredMatchResponse> {
    const requestBody: AssembleExternalMatchRequest = {
      signed_quote: signedQuote,
    };

    if (queryParams?.updated_order !== undefined) {
      requestBody.updated_order = queryParams.updated_order;
    }

    const { updated_order, ...urlQueryParams } = queryParams || {};
    const { url: assembleUrl, pathWithQuery } = this.buildUrlWithQueryParams(
      RENEGADE_ASSEMBLE_ENDPOINT,
      urlQueryParams,
    );

    const headers = generateRenegadeAuthHeaders(
      pathWithQuery,
      JSON.stringify(requestBody),
      DEFAULT_RENEGADE_HEADERS,
      this.apiKey,
      this.apiSecret,
    );

    this.logger.debug('Assembling external match from Renegade API', {
      url: assembleUrl,
      queryParams,
    });

    const response: SponsoredMatchResponse =
      await this.dexHelper.httpRequest.post(
        assembleUrl,
        requestBody,
        RENEGADE_API_TIMEOUT_MS,
        headers,
      );

    this.logger.debug(
      'Assembled external match from Renegade API',
      JSON.stringify(response, null, 2),
    );

    return response;
  }
  // Build URL with query parameters from endpoint path and optional query params
  private buildUrlWithQueryParams(
    endpoint: string,
    queryParams?: QuoteQueryParams,
  ): { url: string; pathWithQuery: string } {
    const url = new URL(endpoint, this.baseUrl);
    if (queryParams) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined) {
          searchParams.append(key, value.toString());
        }
      }
      url.search = searchParams.toString();
    }
    return {
      url: url.toString(),
      pathWithQuery: url.pathname + url.search,
    };
  }
}
