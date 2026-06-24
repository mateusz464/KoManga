// The minimal GraphQL seam the Suwayomi adapter depends on. Keeping it this thin
// (a) stops graphql-request types leaking into our code, and (b) lets the
// adapter's mapping/error logic be tested against a mocked transport (API-201)
// without a live GraphQL server. The real implementation (API-202) wraps
// graphql-request's GraphQLClient.

export interface GraphQLTransport {
  /**
   * Execute a GraphQL document with optional variables, resolving with the raw
   * response data. Rejects on GraphQL errors and transport/network failures —
   * the adapter normalises those into a typed SuwayomiError.
   */
  request(
    document: string,
    variables?: Record<string, unknown>,
  ): Promise<unknown>;
}
