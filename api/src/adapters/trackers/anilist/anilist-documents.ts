export const SEARCH_MEDIA = /* GraphQL */ `
  query SearchMedia($search: String!) {
    Page(perPage: 10) {
      media(search: $search, type: MANGA, format_not: NOVEL) {
        id
        title {
          romaji
          english
          native
        }
        synonyms
        coverImage {
          large
        }
      }
    }
  }
`;

export const GET_LIST_ENTRY = /* GraphQL */ `
  query GetListEntry($mediaId: Int!) {
    MediaList(mediaId: $mediaId) {
      progress
      status
    }
  }
`;

export const SAVE_PROGRESS = /* GraphQL */ `
  mutation SaveProgress(
    $mediaId: Int!
    $progress: Int!
    $status: MediaListStatus!
  ) {
    SaveMediaListEntry(
      mediaId: $mediaId
      progress: $progress
      status: $status
    ) {
      progress
      status
    }
  }
`;

export const VIEWER = /* GraphQL */ `
  query Viewer {
    Viewer {
      id
      name
    }
  }
`;
