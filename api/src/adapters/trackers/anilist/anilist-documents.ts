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

// The entry must come from Media.mediaListEntry (the authenticated viewer's
// row). A bare MediaList(mediaId:) has no user filter, so AniList resolves it
// against an arbitrary user's list (live, KOM-144). `chapters` is AniList's
// known total, used for the auto-COMPLETED transition; null while releasing.
export const GET_LIST_ENTRY = /* GraphQL */ `
  query GetListEntry($mediaId: Int!) {
    Media(id: $mediaId) {
      chapters
      mediaListEntry {
        progress
        status
      }
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
